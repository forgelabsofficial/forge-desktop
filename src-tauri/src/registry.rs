use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

/// Desktop Tool Registry (Task 12.1 / 12.3).
///
/// Stores metadata + JSON Schema for tools the device can invoke on the
/// desktop. Execution itself happens in the TS layer (handlers are JS
/// functions in `src/desktopTools.ts`); this module keeps the authoritative
/// registry visible to the backend and provides the native confirmation
/// dialog used before running sensitive tools.
#[derive(serde::Serialize, Clone)]
pub struct DesktopTool {
    pub name: String,
    pub description: String,
    pub parameters_schema: String, // JSON Schema (object form); serialized for the device
    pub requires_confirmation: bool,
}

static REGISTRY: LazyLock<Mutex<HashMap<String, DesktopTool>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn lock_registry() -> Result<std::sync::MutexGuard<'static, HashMap<String, DesktopTool>>, String> {
    REGISTRY.lock().map_err(|_| "tool registry lock poisoned".to_string())
}

/// Register (or replace) a desktop tool (Task 12.1).
#[tauri::command]
pub fn register_desktop_tool(
    name: String,
    description: String,
    parameters_schema: Option<String>,
    requires_confirmation: Option<bool>,
) -> Result<(), String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("tool name must not be empty".to_string());
    }

    let schema = parameters_schema.unwrap_or_else(|| "{\"type\":\"object\",\"properties\":{}}".to_string());
    // Validate that the schema is at least valid JSON before storing it.
    serde_json::from_str::<serde_json::Value>(&schema)
        .map_err(|e| format!("parameters_schema is not valid JSON: {}", e))?;

    let tool = DesktopTool {
        name: name.clone(),
        description: description.trim().to_string(),
        parameters_schema: schema,
        requires_confirmation: requires_confirmation.unwrap_or(false),
    };
    lock_registry()?.insert(name, tool);
    Ok(())
}

/// List all registered desktop tools.
#[tauri::command]
pub fn list_desktop_tools() -> Result<Vec<DesktopTool>, String> {
    let mut tools: Vec<DesktopTool> = lock_registry()?.values().cloned().collect();
    tools.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(tools)
}

/// Remove a registered desktop tool. Returns true when it existed.
#[tauri::command]
pub fn unregister_desktop_tool(name: String) -> Result<bool, String> {
    Ok(lock_registry()?.remove(&name).is_some())
}

/// Native Yes/No confirmation dialog (Task 12.3). Blocks until the user
/// answers. Sync Tauri commands run on the main thread, which is also what
/// native dialogs expect (notably macOS NSAlert). Uses `rfd` so no extra
/// plugin/capability configuration is needed.
#[tauri::command]
pub fn confirm_dialog(title: String, message: String) -> Result<bool, String> {
    Ok(rfd::MessageDialog::new()
        .set_title(&title)
        .set_description(&message)
        .set_buttons(rfd::MessageButtons::YesNo)
        .show()
        == rfd::MessageDialogResult::Yes)
}