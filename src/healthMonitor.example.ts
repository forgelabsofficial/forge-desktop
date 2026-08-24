/**
 * Example: Health Monitor Integration with Automatic Reconnection
 * 
 * This demonstrates how to integrate a health monitor with the ConnectionManager
 * to leverage automatic reconnection features.
 * 
 * Features demonstrated:
 * - Health check polling (Requirement 3)
 * - Automatic recordSuccessfulContact() on successful health checks
 * - Triggers unreachability timeout when health checks fail
 * - Automatic reconnection on network recovery
 */

import { ConnectionManager } from "./connectionManager";
import { checkStatus } from "./api";
import type { ConnectionConfig } from "./types";

export class HealthMonitorExample {
  private manager: ConnectionManager;
  private healthCheckInterval: number | null = null;
  private readonly HEALTH_CHECK_INTERVAL_MS = 10000; // 10 seconds (Requirement 3.1)
  private consecutiveFailures = 0;
  private readonly MAX_CONSECUTIVE_FAILURES = 3; // Requirement 3.3

  constructor(manager: ConnectionManager) {
    this.manager = manager;
  }

  /**
   * Start health monitoring
   */
  start(): void {
    if (this.healthCheckInterval !== null) {
      console.log("[HealthMonitor] Already running");
      return;
    }

    console.log("[HealthMonitor] Starting health checks every 10 seconds");

    // Initial check
    this.performHealthCheck();

    // Schedule periodic checks
    this.healthCheckInterval = window.setInterval(() => {
      this.performHealthCheck();
    }, this.HEALTH_CHECK_INTERVAL_MS);
  }

  /**
   * Stop health monitoring
   */
  stop(): void {
    if (this.healthCheckInterval !== null) {
      window.clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      console.log("[HealthMonitor] Stopped");
    }
  }

  /**
   * Perform a health check
   */
  private async performHealthCheck(): Promise<void> {
    const profile = this.manager.getCurrentProfile();

    // Only check if connected
    if (!this.manager.isConnected() || !profile) {
      return;
    }

    const startTime = Date.now();

    try {
      const config: ConnectionConfig = {
        host: profile.host,
        port: profile.port,
        token: profile.token,
      };

      const status = await checkStatus(config);
      const latency = Date.now() - startTime;

      // Requirement 3.2: Display "Connected" on successful response
      console.log(`[HealthMonitor] ✓ Health check passed (${latency}ms)`);
      console.log(`[HealthMonitor] Server status: ${status.status}`);

      // Reset failure count
      this.consecutiveFailures = 0;

      // IMPORTANT: Record successful contact to reset unreachability timer
      // Requirement 1.7: This prevents the 30-second unreachability timeout
      this.manager.recordSuccessfulContact();

      // Requirement 3.5: Warn if latency exceeds 1000ms
      if (latency > 1000) {
        console.warn(`[HealthMonitor] ⚠ High latency detected: ${latency}ms`);
      }

    } catch (error) {
      this.consecutiveFailures++;
      const latency = Date.now() - startTime;

      console.error(`[HealthMonitor] ✗ Health check failed (${latency}ms)`);
      console.error(`[HealthMonitor] Consecutive failures: ${this.consecutiveFailures}/${this.MAX_CONSECUTIVE_FAILURES}`);

      // Requirement 3.3: Mark as disconnected after 3 consecutive failures
      if (this.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
        console.error(`[HealthMonitor] Maximum consecutive failures reached`);
        console.error(`[HealthMonitor] Device will be marked unreachable in 30 seconds if contact is not restored`);
        
        // The ConnectionManager's unreachability timer (30 seconds) will handle
        // marking the device as offline automatically
      }

      // Note: We don't call recordSuccessfulContact() on failure
      // This allows the 30-second unreachability timer to eventually fire
    }
  }
}

/**
 * Example: Complete workflow with health monitoring and auto-reconnection
 */
export async function exampleHealthMonitorWithAutoReconnect() {
  console.log("=== Health Monitor + Auto Reconnection Example ===\n");

  // 1. Setup ConnectionManager
  const manager = new ConnectionManager();
  await manager.initialize();

  // 2. Create and save a profile
  const profile = ConnectionManager.createProfile({
    name: "My Device",
    deviceId: "device-001",
    host: "192.168.1.100",
    port: 8789,
    token: "test-token",
  });

  await manager.saveProfile(profile);

  // 3. Setup event monitoring
  manager.addEventListener((event) => {
    const timestamp = new Date().toISOString();

    switch (event.type) {
      case "connected":
        console.log(`[${timestamp}] CONNECTED to ${event.profile.name}`);
        break;

      case "disconnected":
        console.log(`[${timestamp}] DISCONNECTED${event.reason ? `: ${event.reason}` : ""}`);
        break;

      case "device-unreachable":
        console.log(`[${timestamp}] DEVICE UNREACHABLE: ${event.profile.name}`);
        console.log(`  → Device was unreachable for 30+ seconds`);
        break;

      case "network-status-changed":
        console.log(`[${timestamp}] NETWORK ${event.online ? "ONLINE" : "OFFLINE"}`);
        if (event.online) {
          console.log(`  → Reconnection will be attempted in 5 seconds`);
        }
        break;

      case "rescan-requested":
        console.log(`[${timestamp}] RESCAN REQUESTED (${event.reason})`);
        console.log(`  → Discovery service should rescan for devices`);
        break;

      case "auto-reconnect-failed":
        console.log(`[${timestamp}] AUTO-RECONNECT FAILED: ${event.error.message}`);
        break;

      case "connection-attempt":
        console.log(`[${timestamp}] Connection attempt ${event.attempt} via ${event.method}`);
        break;
    }
  });

  // 4. Create health monitor
  const healthMonitor = new HealthMonitorExample(manager);

  // 5. Connect to device
  console.log("Attempting to connect...");
  try {
    await manager.connect(profile);
    console.log("✓ Connected successfully\n");

    // 6. Start health monitoring
    healthMonitor.start();
    console.log("✓ Health monitoring started\n");

    console.log("--- System Overview ---");
    console.log("✓ Connection established");
    console.log("✓ Health checks running every 10 seconds");
    console.log("✓ Network monitoring active");
    console.log("✓ Automatic reconnection enabled");
    console.log("✓ Unreachability detection active (30s timeout)\n");

    console.log("--- Behavior ---");
    console.log("• Successful health checks reset the 30s unreachability timer");
    console.log("• 3 consecutive failed health checks indicate connection issues");
    console.log("• If no successful contact for 30s, device marked unreachable");
    console.log("• Network recovery triggers auto-reconnect after 5s");
    console.log("• Network changes trigger device rescan\n");

  } catch (error) {
    console.log("✗ Connection failed (expected if no device available)");
    console.log(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  }

  console.log("=== Example Complete ===");
  console.log("Note: In a real app, you would keep this running and handle events");

  return { manager, healthMonitor };
}

/**
 * Example: Demonstrating the 30-second unreachability timeout
 */
export async function exampleUnreachabilityWithHealthMonitor() {
  console.log("=== 30-Second Unreachability Timeout Demo ===\n");

  const manager = new ConnectionManager();
  await manager.initialize();

  // Note: Profile would be created and saved here in a real scenario

  // Track when device becomes unreachable
  let unreachableTime: number | null = null;
  let lastContactTime: number | null = null;

  manager.addEventListener((event) => {
    if (event.type === "connected") {
      console.log("Device connected");
      lastContactTime = Date.now();
      console.log(`Last contact time: ${new Date(lastContactTime).toISOString()}`);
    }

    if (event.type === "device-unreachable") {
      unreachableTime = Date.now();
      console.log("\n⚠️  DEVICE MARKED UNREACHABLE");

      if (lastContactTime) {
        const elapsed = unreachableTime - lastContactTime;
        console.log(`Time since last contact: ${elapsed}ms (~${(elapsed / 1000).toFixed(1)}s)`);
        console.log(`Expected: ~30000ms (30s)`);

        if (elapsed >= 30000 && elapsed < 31000) {
          console.log("✓ Timeout is working correctly");
        }
      }
    }
  });

  console.log("Scenario: Device becomes unreachable");
  console.log("Expected: Device marked unreachable after 30 seconds\n");

  console.log("To test:");
  console.log("1. Connect to a device");
  console.log("2. Stop calling manager.recordSuccessfulContact()");
  console.log("3. Wait 30 seconds");
  console.log("4. Observe device-unreachable event\n");

  console.log("In a real application:");
  console.log("- Health monitor calls recordSuccessfulContact() on each successful check");
  console.log("- If health checks start failing, no more recordSuccessfulContact() calls");
  console.log("- After 30s of failures, device is marked unreachable");
  console.log("- Network recovery triggers automatic reconnection\n");

  console.log("=== Demo Setup Complete ===");
}

/**
 * Example: Network recovery scenario
 */
export async function exampleNetworkRecoveryScenario() {
  console.log("=== Network Recovery Scenario ===\n");

  const manager = new ConnectionManager();
  await manager.initialize();

  const profile = ConnectionManager.createProfile({
    name: "Mobile Device",
    deviceId: "mobile-001",
    host: "192.168.1.100",
    port: 8789,
    token: "test-token",
  });

  await manager.saveProfile(profile);

  // Track timeline
  let offlineTime: number | null = null;
  let onlineTime: number | null = null;
  let reconnectTime: number | null = null;

  manager.addEventListener((event) => {
    const now = Date.now();

    if (event.type === "network-status-changed" && !event.online) {
      offlineTime = now;
      console.log(`[${new Date(now).toISOString()}] Network went OFFLINE`);
    }

    if (event.type === "network-status-changed" && event.online) {
      onlineTime = now;
      console.log(`[${new Date(now).toISOString()}] Network came ONLINE`);
      console.log("  → Automatic reconnection scheduled for 5 seconds from now");
    }

    if (event.type === "connection-attempt" && onlineTime) {
      reconnectTime = now;
      const delay = reconnectTime - onlineTime;
      console.log(`[${new Date(now).toISOString()}] Reconnection attempt started`);
      console.log(`  Delay: ${delay}ms (expected: ~5000ms)`);

      if (delay >= 5000 && delay < 6000) {
        console.log("  ✓ Timing is correct (Requirement 1.5 satisfied)");
      }
    }

    if (event.type === "connected") {
      console.log(`[${new Date(now).toISOString()}] RECONNECTED successfully`);
      
      if (offlineTime) {
        const totalDowntime = now - offlineTime;
        console.log(`  Total downtime: ${totalDowntime}ms (~${(totalDowntime / 1000).toFixed(1)}s)`);
      }
    }

    if (event.type === "rescan-requested") {
      console.log(`[${new Date(now).toISOString()}] Device rescan requested`);
      console.log("  → Discovery service should look for available devices");
    }
  });

  console.log("Scenario: Network goes offline, then recovers\n");
  console.log("Expected behavior:");
  console.log("1. Network goes offline → No immediate action");
  console.log("2. Network comes online → Reconnect scheduled (+0s)");
  console.log("3. Rescan requested → Discovery looks for devices (+0s)");
  console.log("4. Reconnection attempt → Tries to connect (+5s)");
  console.log("5. Connection restored → Back online (+5s)\n");

  console.log("To simulate:");
  console.log("  window.dispatchEvent(new Event('offline'));");
  console.log("  // Wait a moment...");
  console.log("  window.dispatchEvent(new Event('online'));\n");

  console.log("=== Scenario Setup Complete ===");
}
