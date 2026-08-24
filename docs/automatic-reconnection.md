# Automatic Reconnection Feature

## Overview

The ConnectionManager now includes automatic reconnection capabilities to handle network interruptions gracefully and maintain persistent connections to Forge OS devices.

## Features

### 1. Network Status Monitoring (Requirements 1.5, 1.6)

The ConnectionManager monitors network status using the browser's native APIs:

- **`navigator.onLine`**: Check current network status
- **`window.addEventListener('online')`**: Detect network recovery
- **`window.addEventListener('offline')`**: Detect network loss

```typescript
// Check if network is online
const isOnline = manager.isNetworkOnline();

// Listen for network status changes
manager.addEventListener((event) => {
  if (event.type === 'network-status-changed') {
    console.log(`Network is ${event.online ? 'online' : 'offline'}`);
  }
});
```

### 2. Automatic Reconnection (Requirement 1.5)

When the network comes back online, the ConnectionManager automatically attempts to reconnect within **5 seconds**.

**Behavior:**
- Network comes online → 5-second delay → Reconnection attempt
- Only reconnects if there was a previous connection
- Uses the same connection profile that was active
- Follows the same fallback strategy (TCP → ADB → Relay)

```typescript
// Automatic - no code required!
// When network recovers, reconnection happens automatically

// Optional: Listen for reconnection events
manager.addEventListener((event) => {
  if (event.type === 'connected') {
    console.log('Automatically reconnected!');
  }
  if (event.type === 'auto-reconnect-failed') {
    console.log('Auto-reconnect failed:', event.error);
  }
});
```

### 3. Device Rescan on Network Changes (Requirement 1.6)

When network status changes, the ConnectionManager emits a `rescan-requested` event to trigger device discovery.

```typescript
manager.addEventListener((event) => {
  if (event.type === 'rescan-requested') {
    console.log(`Rescan requested: ${event.reason}`);
    // Trigger your discovery service here
    discoveryService.rescan();
  }
});
```

### 4. Unreachability Detection (Requirement 1.7)

Devices are automatically marked as unreachable after **30 seconds** without successful contact.

**How it works:**
1. When connected, a 30-second timer starts
2. Each successful health check resets the timer via `recordSuccessfulContact()`
3. If 30 seconds pass without contact, the device is marked unreachable
4. A `device-unreachable` event is emitted

```typescript
// In your health monitor
async function healthCheck() {
  try {
    await checkStatus(config);
    // Reset the 30-second unreachability timer
    manager.recordSuccessfulContact();
  } catch (error) {
    // Don't call recordSuccessfulContact()
    // After 30s, device will be marked unreachable
  }
}

// Listen for unreachability
manager.addEventListener((event) => {
  if (event.type === 'device-unreachable') {
    console.log(`Device ${event.profile.name} is unreachable`);
  }
});
```

## API Reference

### New Methods

#### `recordSuccessfulContact(): void`

Records a successful contact with the device. This should be called after every successful health check or API request.

**Effect:** Resets the 30-second unreachability timer.

```typescript
// Call after successful health check
await checkStatus(config);
manager.recordSuccessfulContact();
```

#### `getLastSuccessfulContact(): number`

Returns the timestamp of the last successful contact.

```typescript
const lastContact = manager.getLastSuccessfulContact();
console.log(`Last contact: ${new Date(lastContact).toISOString()}`);
```

#### `isNetworkOnline(): boolean`

Returns the current network status.

```typescript
if (manager.isNetworkOnline()) {
  console.log('Network is available');
}
```

#### `cleanup(): void`

Stops all monitoring (network, timers). Call this when the ConnectionManager is no longer needed.

```typescript
// Cleanup before destroying the manager
manager.cleanup();
```

### New Events

#### `network-status-changed`

Emitted when network status changes.

```typescript
{
  type: 'network-status-changed',
  online: boolean  // true if online, false if offline
}
```

#### `rescan-requested`

Emitted when a device rescan should be triggered.

```typescript
{
  type: 'rescan-requested',
  reason: string  // e.g., 'network-change'
}
```

#### `device-unreachable`

Emitted when a device hasn't been contacted for 30 seconds.

```typescript
{
  type: 'device-unreachable',
  profile: ConnectionProfile
}
```

#### `auto-reconnect-failed`

Emitted when an automatic reconnection attempt fails.

```typescript
{
  type: 'auto-reconnect-failed',
  error: Error
}
```

## Integration with Health Monitor

The automatic reconnection feature works best when integrated with a health monitoring system:

```typescript
class HealthMonitor {
  private manager: ConnectionManager;
  private interval: number | null = null;

  constructor(manager: ConnectionManager) {
    this.manager = manager;
  }

  start() {
    this.interval = window.setInterval(async () => {
      if (!this.manager.isConnected()) return;

      try {
        const profile = this.manager.getCurrentProfile();
        const config = {
          host: profile.host,
          port: profile.port,
          token: profile.token,
        };

        await checkStatus(config);
        
        // IMPORTANT: Reset unreachability timer
        this.manager.recordSuccessfulContact();
        
        console.log('Health check passed');
      } catch (error) {
        console.error('Health check failed');
        // Don't call recordSuccessfulContact()
        // After 30s of failures, device will be marked unreachable
      }
    }, 10000); // Every 10 seconds
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
    }
  }
}
```

## Complete Workflow Example

```typescript
// 1. Initialize ConnectionManager
const manager = new ConnectionManager();
await manager.initialize();

// 2. Set up event listeners
manager.addEventListener((event) => {
  switch (event.type) {
    case 'network-status-changed':
      console.log(`Network ${event.online ? 'online' : 'offline'}`);
      break;

    case 'rescan-requested':
      // Trigger device discovery
      discoveryService.rescan();
      break;

    case 'device-unreachable':
      console.warn(`Device unreachable: ${event.profile.name}`);
      // Update UI to show offline status
      break;

    case 'connected':
      console.log('Connected to device');
      // Start health monitoring
      healthMonitor.start();
      break;

    case 'disconnected':
      console.log('Disconnected from device');
      // Stop health monitoring
      healthMonitor.stop();
      break;

    case 'auto-reconnect-failed':
      console.error('Auto-reconnect failed:', event.error);
      // Notify user
      break;
  }
});

// 3. Create and save profile
const profile = ConnectionManager.createProfile({
  name: 'My Device',
  deviceId: 'device-001',
  host: '192.168.1.100',
  port: 8789,
  token: 'my-token',
});

await manager.saveProfile(profile);

// 4. Connect
await manager.connect(profile);

// 5. Start health monitoring
const healthMonitor = new HealthMonitor(manager);
healthMonitor.start();

// Now automatic reconnection is active!
// - Network recovery triggers reconnection after 5s
// - Health checks keep the device marked as reachable
// - 30s without contact marks device unreachable
// - Network changes trigger device rescans
```

## Timeline Example

Here's what happens during a typical network interruption:

```
t=0s    Device connected, health checks running
t=10s   Health check ✓ → recordSuccessfulContact()
t=20s   Health check ✓ → recordSuccessfulContact()
t=25s   Network goes OFFLINE
        ↳ 'network-status-changed' event (online: false)
t=30s   Health check ✗ (network offline, no recordSuccessfulContact)
t=40s   Health check ✗ (network offline)
t=50s   Health check ✗ (network offline)
t=55s   (30s since last successful contact)
        ↳ 'device-unreachable' event
        ↳ Device marked as disconnected
t=60s   Network comes ONLINE
        ↳ 'network-status-changed' event (online: true)
        ↳ 'rescan-requested' event (reason: 'network-change')
        ↳ Reconnection scheduled (5-second delay)
t=65s   Reconnection attempt starts
        ↳ 'connection-attempt' event
t=66s   Connection successful
        ↳ 'connected' event
        ↳ recordSuccessfulContact() called
        ↳ Health monitoring resumes
t=76s   Health check ✓ → recordSuccessfulContact()
```

## Testing

### Manual Testing

You can manually test the network events in your browser console:

```javascript
// Simulate network going offline
window.dispatchEvent(new Event('offline'));

// Simulate network coming online
window.dispatchEvent(new Event('online'));
```

### Automated Testing

See `connectionManager.test.ts` for example test cases:

- `exampleNetworkMonitoring()` - Test network monitoring setup
- `exampleUnreachabilityTimeout()` - Test 30-second timeout
- `exampleAutoReconnectOnNetworkRecovery()` - Test 5-second reconnect delay
- `exampleSimulateNetworkEvents()` - Interactive testing helper

## Configuration

The timing constants are defined in the `ConnectionManager` class:

```typescript
private static readonly RECONNECT_DELAY_MS = 5000;      // 5 seconds
private static readonly UNREACHABLE_TIMEOUT_MS = 30000; // 30 seconds
```

These are currently fixed but could be made configurable if needed.

## Requirements Satisfied

- ✅ **Requirement 1.5**: Automatically reconnect within 5 seconds of network availability
- ✅ **Requirement 1.6**: Trigger rescan on network change events
- ✅ **Requirement 1.7**: Mark devices offline after 30 seconds of unreachability

## Notes

1. **Network Monitoring Lifecycle**: Network monitoring starts automatically when `initialize()` is called and continues until `cleanup()` is called.

2. **Timer Management**: All timers are properly cleaned up on disconnect or cleanup to prevent memory leaks.

3. **Event-Driven Architecture**: The feature uses events to decouple the ConnectionManager from UI and other components.

4. **Health Check Integration**: The feature assumes you have a health monitoring system that calls `recordSuccessfulContact()` on successful checks.

5. **Browser API Limitations**: The `navigator.onLine` API may not always accurately reflect network connectivity (e.g., it can show "online" when connected to a network that has no internet access). The unreachability timeout provides a more reliable indication of actual device reachability.

6. **Automatic vs Manual**: While reconnection is automatic, you can always trigger a manual reconnection with `manager.reconnect()` if needed.
