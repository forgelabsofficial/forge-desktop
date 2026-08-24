mod forge;
mod sync;
mod diagnostics;
mod circuit;
mod clipboard;
mod notifications;
mod registry;
mod discovery;
mod secure_storage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_store::Builder::default().build())
    .plugin(tauri_plugin_notification::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      forge::forge_request,
      discovery::discover_devices,
      discovery::list_adb_devices,
      discovery::create_adb_tunnel,
      discovery::remove_adb_tunnel,
      secure_storage::store_token,
      secure_storage::get_token,
      secure_storage::delete_token,
      diagnostics::log_append,
      diagnostics::log_set_file_sink,
      diagnostics::diagnostics_collect,
      circuit::circuit_allow,
      circuit::circuit_report,
      circuit::circuit_reset,
      circuit::circuit_status,
      sync::sync_watch,
      sync::sync_unwatch,
      sync::sync_upload_file,
      sync::sync_download,
      sync::sync_stat,
      sync::sync_auto,
      clipboard::clipboard_start,
      clipboard::clipboard_stop,
      clipboard::clipboard_get,
      clipboard::clipboard_set,
      clipboard::clipboard_set_image,
      clipboard::clipboard_push,
      clipboard::clipboard_push_image,
      clipboard::clipboard_encrypt,
      clipboard::clipboard_decrypt,
      notifications::notify_show,
      registry::register_desktop_tool,
      registry::list_desktop_tools,
      registry::unregister_desktop_tool,
      registry::confirm_dialog
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
