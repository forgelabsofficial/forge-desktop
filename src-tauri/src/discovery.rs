use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Command;
use std::time::Duration;

/// Device metadata extracted from mDNS TXT records
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceMetadata {
    pub id: String,
    pub version: String,
    pub model: String,
    pub capabilities: Vec<String>,
    pub host: String,
    pub port: u16,
}

/// ADB device information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdbDevice {
    pub serial: String,
    pub state: String,
}

/// Discover Forge OS devices on the local network using mDNS
/// Service type: _forgeos._tcp.local
#[tauri::command]
pub async fn discover_devices(timeout_secs: Option<u64>) -> Result<Vec<DeviceMetadata>, String> {
    let timeout = Duration::from_secs(timeout_secs.unwrap_or(5));
    
    // Create mDNS service discovery instance
    let mdns = mdns_sd::ServiceDaemon::new()
        .map_err(|e| format!("Failed to create mDNS daemon: {}", e))?;
    
    // Browse for _forgeos._tcp.local services
    let service_type = "_forgeos._tcp.local.";
    let receiver = mdns
        .browse(service_type)
        .map_err(|e| format!("Failed to browse mDNS services: {}", e))?;
    
    // Collect discovered devices
    let mut devices = Vec::new();
    let start = std::time::Instant::now();
    
    while start.elapsed() < timeout {
        // Try to receive events with a short timeout to allow checking overall timeout
        match receiver.recv_timeout(Duration::from_millis(100)) {
            Ok(event) => {
                match event {
                    mdns_sd::ServiceEvent::ServiceResolved(info) => {
                        log::info!("Discovered Forge OS device: {}", info.get_fullname());
                        
                        // Parse TXT records
                        let properties = info.get_properties();
                        let mut txt_map: HashMap<String, String> = HashMap::new();
                        
                        for prop in properties.iter() {
                            let key = prop.key();
                            let val = prop.val_str();
                            txt_map.insert(key.to_string(), val.to_string());
                        }
                        
                        // Extract device metadata from TXT records
                        let id = txt_map.get("id").cloned().unwrap_or_default();
                        let version = txt_map.get("version").cloned().unwrap_or_default();
                        let model = txt_map.get("model").cloned().unwrap_or_default();
                        let capabilities_str = txt_map.get("capabilities").cloned().unwrap_or_default();
                        let capabilities: Vec<String> = if capabilities_str.is_empty() {
                            Vec::new()
                        } else {
                            capabilities_str.split(',').map(|s| s.trim().to_string()).collect()
                        };
                        
                        // Get host and port
                        let addresses = info.get_addresses();
                        let host = if !addresses.is_empty() {
                            addresses.iter().next().unwrap().to_string()
                        } else {
                            info.get_hostname().to_string()
                        };
                        
                        let port = info.get_port();
                        
                        devices.push(DeviceMetadata {
                            id,
                            version,
                            model,
                            capabilities,
                            host,
                            port,
                        });
                    }
                    mdns_sd::ServiceEvent::SearchStarted(_) => {
                        log::debug!("mDNS search started");
                    }
                    mdns_sd::ServiceEvent::ServiceFound(_, _) => {
                        log::debug!("mDNS service found (resolving...)");
                    }
                    mdns_sd::ServiceEvent::ServiceRemoved(_, _) => {
                        log::debug!("mDNS service removed");
                    }
                    _ => {}
                }
            }
            Err(flume::RecvTimeoutError::Timeout) => {
                // Continue waiting until overall timeout
                continue;
            }
            Err(flume::RecvTimeoutError::Disconnected) => {
                log::warn!("mDNS event channel disconnected");
                break;
            }
        }
    }
    
    // Shutdown mDNS daemon
    mdns.shutdown()
        .map_err(|e| format!("Failed to shutdown mDNS daemon: {}", e))?;
    
    log::info!("Discovered {} Forge OS device(s)", devices.len());
    Ok(devices)
}

/// List ADB devices by executing `adb devices` command
#[tauri::command]
pub async fn list_adb_devices() -> Result<Vec<AdbDevice>, String> {
    // Execute `adb devices` command
    let output = Command::new("adb")
        .arg("devices")
        .output()
        .map_err(|e| format!("Failed to execute adb command: {}. Is ADB installed and in PATH?", e))?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("adb devices failed: {}", stderr));
    }
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    
    // Parse output
    // Format:
    // List of devices attached
    // <serial>\t<state>
    let mut devices = Vec::new();
    
    for line in stdout.lines().skip(1) { // Skip "List of devices attached" header
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 2 {
            devices.push(AdbDevice {
                serial: parts[0].to_string(),
                state: parts[1].to_string(),
            });
        }
    }
    
    log::info!("Found {} ADB device(s)", devices.len());
    Ok(devices)
}

/// Create an ADB port forward tunnel to enable local connection to device
/// This forwards a local port to the device's ForgeHttpServer port (default 8789)
/// Returns the local port that can be used to connect (usually same as remote_port)
#[tauri::command]
pub async fn create_adb_tunnel(
    serial: Option<String>,
    local_port: u16,
    remote_port: u16,
) -> Result<u16, String> {
    log::info!(
        "Creating ADB tunnel: local {} -> remote {}",
        local_port,
        remote_port
    );

    // Build adb command: adb [-s <serial>] forward tcp:<local_port> tcp:<remote_port>
    let mut cmd = Command::new("adb");
    
    // Add device serial if specified
    if let Some(ref serial) = serial {
        cmd.arg("-s").arg(serial);
    }
    
    cmd.arg("forward")
        .arg(format!("tcp:{}", local_port))
        .arg(format!("tcp:{}", remote_port));
    
    let output = cmd
        .output()
        .map_err(|e| format!("Failed to execute adb forward: {}. Is ADB installed and in PATH?", e))?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("adb forward failed: {}", stderr));
    }
    
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    log::info!("ADB tunnel created successfully: {}", stdout);
    
    Ok(local_port)
}

/// Remove an ADB port forward tunnel
#[tauri::command]
pub async fn remove_adb_tunnel(serial: Option<String>, local_port: u16) -> Result<(), String> {
    log::info!("Removing ADB tunnel on local port {}", local_port);

    let mut cmd = Command::new("adb");
    
    if let Some(ref serial) = serial {
        cmd.arg("-s").arg(serial);
    }
    
    cmd.arg("forward")
        .arg("--remove")
        .arg(format!("tcp:{}", local_port));
    
    let output = cmd
        .output()
        .map_err(|e| format!("Failed to execute adb forward --remove: {}", e))?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::warn!("Failed to remove ADB tunnel: {}", stderr);
        // Don't return error as the tunnel might already be removed
    } else {
        log::info!("ADB tunnel removed successfully");
    }
    
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_device_metadata_serialization() {
        let device = DeviceMetadata {
            id: "test-device-123".to_string(),
            version: "1.0.0".to_string(),
            model: "Pixel 7".to_string(),
            capabilities: vec!["tools".to_string(), "sync".to_string()],
            host: "192.168.1.100".to_string(),
            port: 8789,
        };

        // Test serialization
        let json = serde_json::to_string(&device).expect("Failed to serialize");
        assert!(json.contains("test-device-123"));
        assert!(json.contains("Pixel 7"));
        
        // Test deserialization
        let deserialized: DeviceMetadata = serde_json::from_str(&json).expect("Failed to deserialize");
        assert_eq!(deserialized.id, device.id);
        assert_eq!(deserialized.model, device.model);
        assert_eq!(deserialized.capabilities.len(), 2);
    }

    #[test]
    fn test_adb_device_serialization() {
        let device = AdbDevice {
            serial: "ABC123456".to_string(),
            state: "device".to_string(),
        };

        let json = serde_json::to_string(&device).expect("Failed to serialize");
        assert!(json.contains("ABC123456"));
        assert!(json.contains("device"));
    }
}
