use std::sync::Mutex;
use std::time::Duration;

use crate::forge::raw_request_bytes;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use tauri::Emitter;
use aes_gcm::aead::rand_core::RngCore;
use aes_gcm::aead::{Aead, KeyInit, OsRng};

#[derive(serde::Serialize, Clone)]
pub struct ClipboardPayload {
    pub kind: String, // "text" | "image"
    pub text: Option<String>,
    pub image_b64: Option<String>,
    pub timestamp: u64,
}

#[derive(serde::Serialize)]
pub struct ClipboardPushResult {
    pub updated: bool,
}

#[derive(serde::Serialize)]
pub struct ClipboardEncrypted {
    pub key_b64: String,
    pub nonce_b64: String,
    pub ciphertext_b64: String,
}

static WATCHER_RUNNING: Mutex<bool> = Mutex::new(false);
static WATCHER_STOP: Mutex<bool> = Mutex::new(false);

/// What we currently observe on the OS clipboard.
#[derive(PartialEq, Clone)]
enum ClipboardValue {
    Text(String),
    /// PNG-encoded image bytes.
    Image(Vec<u8>),
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn read_clipboard_text() -> Option<String> {
    let mut cb = arboard::Clipboard::new().ok()?;
    cb.get_text().ok()
}

/// 10.2 - Read an image off the clipboard and encode it as PNG.
/// Enforces a 2-megapixel cap (raw) so we never OOM on huge captures.
fn read_clipboard_image() -> Option<Vec<u8>> {
    let mut cb = arboard::Clipboard::new().ok()?;
    let img = cb.get_image().ok()?;
    let pixels = (img.width as u64).saturating_mul(img.height as u64);
    if pixels == 0 || pixels > 2_000_000 {
        return None;
    }
    let rgba =
        image::RgbaImage::from_raw(img.width as u32, img.height as u32, img.bytes.to_vec())?;
    let mut out = Vec::new();
    rgba.write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
        .ok()?;
    Some(out)
}

fn read_clipboard() -> Option<ClipboardValue> {
    if let Some(text) = read_clipboard_text() {
        return Some(ClipboardValue::Text(text));
    }
    read_clipboard_image().map(ClipboardValue::Image)
}

/// 10.1 - Start a 300ms-poll watcher that emits `clipboard://changed` and,
/// when enabled, pushes to the device's /api/clipboard endpoint.
#[tauri::command]
pub fn clipboard_start(
    app: tauri::AppHandle,
    host: Option<String>,
    port: Option<u16>,
    token: Option<String>,
    push_enabled: Option<bool>,
) -> Result<(), String> {
    let push = push_enabled.unwrap_or(false);

    {
        let mut running = WATCHER_RUNNING
            .lock()
            .map_err(|_| "clipboard watcher lock poisoned".to_string())?;
        if *running {
            return Ok(()); // already running
        }
        *running = true;
        *WATCHER_STOP
            .lock()
            .map_err(|_| "clipboard stop lock poisoned".to_string())? = false;
    }

    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut last: Option<ClipboardValue> = None;
        let mut last_same: u32 = 0;

        loop {
            if *WATCHER_STOP.lock().unwrap_or_else(|p| p.into_inner()) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(300)).await;

            let current = read_clipboard();
            if let Some(value) = current {
                if last.as_ref() == Some(&value) {
                    last_same += 1;
                    if last_same > 4 {
                        // Reset periodically so a re-copy of the same content
                        // (after an intentional change elsewhere) is detected.
                        last = None;
                        last_same = 0;
                    }
                    continue;
                }
                last = Some(value.clone());
                last_same = 0;

                let timestamp = now_ms();
                let host_s = host.clone().unwrap_or_default();
                let port_v = port.unwrap_or(0);
                let token_s = token.clone().unwrap_or_default();
                match value {
                    ClipboardValue::Text(text) => {
                        let payload = ClipboardPayload {
                            kind: "text".to_string(),
                            text: Some(text.clone()),
                            image_b64: None,
                            timestamp,
                        };
                        let _ = app2.emit("clipboard://changed", payload.clone());

                        if push {
                            let _ = push_text(&host_s, port_v, &token_s, &text);
                        }
                    }
                    ClipboardValue::Image(png) => {
                        let image_b64 = B64.encode(&png);
                        let payload = ClipboardPayload {
                            kind: "image".to_string(),
                            text: None,
                            image_b64: Some(image_b64.clone()),
                            timestamp,
                        };
                        let _ = app2.emit("clipboard://changed", payload);

                        // Keep the push payload bounded (6MB base64 ≈ 4.5MB PNG).
                        if push && image_b64.len() <= 6_000_000 {
                            let _ = push_image(&host_s, port_v, &token_s, &image_b64);
                        }
                    }
                }
            }
        }
    });

    Ok(())
}

/// 10.1 - Stop the clipboard watcher started by `clipboard_start`.
#[tauri::command]
pub fn clipboard_stop() -> Result<(), String> {
    *WATCHER_STOP
        .lock()
        .map_err(|_| "clipboard stop lock poisoned".to_string())? = true;
    *WATCHER_RUNNING
        .lock()
        .map_err(|_| "clipboard watcher lock poisoned".to_string())? = false;
    Ok(())
}

/// 10.2 - Get the current clipboard content (text, or PNG bytes as base64).
#[tauri::command]
pub async fn clipboard_get() -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        match read_clipboard() {
            Some(ClipboardValue::Text(t)) => Ok(serde_json::json!({
                "kind": "text",
                "text": t,
            })),
            Some(ClipboardValue::Image(png)) => Ok(serde_json::json!({
                "kind": "image",
                "imageData": B64.encode(&png),
            })),
            None => Ok(serde_json::json!({ "kind": "none" })),
        }
    })
    .await
    .map_err(|e| format!("join error: {:?}", e))?
}

/// Set the clipboard to plain text.
#[tauri::command]
pub fn clipboard_set(text: String) -> Result<(), String> {
    let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    cb.set_text(text).map_err(|e| e.to_string())
}

/// 10.2 - Set the clipboard to an image (accepts PNG bytes as base64).
#[tauri::command]
pub fn clipboard_set_image(image_b64: String) -> Result<(), String> {
    let bytes = B64
        .decode(image_b64.trim().as_bytes())
        .map_err(|e| format!("bad base64: {}", e))?;
    let img = image::load_from_memory(&bytes).map_err(|e| format!("bad image: {}", e))?;
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    cb.set_image(arboard::ImageData {
        width: w as usize,
        height: h as usize,
        bytes: rgba.into_raw().into(),
    })
    .map_err(|e| e.to_string())
}

/// Push the current clipboard text to the device (POST /api/clipboard).
#[tauri::command]
pub async fn clipboard_push(
    host: String,
    port: u16,
    token: String,
) -> Result<ClipboardPushResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let text = read_clipboard_text().ok_or("clipboard empty".to_string())?;
        push_text(&host, port, &token, &text)
    })
    .await
    .map_err(|e| format!("join error: {:?}", e))?
}

/// 10.2 - Push an image (PNG base64) to the device's clipboard.
#[tauri::command]
pub async fn clipboard_push_image(
    host: String,
    port: u16,
    token: String,
    image_b64: String,
) -> Result<ClipboardPushResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        push_image(&host, port, &token, &image_b64)
    })
    .await
    .map_err(|e| format!("join error: {:?}", e))?
}

fn push_text(host: &str, port: u16, token: &str, text: &str) -> Result<ClipboardPushResult, String> {
    let tk = token.to_string();
    let body = serde_json::json!({ "type": "text", "content": text }).to_string();
    let (status, _resp) = raw_request_bytes(
        host.to_string(),
        port,
        tk,
        "POST".to_string(),
        "/api/clipboard".to_string(),
        &[],
        body.as_bytes(),
        15,
    )?;
    if status >= 400 {
        return Err(format!("clipboard push failed: HTTP {}", status));
    }
    Ok(ClipboardPushResult { updated: true })
}

fn push_image(host: &str, port: u16, token: &str, image_b64: &str) -> Result<ClipboardPushResult, String> {
    let body = serde_json::json!({
        "type": "image",
        "image_data": image_b64,
    })
    .to_string();
    let (status, _resp) = raw_request_bytes(
        host.to_string(),
        port,
        token.to_string(),
        "POST".to_string(),
        "/api/clipboard".to_string(),
        &[],
        body.as_bytes(),
        30,
    )?;
    if status >= 400 {
        return Err(format!("image push failed: HTTP {}", status));
    }
    Ok(ClipboardPushResult { updated: true })
}

/// 10.5 (extension) - Encrypt clipboard content with AES-256-GCM.
/// Random key + nonce per operation; returns all three pieces base64.
#[tauri::command]
pub fn clipboard_encrypt(text: String) -> Result<ClipboardEncrypted, String> {
    use aes_gcm::{Aes256Gcm, Nonce};
    let mut key = [0u8; 32];
    OsRng.fill_bytes(&mut key);
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), text.as_bytes())
        .map_err(|e| e.to_string())?;
    Ok(ClipboardEncrypted {
        key_b64: B64.encode(key),
        nonce_b64: B64.encode(nonce_bytes),
        ciphertext_b64: B64.encode(ct),
    })
}

/// 10.5 (extension) - Decrypt output of `clipboard_encrypt`.
#[tauri::command]
pub fn clipboard_decrypt(
    key_b64: String,
    nonce_b64: String,
    ciphertext_b64: String,
) -> Result<String, String> {
    use aes_gcm::{Aes256Gcm, Nonce};
    let key = B64.decode(key_b64.as_bytes()).map_err(|e| e.to_string())?;
    let nonce = B64.decode(nonce_b64.as_bytes()).map_err(|e| e.to_string())?;
    let ct = B64
        .decode(ciphertext_b64.as_bytes())
        .map_err(|e| e.to_string())?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let pt = cipher
        .decrypt(Nonce::from_slice(&nonce), ct.as_ref())
        .map_err(|e| format!("decrypt failed: {}", e))?;
    String::from_utf8(pt).map_err(|e| e.to_string())
}