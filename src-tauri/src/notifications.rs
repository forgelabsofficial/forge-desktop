use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use tauri_plugin_notification::NotificationExt;

/// Show a native desktop notification (Task 11.3).
/// `icon_b64` is a Base64-encoded PNG, written to a temp file so the
/// platform notification system can resolve it.
#[tauri::command]
pub fn notify_show(
    app: tauri::AppHandle,
    title: String,
    body: String,
    icon_b64: Option<String>,
) -> Result<(), String> {
    let mut builder = app.notification().builder().title(&title).body(&body);

    if let Some(b64) = icon_b64 {
        if let Ok(bytes) = B64.decode(b64) {
            if !bytes.is_empty() && bytes.len() <= 512 * 1024 {
                let stamp = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis())
                    .unwrap_or(0);
                let path = std::env::temp_dir().join(format!(
                    "forge-notif-{}-{}.png",
                    std::process::id(),
                    stamp
                ));
                if std::fs::write(&path, &bytes).is_ok() {
                    builder = builder.icon(path.to_string_lossy().to_string());
                }
            }
        }
    }

    builder.show().map_err(|e| e.to_string())
}