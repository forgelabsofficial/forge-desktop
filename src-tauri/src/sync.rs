use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;
use std::sync::Mutex;

use crate::forge::raw_request_bytes;
use notify::Watcher as _;
use sha2::{Digest, Sha256};
use tauri::Emitter;

#[derive(serde::Serialize)]
pub struct SyncUploadResult {
    pub path: String,
    pub chunks: u32,
    pub complete: bool,
    pub bytes: u64,
    pub compressed: bool,
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncChunkResult {
    pub uploaded: bool,
    pub received_chunks: Vec<u32>,
    pub complete: bool,
}

#[derive(serde::Serialize)]
pub struct SyncDownloadResult {
    pub path: String,
    pub bytes: u64,
    pub resumed: bool,
}

#[derive(serde::Serialize)]
pub struct SyncStatResult {
    pub exists: bool,
    pub size: Option<u64>,
    pub last_modified: Option<u64>,
    pub checksum: Option<String>,
}

#[derive(serde::Serialize)]
pub struct SyncAutoResult {
    /// "uploaded" | "noop" | "skip_remote_newer" | "conflict_kept_both"
    pub action: String,
    /// Remote path actually used (may be a .conflict-* name).
    pub path: String,
    pub bytes: u64,
    pub compressed: bool,
}

#[derive(serde::Serialize, Clone)]
pub struct SyncFileChange {
    pub kind: String,
    pub paths: Vec<String>,
}

/// Keeps the (single) active file watcher alive for the app lifetime.
static WATCHER: Mutex<Option<notify::RecommendedWatcher>> = Mutex::new(None);
static WATCHER_STOP: Mutex<bool> = Mutex::new(false);

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 9.1 - Watch a directory tree, debounce 500ms, emit batched
/// `sync://file-change` events (payload is a Vec<SyncFileChange>).
#[tauri::command]
pub fn sync_watch(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let buffer = std::sync::Arc::new(Mutex::new(Vec::<SyncFileChange>::new()));

    let buffer_cb = buffer.clone();
    let mut watcher = notify::recommended_watcher(
        move |res: Result<notify::Event, notify::Error>| {
            if let Ok(event) = res {
                if let Ok(mut buf) = buffer_cb.lock() {
                    buf.push(SyncFileChange {
                        kind: format!("{:?}", event.kind),
                        paths: event
                            .paths
                            .iter()
                            .map(|p| p.to_string_lossy().to_string())
                            .collect(),
                    });
                }
            }
        },
    )
    .map_err(|e| e.to_string())?;

    watcher
        .watch(Path::new(&path), notify::RecursiveMode::Recursive)
        .map_err(|e| format!("watch {}: {}", path, e))?;

    {
        let mut guard = WATCHER.lock().map_err(|_| "watcher lock poisoned".to_string())?;
        *guard = Some(watcher);
    }
    *WATCHER_STOP
        .lock()
        .map_err(|_| "watcher stop lock poisoned".to_string())? = false;

    // Debounced flusher: drains the buffer every 500ms and emits a batch.
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            if *WATCHER_STOP.lock().unwrap_or_else(|p| p.into_inner()) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
            let batch: Vec<SyncFileChange> = {
                let mut buf = buffer.lock().unwrap_or_else(|p| p.into_inner());
                buf.drain(..).collect()
            };
            if !batch.is_empty() {
                let _ = app2.emit("sync://file-change", batch);
            }
        }
    });

    Ok(())
}

/// Stop the file watcher started by `sync_watch`.
#[tauri::command]
pub fn sync_unwatch() -> Result<(), String> {
    *WATCHER_STOP
        .lock()
        .map_err(|_| "watcher stop lock poisoned".to_string())? = true;
    {
        let mut guard = WATCHER.lock().map_err(|_| "watcher lock poisoned".to_string())?;
        *guard = None;
    }
    Ok(())
}

/// Core upload engine (9.2 + 9.6): whole-file SHA-256 on every chunk,
/// 3-pass retry, optional gzip compression.
fn upload_file(
    host: &str,
    port: u16,
    token: &str,
    local_path: &str,
    remote_path: &str,
    chunk_size: usize,
    compress: bool,
) -> Result<SyncUploadResult, String> {
    let mut file =
        File::open(local_path).map_err(|e| format!("open {}: {}", local_path, e))?;
    let len = file.metadata().map_err(|e| e.to_string())?.len();
    let mut data = Vec::with_capacity(len as usize);
    file.read_to_end(&mut data).map_err(|e| e.to_string())?;

    let (payload, actually_compressed) = if compress {
        use flate2::write::GzEncoder;
        use flate2::Compression;
        let mut enc = GzEncoder::new(Vec::new(), Compression::default());
        enc.write_all(&data).map_err(|e| e.to_string())?;
        (enc.finish().map_err(|e| e.to_string())?, true)
    } else {
        (data, false)
    };

    let total_chunks = ((payload.len() + chunk_size - 1) / chunk_size).max(1) as u32;
    // The device expects the SAME whole-file checksum on every chunk
    // (SyncService verifies each chunk against the first-seen value).
    let checksum = format!("{:x}", Sha256::digest(&payload));
    let mut done = vec![false; total_chunks as usize];

    for _pass in 0..3 {
        for i in 0..total_chunks as usize {
            if done[i] {
                continue;
            }
            let start = i * chunk_size;
            let end = ((i + 1) * chunk_size).min(payload.len());
            let res = upload_chunk(
                host,
                port,
                token,
                remote_path,
                i as u32,
                total_chunks,
                &checksum,
                &payload[start..end],
                actually_compressed,
            )?;
            if res.uploaded || res.complete {
                done[i] = true;
            }
        }
        if done.iter().all(|&d| d) {
            break;
        }
    }

    if !done.iter().all(|&d| d) {
        return Err("upload failed: some chunks did not reach the device".to_string());
    }

    Ok(SyncUploadResult {
        path: remote_path.to_string(),
        chunks: total_chunks,
        complete: true,
        bytes: len,
        compressed: actually_compressed,
    })
}

/// 9.2 + 9.5 + 9.6 - Upload a local file to the device in chunks.
#[tauri::command]
pub async fn sync_upload_file(
    host: String,
    port: u16,
    token: String,
    local_path: String,
    remote_path: String,
    chunk_size: Option<usize>,
    compress: Option<bool>,
    local_modified_ms: Option<u64>,
    remote_modified_ms: Option<u64>,
) -> Result<SyncUploadResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // 9.5 - Last-write-wins conflict guard (see sync_auto for the full
        // keep-both resolution).
        if let (Some(local), Some(remote)) = (local_modified_ms, remote_modified_ms) {
            if remote > local {
                return Err(format!(
                    "conflict: remote file is newer (remote={} local={}); not overwriting",
                    remote, local
                ));
            }
        }

        let chunk_size = chunk_size.unwrap_or(256 * 1024);
        let compress = compress.unwrap_or(false);
        upload_file(&host, port, &token, &local_path, &remote_path, chunk_size, compress)
    })
    .await
    .map_err(|e| format!("join error: {:?}", e))?
}

/// 9.4 - Download a file from the device to local_dir, with resume support.
#[tauri::command]
pub async fn sync_download(
    host: String,
    port: u16,
    token: String,
    remote_path: String,
    local_dir: String,
    offset: Option<u64>,
) -> Result<SyncDownloadResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let filename = Path::new(&remote_path)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("download.bin");
        let dest = PathBuf::from(&local_dir).join(filename);
        let resume_from = offset.unwrap_or(0);

        let mut headers: Vec<(&str, String)> = Vec::new();
        if resume_from > 0 {
            headers.push(("Range", format!("bytes={}-", resume_from)));
        }
        let url_path = format!("/api/sync/download?path={}", urlencode(&remote_path));

        let (status, data) =
            raw_request_bytes(host, port, token, "GET".to_string(), url_path, &headers, &[], 120)?;

        if status == 404 {
            return Err("file not found on device".to_string());
        }
        if status >= 400 {
            return Err(format!(
                "download failed: HTTP {} {}",
                status,
                String::from_utf8_lossy(&data)
            ));
        }

        let file = if resume_from > 0 {
            OpenOptions::new().create(true).append(true).open(&dest)
        } else {
            OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(&dest)
        }
        .map_err(|e| format!("open {}: {}", dest.display(), e))?;

        let mut file = file;
        file.write_all(&data).map_err(|e| e.to_string())?;

        Ok(SyncDownloadResult {
            path: dest.to_string_lossy().to_string(),
            bytes: data.len() as u64,
            resumed: resume_from > 0,
        })
    })
    .await
    .map_err(|e| format!("join error: {:?}", e))?
}

/// 9.5 support - stat a remote file (size / mtime / sha256) for conflict
/// detection before uploading.
#[tauri::command]
pub async fn sync_stat(
    host: String,
    port: u16,
    token: String,
    remote_path: String,
) -> Result<SyncStatResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let url_path = format!("/api/sync/stat?path={}", urlencode(&remote_path));
        let (status, resp) =
            raw_request_bytes(host, port, token, "GET".to_string(), url_path, &[], &[], 30)?;
        if status >= 400 {
            return Err(format!("stat failed: HTTP {}", status));
        }
        let v: serde_json::Value =
            serde_json::from_slice(&resp).map_err(|e| format!("bad stat response: {}", e))?;
        Ok(SyncStatResult {
            exists: v["exists"].as_bool().unwrap_or(false),
            size: v["size"].as_u64(),
            last_modified: v["last_modified"].as_u64(),
            checksum: v["checksum"].as_str().map(String::from),
        })
    })
    .await
    .map_err(|e| format!("join error: {:?}", e))?
}

/// 9.5 - Full last-write-wins sync with keep-both conflicts.
/// - remote missing → upload
/// - remote newer  → skip (caller should download)
/// - same mtime + same checksum → noop
/// - same mtime + different checksum → upload local copy under `.conflict-<ts>`
/// - local newer   → upload
#[tauri::command]
pub async fn sync_auto(
    host: String,
    port: u16,
    token: String,
    local_path: String,
    remote_path: String,
) -> Result<SyncAutoResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let chunk_size = 256 * 1024;

        let meta =
            std::fs::metadata(&local_path).map_err(|e| format!("open {}: {}", local_path, e))?;
        let local_mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64);

        let stat = {
            let url_path = format!("/api/sync/stat?path={}", urlencode(&remote_path));
            let (status, resp) = raw_request_bytes(
                host.clone(),
                port,
                token.clone(),
                "GET".to_string(),
                url_path,
                &[],
                &[],
                30,
            )?;
            if status >= 400 {
                return Err(format!("stat failed: HTTP {}", status));
            }
            let v: serde_json::Value =
                serde_json::from_slice(&resp).map_err(|e| format!("bad stat response: {}", e))?;
            SyncStatResult {
                exists: v["exists"].as_bool().unwrap_or(false),
                size: v["size"].as_u64(),
                last_modified: v["last_modified"].as_u64(),
                checksum: v["checksum"].as_str().map(String::from),
            }
        };

        if stat.exists {
            let local_sha = {
                let mut f = File::open(&local_path).map_err(|e| e.to_string())?;
                let mut buf = Vec::new();
                f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
                format!("{:x}", Sha256::digest(&buf))
            };
            if let Some(remote_mtime) = stat.last_modified {
                if remote_mtime > local_mtime.unwrap_or(0) {
                    return Ok(SyncAutoResult {
                        action: "skip_remote_newer".to_string(),
                        path: remote_path.clone(),
                        bytes: meta.len(),
                        compressed: false,
                    });
                }
                if local_mtime == Some(remote_mtime) {
                    if stat.checksum.as_deref() == Some(local_sha.as_str()) {
                        return Ok(SyncAutoResult {
                            action: "noop".to_string(),
                            path: remote_path.clone(),
                            bytes: meta.len(),
                            compressed: false,
                        });
                    }
                    // Same timestamp, different content: keep both (9.5).
                    let conflict = format!("{}.conflict-{}", remote_path, now_ms());
                    let up = upload_file(
                        &host, port, &token, &local_path, &conflict, chunk_size, false,
                    )?;
                    return Ok(SyncAutoResult {
                        action: "conflict_kept_both".to_string(),
                        path: up.path,
                        bytes: up.bytes,
                        compressed: false,
                    });
                }
            }
        }

        let up = upload_file(&host, port, &token, &local_path, &remote_path, chunk_size, false)?;
        Ok(SyncAutoResult {
            action: "uploaded".to_string(),
            path: up.path,
            bytes: up.bytes,
            compressed: up.compressed,
        })
    })
    .await
    .map_err(|e| format!("join error: {:?}", e))?
}

fn multipart_field(body: &mut Vec<u8>, boundary: &str, name: &str, value: &str) {
    body.extend_from_slice(
        format!(
            "--{}\r\nContent-Disposition: form-data; name=\"{}\"\r\n\r\n{}\r\n",
            boundary, name, value
        )
        .as_bytes(),
    );
}

fn upload_chunk(
    host: &str,
    port: u16,
    token: &str,
    path: &str,
    chunk: u32,
    total_chunks: u32,
    checksum: &str,
    data: &[u8],
    compressed: bool,
) -> Result<SyncChunkResult, String> {
    let boundary = format!("----ForgeSync{}", std::process::id());
    let mut body = Vec::new();
    multipart_field(&mut body, &boundary, "path", path);
    multipart_field(&mut body, &boundary, "chunk", &chunk.to_string());
    multipart_field(&mut body, &boundary, "totalChunks", &total_chunks.to_string());
    multipart_field(&mut body, &boundary, "checksum", checksum);
    multipart_field(
        &mut body,
        &boundary,
        "compressed",
        if compressed { "true" } else { "false" },
    );
    body.extend_from_slice(
        format!(
            "--{}\r\nContent-Disposition: form-data; name=\"data\"; filename=\"blob\"\r\nContent-Type: application/octet-stream\r\n\r\n",
            boundary
        )
        .as_bytes(),
    );
    body.extend_from_slice(data);
    body.extend_from_slice(format!("\r\n--{}--\r\n", boundary).as_bytes());

    let headers: Vec<(&str, String)> =
        vec![("Content-Type", format!("multipart/form-data; boundary={}", boundary))];

    let (status, resp) = raw_request_bytes(
        host.to_string(),
        port,
        token.to_string(),
        "POST".to_string(),
        "/api/sync/upload".to_string(),
        &headers,
        &body,
        30,
    )?;

    let text = String::from_utf8_lossy(&resp).to_string();
    if status >= 400 {
        return Err(format!("upload chunk {}: HTTP {} {}", chunk, status, text));
    }
    serde_json::from_str(&text).map_err(|e| format!("bad upload response: {}", e))
}

fn urlencode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}