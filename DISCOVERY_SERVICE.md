# Discovery Service Documentation

## Overview

The Discovery Service module provides device discovery and enumeration capabilities for the Forge Desktop application. It supports two methods for finding Forge OS devices:

1. **mDNS Discovery**: Automatic network discovery of devices advertising the `_forgeos._tcp.local` service
2. **ADB Device Enumeration**: Discovery of USB-connected devices via Android Debug Bridge

## Implementation Details

### Location
- Module: `src/discovery.rs`
- Exposed Tauri Commands:
  - `discover_devices`
  - `list_adb_devices`

### Dependencies
- `mdns-sd = "0.11"` - mDNS service discovery
- `flume = "0.11"` - Channel for receiving mDNS events
- `tokio` - Async runtime

## API Reference

### `discover_devices(timeout_secs: Option<u64>) -> Result<Vec<DeviceMetadata>, String>`

Discovers Forge OS devices on the local network using mDNS.

**Parameters:**
- `timeout_secs` (optional): Discovery timeout in seconds. Default: 5 seconds.

**Returns:**
- `Vec<DeviceMetadata>`: List of discovered devices

**Device Metadata Structure:**
```rust
pub struct DeviceMetadata {
    pub id: String,           // Device UUID
    pub version: String,      // Forge OS version
    pub model: String,        // Device model (e.g., "Pixel 7")
    pub capabilities: Vec<String>, // Supported features
    pub host: String,         // IP address or hostname
    pub port: u16,           // HTTP server port (typically 8789)
}
```

**TXT Record Parsing:**
The service parses the following TXT records from mDNS advertisements:
- `id` - Device unique identifier
- `version` - Forge OS version string
- `model` - Device model name
- `capabilities` - Comma-separated list of capabilities (e.g., "tools,sync,clipboard,notifications")

**Example Usage (from TypeScript/JavaScript):**
```typescript
import { invoke } from '@tauri-apps/api/core';

async function discoverDevices() {
  try {
    const devices = await invoke('discover_devices', { 
      timeoutSecs: 5 
    });
    console.log('Discovered devices:', devices);
    return devices;
  } catch (error) {
    console.error('Discovery failed:', error);
    throw error;
  }
}
```

### `list_adb_devices() -> Result<Vec<AdbDevice>, String>`

Lists Android devices connected via USB using ADB.

**Parameters:** None

**Returns:**
- `Vec<AdbDevice>`: List of ADB-connected devices

**ADB Device Structure:**
```rust
pub struct AdbDevice {
    pub serial: String,  // Device serial number
    pub state: String,   // Connection state (e.g., "device", "offline", "unauthorized")
}
```

**Requirements:**
- ADB (Android Debug Bridge) must be installed and available in system PATH
- USB debugging must be enabled on the Android device
- Device must be authorized for USB debugging

**Example Usage (from TypeScript/JavaScript):**
```typescript
import { invoke } from '@tauri-apps/api/core';

async function listAdbDevices() {
  try {
    const devices = await invoke('list_adb_devices');
    console.log('ADB devices:', devices);
    return devices;
  } catch (error) {
    console.error('ADB enumeration failed:', error);
    // Error message will indicate if ADB is not installed
    throw error;
  }
}
```

## Error Handling

Both commands return `Result<T, String>` types, with errors as string messages:

**Common Error Scenarios:**

1. **mDNS Discovery Errors:**
   - "Failed to create mDNS daemon: ..." - System doesn't support mDNS
   - "Failed to browse mDNS services: ..." - Network permissions issue
   - "mDNS event channel disconnected" - Internal communication failure

2. **ADB Enumeration Errors:**
   - "Failed to execute adb command: ... Is ADB installed and in PATH?" - ADB not found
   - "adb devices failed: ..." - ADB command execution failed

## Testing

### Unit Tests

The module includes unit tests for data serialization:

```bash
cargo test --lib discovery
```

Tests verify:
- DeviceMetadata serialization/deserialization
- AdbDevice serialization/deserialization

### Integration Tests

```bash
cargo test discovery_integration
```

**Note:** Full end-to-end testing requires:
- An actual Forge OS device on the network advertising mDNS services
- ADB-connected Android devices for ADB enumeration tests

## Network Requirements

### mDNS Discovery
- Devices must be on the same local network
- mDNS/Bonjour must not be blocked by firewall
- UDP port 5353 must be accessible
- The Android device must advertise the `_forgeos._tcp.local` service

### ADB Connection
- USB connection between desktop and device
- ADB server running on desktop
- USB debugging enabled on Android device
- Device authorized for debugging (RSA key accepted)

## Performance Considerations

1. **Discovery Timeout**: Default 5-second timeout balances discovery completeness with responsiveness. Adjust based on network conditions.

2. **Network Latency**: On slow networks, increase timeout to allow devices time to respond to mDNS queries.

3. **Multiple Devices**: Discovery scales well with multiple devices as mDNS is designed for service discovery.

4. **ADB Performance**: `adb devices` command typically completes in <1 second for local USB devices.

## Security Considerations

1. **Network Trust**: mDNS operates on the local network. Only discover devices on trusted networks.

2. **ADB Security**: ADB access provides significant device control. Ensure physical security of USB-connected devices.

3. **Device Validation**: Always validate device credentials and use the pairing flow before establishing connections.

## Implementation Validation

**Requirements Satisfied:**
- ✅ 1.1: Discovery Service scans local network for Forge_OS instances
- ✅ 1.2: Retrieves device metadata (name, version, capabilities)
- ✅ 13.7: Supports USB ADB connection detection

**Design Alignment:**
- ✅ Uses mdns-sd crate for mDNS service discovery
- ✅ Parses TXT records for device metadata
- ✅ Implements ADB device enumeration via command execution
- ✅ Exposes discover_devices() and list_adb_devices() Tauri commands
- ✅ Registered in lib.rs invoke_handler

## Future Enhancements

Potential improvements for future iterations:

1. **Continuous Discovery**: Background monitoring for device availability changes
2. **Device Caching**: Store recently seen devices for faster reconnection
3. **Network Change Detection**: Trigger rediscovery when network conditions change
4. **ADB Monitoring**: Watch for USB device attach/detach events
5. **IPv6 Support**: Ensure compatibility with IPv6-only networks
6. **Relay Server Discovery**: Support for discovering devices through relay servers
