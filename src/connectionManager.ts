import { checkStatus } from "./api";
import type { ConnectionConfig } from "./types";

/**
 * Connection profile with encrypted token storage
 */
export interface ConnectionProfile {
  id: string; // UUID
  name: string; // User-defined name
  deviceId: string; // Device UUID from Android
  host: string; // IP or hostname
  port: number; // Default 8789
  token: string; // Encrypted Bearer token
  connectionMethod: "tcp" | "adb" | "relay";
  lastConnected: number; // Unix timestamp
  deviceMetadata: {
    model: string;
    androidVersion: string;
    forgeOsVersion: string;
    capabilities: string[];
  };
}

/**
 * Stored profile structure (token is encrypted)
 */
interface StoredProfile extends Omit<ConnectionProfile, "token"> {
  encryptedToken: string;
  tokenIv: string; // Initialization vector for AES-GCM
}

/**
 * Connection state
 */
export type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

/**
 * Connection event types
 */
export type ConnectionEvent =
  | { type: "state-changed"; state: ConnectionState }
  | { type: "connected"; profile: ConnectionProfile }
  | { type: "disconnected"; reason?: string }
  | { type: "error"; error: Error }
  | { type: "connection-attempt"; method: ConnectionProfile["connectionMethod"]; attempt: number }
  | { type: "connection-method-failed"; method: ConnectionProfile["connectionMethod"]; error: string }
  | { type: "network-status-changed"; online: boolean }
  | { type: "rescan-requested"; reason: string }
  | { type: "device-unreachable"; profile: ConnectionProfile }
  | { type: "auto-reconnect-failed"; error: Error };

/**
 * Event listener callback
 */
export type ConnectionEventListener = (event: ConnectionEvent) => void;

/**
 * ConnectionManager manages device connections and profiles.
 * 
 * Features:
 * - Store and manage connection profiles
 * - Encrypt tokens using AES-256-GCM
 * - Connect, disconnect, and reconnect to devices
 * - Event-based connection state management
 * - Automatic reconnection on network recovery
 * - Device unreachability detection
 */
export class ConnectionManager {
  private static readonly STORAGE_KEY = "forge_connection_profiles";
  private static readonly ENCRYPTION_KEY_NAME = "forge_encryption_key";
  private static readonly RECONNECT_DELAY_MS = 5000; // 5 seconds
  private static readonly UNREACHABLE_TIMEOUT_MS = 30000; // 30 seconds

  private profiles: Map<string, ConnectionProfile> = new Map();
  private encryptionKey: CryptoKey | null = null;
  private currentProfile: ConnectionProfile | null = null;
  private connectionState: ConnectionState = "disconnected";
  private listeners: Set<ConnectionEventListener> = new Set();
  
  // Network monitoring
  private networkOnline: boolean = true;
  private reconnectTimer: number | null = null;
  private unreachableTimer: number | null = null;
  private lastSuccessfulContact: number = Date.now();
  private isMonitoringNetwork: boolean = false;

  constructor() {
    // Initialize will be called separately
  }

  /**
   * Initialize the connection manager (async initialization)
   */
  async initialize(): Promise<void> {
    this.encryptionKey = await this.getOrCreateEncryptionKey();
    await this.loadProfiles();
    this.startNetworkMonitoring();
  }

  /**
   * Start monitoring network status for automatic reconnection
   * Requirement 1.5: Automatically reconnect within 5 seconds of network availability
   * Requirement 1.6: Rescan on network change events
   */
  private startNetworkMonitoring(): void {
    if (this.isMonitoringNetwork) {
      return;
    }

    this.isMonitoringNetwork = true;
    this.networkOnline = navigator.onLine;

    // Listen for online event
    window.addEventListener('online', this.handleNetworkOnline);
    
    // Listen for offline event
    window.addEventListener('offline', this.handleNetworkOffline);

    console.log('[ConnectionManager] Network monitoring started');
  }

  /**
   * Stop monitoring network status
   */
  private stopNetworkMonitoring(): void {
    if (!this.isMonitoringNetwork) {
      return;
    }

    window.removeEventListener('online', this.handleNetworkOnline);
    window.removeEventListener('offline', this.handleNetworkOffline);
    
    this.clearReconnectTimer();
    this.clearUnreachableTimer();
    
    this.isMonitoringNetwork = false;
    console.log('[ConnectionManager] Network monitoring stopped');
  }

  /**
   * Handle network coming online
   * Requirement 1.5: Automatically reconnect within 5 seconds
   * Requirement 1.6: Trigger rescan on network change events
   */
  private handleNetworkOnline = (): void => {
    console.log('[ConnectionManager] Network online detected');
    this.networkOnline = true;

    this.emitEvent({
      type: 'network-status-changed',
      online: true,
    } as any);

    // If we have a profile but are disconnected, schedule reconnection
    if (this.currentProfile && this.connectionState !== 'connected') {
      this.scheduleReconnect();
    }

    // Trigger device rescan (emit event for discovery service)
    this.emitEvent({
      type: 'rescan-requested',
      reason: 'network-change',
    } as any);
  }

  /**
   * Handle network going offline
   */
  private handleNetworkOffline = (): void => {
    console.log('[ConnectionManager] Network offline detected');
    this.networkOnline = false;

    this.emitEvent({
      type: 'network-status-changed',
      online: false,
    } as any);

    this.clearReconnectTimer();
  }

  /**
   * Schedule automatic reconnection after network recovery
   * Requirement 1.5: Reconnect within 5 seconds
   */
  private scheduleReconnect(): void {
    this.clearReconnectTimer();

    console.log(`[ConnectionManager] Scheduling reconnect in ${ConnectionManager.RECONNECT_DELAY_MS}ms`);

    this.reconnectTimer = window.setTimeout(() => {
      this.attemptAutoReconnect();
    }, ConnectionManager.RECONNECT_DELAY_MS);
  }

  /**
   * Attempt automatic reconnection
   */
  private async attemptAutoReconnect(): Promise<void> {
    if (!this.currentProfile || !this.networkOnline) {
      return;
    }

    console.log('[ConnectionManager] Attempting automatic reconnection...');

    try {
      await this.reconnect();
      console.log('[ConnectionManager] Automatic reconnection successful');
    } catch (error) {
      console.error('[ConnectionManager] Automatic reconnection failed:', error);
      this.emitEvent({
        type: 'auto-reconnect-failed',
        error: error instanceof Error ? error : new Error(String(error)),
      } as any);
    }
  }

  /**
   * Start unreachability timer
   * Requirement 1.7: Mark device offline after 30 seconds of unreachability
   */
  private startUnreachableTimer(): void {
    this.clearUnreachableTimer();

    this.unreachableTimer = window.setTimeout(() => {
      this.markDeviceUnreachable();
    }, ConnectionManager.UNREACHABLE_TIMEOUT_MS);
  }

  /**
   * Clear unreachability timer
   */
  private clearUnreachableTimer(): void {
    if (this.unreachableTimer !== null) {
      window.clearTimeout(this.unreachableTimer);
      this.unreachableTimer = null;
    }
  }

  /**
   * Clear reconnect timer
   */
  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Mark the current device as unreachable
   * Requirement 1.7: Mark devices offline after 30 seconds
   */
  private markDeviceUnreachable(): void {
    if (!this.currentProfile) {
      return;
    }

    console.log(`[ConnectionManager] Device ${this.currentProfile.name} marked as unreachable`);

    this.emitEvent({
      type: 'device-unreachable',
      profile: this.currentProfile,
    } as any);

    // Transition to disconnected state
    if (this.connectionState === 'connected') {
      this.setConnectionState('disconnected');
      this.emitEvent({
        type: 'disconnected',
        reason: 'unreachable-timeout',
      });
    }
  }

  /**
   * Record successful contact with device
   * Resets unreachability timer
   */
  recordSuccessfulContact(): void {
    this.lastSuccessfulContact = Date.now();
    this.clearUnreachableTimer();
    
    // If connected, start monitoring for unreachability
    if (this.connectionState === 'connected') {
      this.startUnreachableTimer();
    }
  }

  /**
   * Get last successful contact timestamp
   */
  getLastSuccessfulContact(): number {
    return this.lastSuccessfulContact;
  }

  /**
   * Check if network is online
   */
  isNetworkOnline(): boolean {
    return this.networkOnline;
  }

  /**
   * Get or create a persistent encryption key for token encryption
   */
  private async getOrCreateEncryptionKey(): Promise<CryptoKey> {
    // Try to load existing key from IndexedDB or generate new one
    const keyData = localStorage.getItem(ConnectionManager.ENCRYPTION_KEY_NAME);

    if (keyData) {
      try {
        const keyBytes = this.base64ToArrayBuffer(keyData);
        return await crypto.subtle.importKey(
          "raw",
          keyBytes,
          { name: "AES-GCM", length: 256 },
          false,
          ["encrypt", "decrypt"]
        );
      } catch (error) {
        console.warn("Failed to load encryption key, generating new one:", error);
      }
    }

    // Generate new key
    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );

    // Export and store the key
    const exportedKey = await crypto.subtle.exportKey("raw", key);
    localStorage.setItem(
      ConnectionManager.ENCRYPTION_KEY_NAME,
      this.arrayBufferToBase64(exportedKey)
    );

    return key;
  }

  /**
   * Encrypt a token using AES-256-GCM
   */
  private async encryptToken(token: string): Promise<{ encrypted: string; iv: string }> {
    if (!this.encryptionKey) {
      throw new Error("Encryption key not initialized");
    }

    const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for GCM
    const encodedToken = new TextEncoder().encode(token);

    const encryptedBuffer = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      this.encryptionKey,
      encodedToken
    );

    return {
      encrypted: this.arrayBufferToBase64(encryptedBuffer),
      iv: this.arrayBufferToBase64(iv.buffer),
    };
  }

  /**
   * Decrypt a token using AES-256-GCM
   */
  private async decryptToken(encrypted: string, ivBase64: string): Promise<string> {
    if (!this.encryptionKey) {
      throw new Error("Encryption key not initialized");
    }

    const encryptedBuffer = this.base64ToArrayBuffer(encrypted);
    const iv = this.base64ToArrayBuffer(ivBase64);

    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      this.encryptionKey,
      encryptedBuffer
    );

    return new TextDecoder().decode(decryptedBuffer);
  }

  /**
   * Load profiles from localStorage
   */
  private async loadProfiles(): Promise<void> {
    const stored = localStorage.getItem(ConnectionManager.STORAGE_KEY);
    if (!stored) return;

    try {
      const storedProfiles: StoredProfile[] = JSON.parse(stored);

      for (const stored of storedProfiles) {
        const token = await this.decryptToken(stored.encryptedToken, stored.tokenIv);
        const profile: ConnectionProfile = {
          ...stored,
          token,
        };
        // Remove encrypted fields from the runtime profile
        delete (profile as any).encryptedToken;
        delete (profile as any).tokenIv;

        this.profiles.set(profile.id, profile);
      }
    } catch (error) {
      console.error("Failed to load profiles:", error);
    }
  }

  /**
   * Save profiles to localStorage
   */
  private async saveProfiles(): Promise<void> {
    const storedProfiles: StoredProfile[] = [];

    for (const profile of this.profiles.values()) {
      const { encrypted, iv } = await this.encryptToken(profile.token);

      const storedProfile: StoredProfile = {
        id: profile.id,
        name: profile.name,
        deviceId: profile.deviceId,
        host: profile.host,
        port: profile.port,
        encryptedToken: encrypted,
        tokenIv: iv,
        connectionMethod: profile.connectionMethod,
        lastConnected: profile.lastConnected,
        deviceMetadata: profile.deviceMetadata,
      };

      storedProfiles.push(storedProfile);
    }

    localStorage.setItem(ConnectionManager.STORAGE_KEY, JSON.stringify(storedProfiles));
  }

  /**
   * Get all connection profiles
   */
  getProfiles(): ConnectionProfile[] {
    return Array.from(this.profiles.values());
  }

  /**
   * Get a specific profile by ID
   */
  getProfile(id: string): ConnectionProfile | undefined {
    return this.profiles.get(id);
  }

  /**
   * Save or update a connection profile
   */
  async saveProfile(profile: ConnectionProfile): Promise<void> {
    this.profiles.set(profile.id, profile);
    await this.saveProfiles();
  }

  /**
   * Delete a connection profile
   */
  async deleteProfile(id: string): Promise<void> {
    if (this.currentProfile?.id === id) {
      await this.disconnect();
    }
    this.profiles.delete(id);
    await this.saveProfiles();
  }

  /**
   * Connect to a device using a profile
   */
  async connect(profile: ConnectionProfile): Promise<void> {
    this.setConnectionState("connecting");
    this.clearReconnectTimer(); // Clear any pending reconnect attempts

    try {
      // Attempt connection using fallback strategy: TCP -> ADB -> Relay
      const connectionMethods: Array<ConnectionProfile["connectionMethod"]> = ["tcp", "adb", "relay"];
      let lastError: Error | null = null;

      for (let i = 0; i < connectionMethods.length; i++) {
        const method = connectionMethods[i];
        
        this.emitEvent({
          type: "connection-attempt",
          method,
          attempt: i + 1,
        });

        console.log(`[ConnectionManager] Attempting connection via ${method.toUpperCase()}...`);

        try {
          await this.tryConnectionMethod(profile, method);
          
          // Connection successful - update profile
          profile.connectionMethod = method;
          profile.lastConnected = Date.now();
          await this.saveProfile(profile);

          this.currentProfile = profile;
          this.setConnectionState("connected");
          this.recordSuccessfulContact(); // Start unreachability monitoring
          this.emitEvent({ type: "connected", profile });
          
          console.log(`[ConnectionManager] Successfully connected via ${method.toUpperCase()}`);
          return;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.warn(`[ConnectionManager] ${method.toUpperCase()} connection failed:`, errorMessage);
          
          this.emitEvent({
            type: "connection-method-failed",
            method,
            error: errorMessage,
          });

          lastError = error instanceof Error ? error : new Error(String(error));
        }
      }

      // All connection methods failed
      throw lastError || new Error("All connection methods failed");
    } catch (error) {
      this.setConnectionState("error");
      this.emitEvent({
        type: "error",
        error: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }
  }

  /**
   * Try connecting using a specific method
   */
  private async tryConnectionMethod(
    profile: ConnectionProfile,
    method: ConnectionProfile["connectionMethod"]
  ): Promise<void> {
    switch (method) {
      case "tcp":
        return this.tryTcpConnection(profile);
      case "adb":
        return this.tryAdbConnection(profile);
      case "relay":
        return this.tryRelayConnection(profile);
      default:
        throw new Error(`Unknown connection method: ${method}`);
    }
  }

  /**
   * Attempt TCP connection using fetch() to /api/status
   */
  private async tryTcpConnection(profile: ConnectionProfile): Promise<void> {
    console.log(`[ConnectionManager] TCP: Testing connection to http://${profile.host}:${profile.port}/api/status`);

    const config: ConnectionConfig = {
      host: profile.host,
      port: profile.port,
      token: profile.token,
    };

    // Test connection by calling status endpoint (with profile for token rotation)
    const status = await checkStatus(config, profile);

    if (!status.running) {
      throw new Error("Device server is not running");
    }

    console.log(`[ConnectionManager] TCP: Connection successful, server status: ${status.status}`);
  }

  /**
   * Attempt ADB tunnel connection
   */
  private async tryAdbConnection(profile: ConnectionProfile): Promise<void> {
    console.log("[ConnectionManager] ADB: Checking for ADB devices...");

    // Check if Tauri API is available
    if (!("__TAURI_INTERNALS__" in window)) {
      throw new Error("ADB connection requires Tauri environment");
    }

    const { invoke } = await import("@tauri-apps/api/core");

    // List ADB devices
    const devices = await invoke<Array<{ serial: string; state: string }>>("list_adb_devices");

    if (devices.length === 0) {
      throw new Error("No ADB devices found. Connect device via USB and enable USB debugging.");
    }

    // Use the first connected device
    const device = devices.find((d) => d.state === "device");
    if (!device) {
      throw new Error(`No ADB devices in 'device' state. Found: ${devices.map((d) => `${d.serial} (${d.state})`).join(", ")}`);
    }

    console.log(`[ConnectionManager] ADB: Using device ${device.serial}`);

    // Create ADB tunnel (forward local port to device port)
    const localPort = profile.port; // Use same port locally
    const remotePort = profile.port; // Device ForgeHttpServer port

    try {
      await invoke<number>("create_adb_tunnel", {
        serial: device.serial,
        localPort,
        remotePort,
      });

      console.log(`[ConnectionManager] ADB: Tunnel created - localhost:${localPort} -> device:${remotePort}`);

      // Test connection through the tunnel using localhost
      const config: ConnectionConfig = {
        host: "127.0.0.1",
        port: localPort,
        token: profile.token,
      };

      const status = await checkStatus(config);

      if (!status.running) {
        throw new Error("Device server is not running");
      }

      // Update profile to use localhost for ADB connections
      profile.host = "127.0.0.1";
      
      console.log(`[ConnectionManager] ADB: Connection successful through tunnel`);
    } catch (error) {
      // Clean up tunnel on failure
      try {
        await invoke("remove_adb_tunnel", {
          serial: device.serial,
          localPort,
        });
      } catch (cleanupError) {
        console.warn("[ConnectionManager] ADB: Failed to clean up tunnel:", cleanupError);
      }
      throw error;
    }
  }

  /**
   * Attempt relay server connection (placeholder for future implementation)
   */
  private async tryRelayConnection(_profile: ConnectionProfile): Promise<void> {
    console.log("[ConnectionManager] RELAY: Relay connection not yet implemented");
    throw new Error("Relay server connection is not yet implemented. This is a placeholder for future NAT traversal support.");
  }

  /**
   * Disconnect from the current device
   */
  async disconnect(): Promise<void> {
    if (this.currentProfile) {
      this.currentProfile = null;
      this.setConnectionState("disconnected");
      this.clearReconnectTimer();
      this.clearUnreachableTimer();
      this.emitEvent({ type: "disconnected" });
    }
  }

  /**
   * Cleanup method to stop all monitoring
   */
  cleanup(): void {
    this.stopNetworkMonitoring();
    this.clearReconnectTimer();
    this.clearUnreachableTimer();
  }

  /**
   * Reconnect to the current profile
   */
  async reconnect(): Promise<void> {
    if (!this.currentProfile) {
      throw new Error("No active connection to reconnect");
    }

    const profile = this.currentProfile;
    await this.disconnect();
    await this.connect(profile);
  }

  /**
   * Get the currently connected profile
   */
  getCurrentProfile(): ConnectionProfile | null {
    return this.currentProfile;
  }

  /**
   * Get the current connection state
   */
  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  /**
   * Get the active connection method for the current connection
   */
  getActiveConnectionMethod(): ConnectionProfile["connectionMethod"] | null {
    return this.currentProfile?.connectionMethod || null;
  }

  /**
   * Check if currently connected
   */
  isConnected(): boolean {
    return this.connectionState === "connected";
  }

  /**
   * Add an event listener
   */
  addEventListener(listener: ConnectionEventListener): void {
    this.listeners.add(listener);
  }

  /**
   * Remove an event listener
   */
  removeEventListener(listener: ConnectionEventListener): void {
    this.listeners.delete(listener);
  }

  /**
   * Set connection state and emit event
   */
  private setConnectionState(state: ConnectionState): void {
    if (this.connectionState !== state) {
      this.connectionState = state;
      this.emitEvent({ type: "state-changed", state });
    }
  }

  /**
   * Emit an event to all listeners
   */
  private emitEvent(event: ConnectionEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("Error in connection event listener:", error);
      }
    }
  }

  /**
   * Utility: Convert ArrayBuffer to base64
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Utility: Convert base64 to ArrayBuffer
   */
  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * Create a new profile with generated UUID
   */
  static createProfile(params: {
    name: string;
    deviceId: string;
    host: string;
    port: number;
    token: string;
    connectionMethod?: "tcp" | "adb" | "relay";
    deviceMetadata?: Partial<ConnectionProfile["deviceMetadata"]>;
  }): ConnectionProfile {
    return {
      id: crypto.randomUUID(),
      name: params.name,
      deviceId: params.deviceId,
      host: params.host,
      port: params.port,
      token: params.token,
      connectionMethod: params.connectionMethod || "tcp",
      lastConnected: 0,
      deviceMetadata: {
        model: params.deviceMetadata?.model || "Unknown",
        androidVersion: params.deviceMetadata?.androidVersion || "Unknown",
        forgeOsVersion: params.deviceMetadata?.forgeOsVersion || "Unknown",
        capabilities: params.deviceMetadata?.capabilities || [],
      },
    };
  }
}
