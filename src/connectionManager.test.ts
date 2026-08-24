/**
 * Example usage of ConnectionManager
 * 
 * This file demonstrates how to use the ConnectionManager to:
 * - Create connection profiles
 * - Save and load profiles
 * - Connect/disconnect from devices
 * - Listen to connection events
 * 
 * To verify the implementation manually:
 * 1. Import ConnectionManager in your app
 * 2. Initialize it: const manager = new ConnectionManager(); await manager.initialize();
 * 3. Create and save profiles
 * 4. Connect to a device
 * 
 * Note: This is an example file. A proper test suite would require setting up
 * a test framework like Vitest or Jest.
 */

import { ConnectionManager } from "./connectionManager";

/**
 * Example: Creating and saving a profile
 */
export async function exampleCreateProfile() {
  const manager = new ConnectionManager();
  await manager.initialize();

  // Create a new profile
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

  console.log("Profile saved:", profile.id);
}

/**
 * Example: Listing all profiles
 */
export async function exampleListProfiles() {
  const manager = new ConnectionManager();
  await manager.initialize();

  const profiles = manager.getProfiles();

  console.log("Available profiles:");
  for (const profile of profiles) {
    console.log(`- ${profile.name} (${profile.host}:${profile.port})`);
    console.log(`  Last connected: ${new Date(profile.lastConnected).toLocaleString()}`);
  }
}

/**
 * Example: Connecting to a device
 */
export async function exampleConnect() {
  const manager = new ConnectionManager();
  await manager.initialize();

  // Listen to connection events
  manager.addEventListener((event) => {
    console.log("Connection event:", event.type);

    if (event.type === "connected") {
      console.log("Connected to:", event.profile.name);
    } else if (event.type === "error") {
      console.error("Connection error:", event.error.message);
    } else if (event.type === "state-changed") {
      console.log("State changed to:", event.state);
    }
  });

  // Get first profile
  const profiles = manager.getProfiles();
  if (profiles.length === 0) {
    console.log("No profiles available");
    return;
  }

  // Connect
  try {
    await manager.connect(profiles[0]);
    console.log("Connection successful!");
    console.log("Current profile:", manager.getCurrentProfile()?.name);
  } catch (error) {
    console.error("Failed to connect:", error);
  }
}

/**
 * Example: Reconnecting
 */
export async function exampleReconnect(manager: ConnectionManager) {
  if (!manager.isConnected()) {
    console.log("Not connected, cannot reconnect");
    return;
  }

  try {
    await manager.reconnect();
    console.log("Reconnected successfully");
  } catch (error) {
    console.error("Failed to reconnect:", error);
  }
}

/**
 * Example: Deleting a profile
 */
export async function exampleDeleteProfile(profileId: string) {
  const manager = new ConnectionManager();
  await manager.initialize();

  await manager.deleteProfile(profileId);
  console.log("Profile deleted:", profileId);
}

/**
 * Example: Token encryption verification
 */
export async function exampleVerifyEncryption() {
  const manager = new ConnectionManager();
  await manager.initialize();

  const profile = ConnectionManager.createProfile({
    name: "Test Device",
    deviceId: "test-device",
    host: "192.168.1.100",
    port: 8789,
    token: "super-secret-token-123",
  });

  await manager.saveProfile(profile);

  // Check localStorage
  const stored = localStorage.getItem("forge_connection_profiles");
  if (stored) {
    console.log("Stored data (should not contain plaintext token):");
    console.log(stored);

    // Verify token is encrypted
    if (stored.includes("super-secret-token-123")) {
      console.error("ERROR: Plaintext token found in storage!");
    } else {
      console.log("✓ Token is encrypted in storage");
    }
  }

  // Verify decryption works
  const newManager = new ConnectionManager();
  await newManager.initialize();

  const loaded = newManager.getProfile(profile.id);
  if (loaded?.token === "super-secret-token-123") {
    console.log("✓ Token decryption works correctly");
  } else {
    console.error("ERROR: Token decryption failed");
  }
}

/**
 * Example: Complete workflow
 */
export async function exampleCompleteWorkflow() {
  console.log("=== Connection Manager Complete Workflow ===\n");

  // 1. Initialize
  console.log("1. Initializing ConnectionManager...");
  const manager = new ConnectionManager();
  await manager.initialize();

  // 2. Create profiles
  console.log("\n2. Creating profiles...");
  const profile1 = ConnectionManager.createProfile({
    name: "Home Device",
    deviceId: "home-device-001",
    host: "192.168.1.100",
    port: 8789,
    token: "token-home",
  });

  const profile2 = ConnectionManager.createProfile({
    name: "Work Device",
    deviceId: "work-device-002",
    host: "192.168.1.101",
    port: 8789,
    token: "token-work",
  });

  await manager.saveProfile(profile1);
  await manager.saveProfile(profile2);

  // 3. List profiles
  console.log("\n3. Available profiles:");
  const profiles = manager.getProfiles();
  profiles.forEach((p, i) => {
    console.log(`   ${i + 1}. ${p.name} (${p.host}:${p.port})`);
  });

  // 4. Set up event listener
  console.log("\n4. Setting up event listener...");
  manager.addEventListener((event) => {
    console.log(`   Event: ${event.type}`);
  });

  // 5. Connect
  console.log("\n5. Attempting connection...");
  try {
    await manager.connect(profile1);
    console.log("   ✓ Connected successfully");
  } catch (error) {
    console.log("   ✗ Connection failed (expected if no device available)");
  }

  // 6. Check state
  console.log("\n6. Connection state:", manager.getConnectionState());
  console.log("   Is connected:", manager.isConnected());
  console.log("   Current profile:", manager.getCurrentProfile()?.name || "none");

  // 7. Disconnect
  console.log("\n7. Disconnecting...");
  await manager.disconnect();
  console.log("   ✓ Disconnected");

  // 8. Verify persistence
  console.log("\n8. Verifying persistence...");
  const newManager = new ConnectionManager();
  await newManager.initialize();
  const loadedProfiles = newManager.getProfiles();
  console.log(`   ✓ Loaded ${loadedProfiles.length} profiles from storage`);

  console.log("\n=== Workflow Complete ===");
}

/**
 * Example: Connection fallback strategy
 * This demonstrates the TCP -> ADB -> Relay fallback logic
 */
export async function exampleConnectionFallback() {
  console.log("=== Connection Fallback Strategy Example ===\n");

  const manager = new ConnectionManager();
  await manager.initialize();

  // Create a profile
  const profile = ConnectionManager.createProfile({
    name: "Test Device",
    deviceId: "test-device",
    host: "192.168.1.100", // May not be reachable
    port: 8789,
    token: "test-token",
  });

  await manager.saveProfile(profile);

  // Listen to connection attempt events
  manager.addEventListener((event) => {
    if (event.type === "connection-attempt") {
      console.log(`Attempting connection via ${event.method.toUpperCase()} (attempt ${event.attempt})...`);
    } else if (event.type === "connection-method-failed") {
      console.log(`✗ ${event.method.toUpperCase()} failed: ${event.error}`);
    } else if (event.type === "connected") {
      console.log(`✓ Successfully connected via ${event.profile.connectionMethod.toUpperCase()}`);
    } else if (event.type === "error") {
      console.log(`✗ All connection methods failed: ${event.error.message}`);
    }
  });

  // Attempt connection - will try TCP first, then ADB, then Relay
  console.log("Starting connection with automatic fallback...\n");
  try {
    await manager.connect(profile);
    console.log("\nConnection established!");
    console.log(`Active connection method: ${manager.getActiveConnectionMethod()}`);
    console.log(`Host: ${manager.getCurrentProfile()?.host}`);
    console.log(`Port: ${manager.getCurrentProfile()?.port}`);
  } catch (error) {
    console.log("\nFailed to establish connection through any method");
    console.log(`Error: ${error instanceof Error ? error.message : String(error)}`);
  }

  console.log("\n=== Fallback Example Complete ===");
}

/**
 * Example: Monitoring connection methods
 * Shows how to track which connection method is being used
 */
export async function exampleMonitorConnectionMethod() {
  console.log("=== Connection Method Monitoring ===\n");

  const manager = new ConnectionManager();
  await manager.initialize();

  // Event listener with detailed logging
  manager.addEventListener((event) => {
    const timestamp = new Date().toISOString();
    
    switch (event.type) {
      case "connection-attempt":
        console.log(`[${timestamp}] Attempting ${event.method.toUpperCase()} connection (attempt ${event.attempt})`);
        break;
      case "connection-method-failed":
        console.log(`[${timestamp}] ${event.method.toUpperCase()} failed: ${event.error}`);
        break;
      case "connected":
        console.log(`[${timestamp}] Connected via ${event.profile.connectionMethod.toUpperCase()}`);
        console.log(`             Device: ${event.profile.name}`);
        console.log(`             Host: ${event.profile.host}:${event.profile.port}`);
        break;
      case "state-changed":
        console.log(`[${timestamp}] State changed: ${event.state}`);
        break;
      case "disconnected":
        console.log(`[${timestamp}] Disconnected${event.reason ? `: ${event.reason}` : ""}`);
        break;
      case "error":
        console.log(`[${timestamp}] Error: ${event.error.message}`);
        break;
    }
  });

  const profiles = manager.getProfiles();
  if (profiles.length > 0) {
    console.log("Connecting to first available profile...\n");
    try {
      await manager.connect(profiles[0]);
      console.log(`\nCurrent connection method: ${manager.getActiveConnectionMethod()}`);
    } catch (error) {
      console.log("\nConnection failed");
    }
  } else {
    console.log("No profiles available");
  }

  console.log("\n=== Monitoring Complete ===");
}


/**
 * Example: Testing network monitoring and automatic reconnection
 * Demonstrates Requirements 1.5, 1.6, 1.7
 */
export async function exampleNetworkMonitoring() {
  console.log("=== Network Monitoring & Auto Reconnection ===\n");

  const manager = new ConnectionManager();
  await manager.initialize();

  // Create a test profile
  const profile = ConnectionManager.createProfile({
    name: "Test Device",
    deviceId: "test-device",
    host: "192.168.1.100",
    port: 8789,
    token: "test-token",
  });

  await manager.saveProfile(profile);

  // Event listener for network and reconnection events
  manager.addEventListener((event) => {
    const timestamp = new Date().toISOString();
    
    switch (event.type) {
      case "network-status-changed":
        console.log(`[${timestamp}] Network status changed: ${event.online ? "ONLINE" : "OFFLINE"}`);
        break;
      case "rescan-requested":
        console.log(`[${timestamp}] Device rescan requested (${event.reason})`);
        break;
      case "device-unreachable":
        console.log(`[${timestamp}] Device marked unreachable: ${event.profile.name}`);
        break;
      case "auto-reconnect-failed":
        console.log(`[${timestamp}] Auto-reconnect failed: ${event.error.message}`);
        break;
      case "connected":
        console.log(`[${timestamp}] Connected to ${event.profile.name}`);
        break;
      case "disconnected":
        console.log(`[${timestamp}] Disconnected${event.reason ? `: ${event.reason}` : ""}`);
        break;
    }
  });

  // Check initial network status
  console.log(`Initial network status: ${manager.isNetworkOnline() ? "ONLINE" : "OFFLINE"}`);
  console.log(`Last successful contact: ${new Date(manager.getLastSuccessfulContact()).toISOString()}\n`);

  // Simulate connection attempt
  console.log("Attempting to connect...");
  try {
    await manager.connect(profile);
    console.log("✓ Connected successfully");
    console.log(`Last successful contact: ${new Date(manager.getLastSuccessfulContact()).toISOString()}\n`);
  } catch (error) {
    console.log("✗ Connection failed (expected if no device available)\n");
  }

  console.log("Network monitoring is active.");
  console.log("- When network comes online, reconnection will be attempted in 5 seconds");
  console.log("- If device is unreachable for 30 seconds, it will be marked offline");
  console.log("- Network changes will trigger device rescans\n");

  console.log("=== Monitoring Example Complete ===");
}

/**
 * Example: Testing unreachability timeout
 * Requirement 1.7: Mark devices offline after 30 seconds
 */
export async function exampleUnreachabilityTimeout() {
  console.log("=== Unreachability Timeout Test ===\n");

  const manager = new ConnectionManager();
  await manager.initialize();

  const profile = ConnectionManager.createProfile({
    name: "Test Device",
    deviceId: "test-device",
    host: "192.168.1.100",
    port: 8789,
    token: "test-token",
  });

  await manager.saveProfile(profile);

  manager.addEventListener((event) => {
    if (event.type === "device-unreachable") {
      const timeSinceContact = Date.now() - manager.getLastSuccessfulContact();
      console.log(`Device marked unreachable after ${timeSinceContact}ms`);
      console.log(`Expected: ~30000ms, Actual: ${timeSinceContact}ms`);
      
      if (timeSinceContact >= 30000 && timeSinceContact < 31000) {
        console.log("✓ Unreachability timeout working correctly");
      } else {
        console.log("✗ Unreachability timeout may be incorrect");
      }
    }
  });

  console.log("Note: To fully test this, you would need to:");
  console.log("1. Successfully connect to a device");
  console.log("2. Simulate 30 seconds of no successful contact");
  console.log("3. Observe the device-unreachable event\n");

  console.log("=== Unreachability Test Setup Complete ===");
}

/**
 * Example: Testing automatic reconnection on network recovery
 * Requirement 1.5: Reconnect within 5 seconds of network availability
 */
export async function exampleAutoReconnectOnNetworkRecovery() {
  console.log("=== Auto Reconnect on Network Recovery ===\n");

  const manager = new ConnectionManager();
  await manager.initialize();

  const profile = ConnectionManager.createProfile({
    name: "Test Device",
    deviceId: "test-device",
    host: "192.168.1.100",
    port: 8789,
    token: "test-token",
  });

  await manager.saveProfile(profile);

  let reconnectScheduled = false;
  let networkOnlineTime = 0;
  let reconnectAttemptTime = 0;

  manager.addEventListener((event) => {
    const timestamp = Date.now();

    if (event.type === "network-status-changed" && event.online) {
      networkOnlineTime = timestamp;
      console.log(`[${new Date(timestamp).toISOString()}] Network came online`);
      console.log("Reconnection should be attempted in ~5 seconds...");
      reconnectScheduled = true;
    }

    if (event.type === "connection-attempt" && reconnectScheduled) {
      reconnectAttemptTime = timestamp;
      const delay = reconnectAttemptTime - networkOnlineTime;
      console.log(`[${new Date(timestamp).toISOString()}] Reconnection attempt started`);
      console.log(`Delay: ${delay}ms (expected: ~5000ms)`);
      
      if (delay >= 5000 && delay < 6000) {
        console.log("✓ Reconnection timing is correct");
      } else {
        console.log("✗ Reconnection timing may be incorrect");
      }
      reconnectScheduled = false;
    }
  });

  console.log("Note: To fully test this, you would need to:");
  console.log("1. Connect to a device");
  console.log("2. Simulate network going offline (window.dispatchEvent(new Event('offline')))");
  console.log("3. Simulate network coming online (window.dispatchEvent(new Event('online')))");
  console.log("4. Observe reconnection attempt after ~5 seconds\n");

  console.log("=== Auto Reconnect Test Setup Complete ===");
}

/**
 * Example: Manual simulation of network events
 * This can be used in browser console for testing
 */
export async function exampleSimulateNetworkEvents() {
  console.log("=== Network Event Simulation ===\n");

  const manager = new ConnectionManager();
  await manager.initialize();

  const profile = ConnectionManager.createProfile({
    name: "Test Device",
    deviceId: "test-device",
    host: "192.168.1.100",
    port: 8789,
    token: "test-token",
  });

  await manager.saveProfile(profile);

  manager.addEventListener((event) => {
    console.log(`Event: ${event.type}`, event);
  });

  console.log("Manager initialized. You can now simulate events:");
  console.log("");
  console.log("// Simulate network going offline:");
  console.log("window.dispatchEvent(new Event('offline'));");
  console.log("");
  console.log("// Simulate network coming online:");
  console.log("window.dispatchEvent(new Event('online'));");
  console.log("");
  console.log("// Connect to device:");
  console.log("await manager.connect(profile);");
  console.log("");
  console.log("// Record successful contact (resets unreachability timer):");
  console.log("manager.recordSuccessfulContact();");
  console.log("");

  // Return manager so it can be used in console
  return manager;
}

/**
 * Example: Comprehensive automatic reconnection workflow
 */
export async function exampleComprehensiveAutoReconnect() {
  console.log("=== Comprehensive Auto Reconnection Workflow ===\n");

  const manager = new ConnectionManager();
  await manager.initialize();

  const profile = ConnectionManager.createProfile({
    name: "My Device",
    deviceId: "device-001",
    host: "192.168.1.100",
    port: 8789,
    token: "test-token",
  });

  await manager.saveProfile(profile);

  // Track events
  const events: Array<{ time: number; type: string; details: any }> = [];

  manager.addEventListener((event) => {
    const record = {
      time: Date.now(),
      type: event.type,
      details: event,
    };
    events.push(record);

    const timestamp = new Date(record.time).toISOString();
    console.log(`[${timestamp}] ${event.type}`);

    // Provide helpful details for specific events
    if (event.type === "network-status-changed") {
      console.log(`  Network is now ${event.online ? "ONLINE" : "OFFLINE"}`);
    } else if (event.type === "rescan-requested") {
      console.log(`  Rescan triggered by: ${event.reason}`);
    } else if (event.type === "device-unreachable") {
      console.log(`  Device: ${event.profile.name}`);
    } else if (event.type === "connection-attempt") {
      console.log(`  Method: ${event.method}, Attempt: ${event.attempt}`);
    }
  });

  console.log("\n--- Workflow Steps ---\n");
  console.log("1. Network monitoring is now active");
  console.log(`   Current status: ${manager.isNetworkOnline() ? "ONLINE" : "OFFLINE"}`);

  console.log("\n2. Features enabled:");
  console.log("   ✓ Automatic reconnection within 5 seconds of network recovery");
  console.log("   ✓ Device unreachability detection (30 second timeout)");
  console.log("   ✓ Automatic rescan on network changes");

  console.log("\n3. Event monitoring:");
  console.log("   Listening for: network-status-changed, rescan-requested,");
  console.log("                  device-unreachable, auto-reconnect-failed");

  console.log("\n4. To test the automatic reconnection:");
  console.log("   a. Connect to a device");
  console.log("   b. Trigger offline event: window.dispatchEvent(new Event('offline'))");
  console.log("   c. Trigger online event: window.dispatchEvent(new Event('online'))");
  console.log("   d. Observe reconnection attempt after 5 seconds");

  console.log("\n5. To test unreachability timeout:");
  console.log("   a. Connect to a device");
  console.log("   b. Wait 30 seconds without calling recordSuccessfulContact()");
  console.log("   c. Observe device-unreachable event");

  console.log("\n--- Summary ---");
  console.log(`Events captured: ${events.length}`);
  console.log(`Network online: ${manager.isNetworkOnline()}`);
  console.log(`Connected: ${manager.isConnected()}`);
  console.log(`Last contact: ${new Date(manager.getLastSuccessfulContact()).toISOString()}`);

  console.log("\n=== Workflow Complete ===");

  return { manager, events };
}
