# ConnectionManager Implementation

## Overview

The `ConnectionManager` class provides secure connection profile management for the Forge Desktop application. It handles device connections, profile storage, and token encryption.

## Features

- ✅ **Connection Profile Management**: Create, store, retrieve, and delete connection profiles
- ✅ **AES-256-GCM Token Encryption**: Securely encrypt connection tokens using Web Crypto API
- ✅ **Connection Lifecycle**: Connect, disconnect, and reconnect to devices
- ✅ **Event System**: Listen to connection state changes and events
- ✅ **Persistent Storage**: Store profiles in localStorage with encrypted tokens
- ✅ **Multiple Connection Methods**: Support for TCP, ADB, and relay connections

## Interfaces

### ConnectionProfile

```typescript
interface ConnectionProfile {
  id: string;                    // UUID
  name: string;                  // User-defined name
  deviceId: string;              // Device UUID from Android
  host: string;                  // IP or hostname
  port: number;                  // Default 8789
  token: string;                 // Encrypted Bearer token
  connectionMethod: "tcp" | "adb" | "relay";
  lastConnected: number;         // Unix timestamp
  deviceMetadata: {
    model: string;
    androidVersion: string;
    forgeOsVersion: string;
    capabilities: string[];
  };
}
```

### ConnectionState

```typescript
type ConnectionState = "disconnected" | "connecting" | "connected" | "error";
```

### ConnectionEvent

```typescript
type ConnectionEvent =
  | { type: "state-changed"; state: ConnectionState }
  | { type: "connected"; profile: ConnectionProfile }
  | { type: "disconnected"; reason?: string }
  | { type: "error"; error: Error };
```

## Usage

### Initialization

```typescript
import { ConnectionManager } from "./connectionManager";

// Create and initialize the manager
const manager = new ConnectionManager();
await manager.initialize();
```

### Creating a Profile

```typescript
const profile = ConnectionManager.createProfile({
  name: "My Pixel 7",
  deviceId: "device-abc-123",
  host: "192.168.1.100",
  port: 8789,
  token: "my-secret-token",
  connectionMethod: "tcp",
  deviceMetadata: {
    model: "Pixel 7",
    androidVersion: "14",
    forgeOsVersion: "1.0.0",
    capabilities: ["tools", "sync", "clipboard"],
  },
});

// Save the profile
await manager.saveProfile(profile);
```

### Listing Profiles

```typescript
const profiles = manager.getProfiles();
console.log("Available profiles:", profiles);

// Get a specific profile
const profile = manager.getProfile(profileId);
```

### Connecting to a Device

```typescript
// Set up event listener
manager.addEventListener((event) => {
  if (event.type === "connected") {
    console.log("Connected to:", event.profile.name);
  } else if (event.type === "error") {
    console.error("Connection error:", event.error);
  }
});

// Connect
try {
  await manager.connect(profile);
  console.log("Connected successfully!");
} catch (error) {
  console.error("Connection failed:", error);
}
```

### Checking Connection State

```typescript
const isConnected = manager.isConnected();
const state = manager.getConnectionState();
const currentProfile = manager.getCurrentProfile();
```

### Reconnecting

```typescript
if (manager.isConnected()) {
  await manager.reconnect();
}
```

### Disconnecting

```typescript
await manager.disconnect();
```

### Deleting a Profile

```typescript
await manager.deleteProfile(profileId);
```

## Security

### Token Encryption

Tokens are encrypted using **AES-256-GCM** before being stored in localStorage:

1. A persistent encryption key is generated on first use
2. Each token is encrypted with a unique initialization vector (IV)
3. The encrypted token and IV are stored together
4. On load, tokens are decrypted using the stored key and IV

### Storage Format

```json
{
  "id": "uuid",
  "name": "Device Name",
  "encryptedToken": "base64-encrypted-data",
  "tokenIv": "base64-iv",
  ...
}
```

The plaintext token is **never** stored in localStorage.

## Implementation Details

### Methods

#### Public Methods

- `initialize()`: Initialize the manager (must be called before use)
- `getProfiles()`: Get all connection profiles
- `getProfile(id)`: Get a specific profile by ID
- `saveProfile(profile)`: Save or update a profile
- `deleteProfile(id)`: Delete a profile
- `connect(profile)`: Connect to a device
- `disconnect()`: Disconnect from current device
- `reconnect()`: Reconnect to current device
- `getCurrentProfile()`: Get the currently connected profile
- `getConnectionState()`: Get the current connection state
- `isConnected()`: Check if currently connected
- `addEventListener(listener)`: Add an event listener
- `removeEventListener(listener)`: Remove an event listener

#### Static Methods

- `ConnectionManager.createProfile(params)`: Create a new profile with generated UUID

### Storage Keys

- `forge_connection_profiles`: localStorage key for profiles
- `forge_encryption_key`: localStorage key for encryption key

## Requirements Coverage

This implementation satisfies the following requirements from the design document:

- **Requirement 1.4**: Connection profile management with secure storage
- **Requirement 10.1**: Create and store named connection profiles
- **Requirement 10.2**: Store connection credentials (host, port, token, metadata)
- **Requirement 10.3**: Validate and use stored credentials for connections
- **Requirement 10.7**: Encrypt stored connection tokens

## Future Enhancements

- Connection timeout configuration
- Automatic reconnection with exponential backoff
- Connection quality metrics
- Token rotation support
- Multiple device connection support
- Connection method fallback (TCP → ADB → Relay)

## Example File

See `connectionManager.test.ts` for complete usage examples including:
- Creating and saving profiles
- Token encryption verification
- Connection lifecycle management
- Event handling
- Complete workflow demonstration
