/**
 * HealthMonitor - Connection health monitoring service
 * 
 * Monitors device connectivity by:
 * - Polling /api/status at adaptive intervals (Requirement 3.1)
 * - Tracking round-trip latency (Requirement 3.2)
 * - Maintaining rolling latency history (last 10 measurements)
 * - Implementing failure threshold for disconnection detection (Requirement 3.3)
 * - Emitting connection state change events (Requirement 3.4)
 * - Adjusting polling intervals based on latency (Requirement 3.5)
 * 
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5
 */

import { checkStatus } from "./api";
import type { ConnectionConfig } from "./types";

/**
 * Connection state enumeration
 */
export type ConnectionState = 'connected' | 'disconnected' | 'connecting';

/**
 * Latency statistics
 */
export interface LatencyStats {
  current: number;      // Most recent latency measurement
  average: number;      // Rolling average
  min: number;          // Minimum in history
  max: number;          // Maximum in history
}

/**
 * Health check result
 */
interface HealthCheckResult {
  success: boolean;
  latency: number;
  timestamp: number;
  connectedClients?: number;
  error?: string;
}

/**
 * Health monitor event types
 */
export type HealthMonitorEvent =
  | { type: 'connected'; latency: number }
  | { type: 'disconnected'; reason: string }
  | { type: 'high-latency'; latency: number }
  | { type: 'latency-update'; stats: LatencyStats };

/**
 * Event listener function type
 */
export type HealthMonitorEventListener = (event: HealthMonitorEvent) => void;

/**
 * HealthMonitor class - Monitors connection health with adaptive polling
 */
export class HealthMonitor {
  // Configuration
  private config: ConnectionConfig | null = null;
  private isRunning = false;

  // Polling state
  private intervalHandle: number | null = null;
  private currentInterval = 10000; // Default 10 seconds (Requirement 3.1)

  // Latency tracking
  private latencyHistory: number[] = []; // Last 10 measurements (Requirement 3.2)
  private readonly MAX_HISTORY_SIZE = 10;

  // Failure tracking
  private consecutiveFailures = 0;
  private readonly FAILURE_THRESHOLD = 3; // Requirement 3.3

  // Connection state
  private state: ConnectionState = 'disconnected';
  private lastSuccessfulCheck: number | null = null;
  private connectedClientsCount = 0;

  // Event listeners
  private listeners: HealthMonitorEventListener[] = [];

  /**
   * Start monitoring with the given connection config
   * Requirement 3.1: Poll GET /api/status every 10 seconds
   */
  start(config: ConnectionConfig): void {
    if (this.isRunning) {
      console.warn('[HealthMonitor] Already running, stopping first');
      this.stop();
    }

    this.config = config;
    this.isRunning = true;
    this.state = 'connecting';
    this.consecutiveFailures = 0;
    this.latencyHistory = [];

    console.log('[HealthMonitor] Starting health monitoring');

    // Perform initial check immediately
    this.performHealthCheck();

    // Schedule periodic checks
    this.scheduleNextCheck();
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    console.log('[HealthMonitor] Stopping health monitoring');

    this.isRunning = false;
    this.clearScheduledCheck();
    this.config = null;
    this.state = 'disconnected';
  }

  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Get latency statistics
   * Requirement 3.5: Show current latency with moving average
   */
  getLatencyStats(): LatencyStats | null {
    if (this.latencyHistory.length === 0) {
      return null;
    }

    const current = this.latencyHistory[this.latencyHistory.length - 1];
    const sum = this.latencyHistory.reduce((acc, val) => acc + val, 0);
    const average = sum / this.latencyHistory.length;
    const min = Math.min(...this.latencyHistory);
    const max = Math.max(...this.latencyHistory);

    return { current, average, min, max };
  }

  /**
   * Get last successful connection timestamp
   * Requirement 3.6: Display last successful connection timestamp
   */
  getLastSuccessfulCheck(): number | null {
    return this.lastSuccessfulCheck;
  }

  /**
   * Get count of connected clients from last status response
   * Requirement 3.7, 17.6: Display count of other connected clients
   */
  getConnectedClientsCount(): number {
    return this.connectedClientsCount;
  }

  /**
   * Add event listener
   * Requirement 3.4: Emit connection state change events
   */
  addEventListener(listener: HealthMonitorEventListener): void {
    this.listeners.push(listener);
  }

  /**
   * Remove event listener
   */
  removeEventListener(listener: HealthMonitorEventListener): void {
    const index = this.listeners.indexOf(listener);
    if (index !== -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * Emit event to all listeners
   */
  private emit(event: HealthMonitorEvent): void {
    this.listeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error('[HealthMonitor] Error in event listener:', error);
      }
    });
  }

  /**
   * Perform a health check
   * Requirement 3.2: Track round-trip latency using Date.now()
   */
  private async performHealthCheck(): Promise<void> {
    if (!this.config || !this.isRunning) {
      return;
    }

    const startTime = Date.now();
    const result: HealthCheckResult = {
      success: false,
      latency: 0,
      timestamp: startTime,
    };

    try {
      // Make API call to /api/status
      const status = await checkStatus(this.config);
      
      // Calculate latency
      result.latency = Date.now() - startTime;
      result.success = true;
      result.connectedClients = status.connectedClients;

      // Handle successful check
      this.handleSuccessfulCheck(result);

    } catch (error) {
      // Calculate latency even for failed requests
      result.latency = Date.now() - startTime;
      result.error = error instanceof Error ? error.message : String(error);

      // Handle failed check
      this.handleFailedCheck(result);
    }
  }

  /**
   * Handle successful health check
   */
  private handleSuccessfulCheck(result: HealthCheckResult): void {
    // Update latency history
    this.updateLatencyHistory(result.latency);

    // Reset failure counter
    this.consecutiveFailures = 0;

    // Update last successful check timestamp
    this.lastSuccessfulCheck = result.timestamp;

    // Update connected clients count
    if (result.connectedClients !== undefined) {
      this.connectedClientsCount = result.connectedClients;
    }

    // Update state and emit event if transitioning to connected
    const wasConnected = this.state === 'connected';
    this.state = 'connected';

    if (!wasConnected) {
      console.log(`[HealthMonitor] Connected (latency: ${result.latency}ms)`);
      this.emit({ type: 'connected', latency: result.latency });
    }

    // Requirement 3.5: Emit warning if latency exceeds 1000ms
    if (result.latency > 1000) {
      console.warn(`[HealthMonitor] High latency detected: ${result.latency}ms`);
      this.emit({ type: 'high-latency', latency: result.latency });
    }

    // Emit latency update
    const stats = this.getLatencyStats();
    if (stats) {
      this.emit({ type: 'latency-update', stats });
    }

    // Adjust polling interval based on latency (Requirement 3.5)
    this.adjustPollingInterval();
  }

  /**
   * Handle failed health check
   */
  private handleFailedCheck(result: HealthCheckResult): void {
    this.consecutiveFailures++;

    console.warn(
      `[HealthMonitor] Check failed (${result.latency}ms): ${result.error}`,
      `[${this.consecutiveFailures}/${this.FAILURE_THRESHOLD}]`
    );

    // Requirement 3.3: Mark as disconnected after 3 consecutive failures
    if (this.consecutiveFailures >= this.FAILURE_THRESHOLD && this.state !== 'disconnected') {
      console.error('[HealthMonitor] Failure threshold reached, marking as disconnected');
      this.state = 'disconnected';
      this.emit({
        type: 'disconnected',
        reason: `${this.FAILURE_THRESHOLD} consecutive health check failures`,
      });
    }
  }

  /**
   * Update latency history
   * Maintains rolling array of last 10 measurements
   */
  private updateLatencyHistory(latency: number): void {
    this.latencyHistory.push(latency);

    // Keep only last 10 measurements
    if (this.latencyHistory.length > this.MAX_HISTORY_SIZE) {
      this.latencyHistory.shift();
    }
  }

  /**
   * Adjust polling interval based on average latency
   * Requirement 3.5: Adaptive health check intervals
   * - 10s for latency <100ms
   * - 15s for latency 100-500ms
   * - 20s for latency >500ms
   */
  private adjustPollingInterval(): void {
    const stats = this.getLatencyStats();
    if (!stats) {
      return;
    }

    let newInterval: number;

    if (stats.average < 100) {
      newInterval = 10000; // 10 seconds
    } else if (stats.average < 500) {
      newInterval = 15000; // 15 seconds
    } else {
      newInterval = 20000; // 20 seconds
    }

    // Only reschedule if interval changed
    if (newInterval !== this.currentInterval) {
      console.log(
        `[HealthMonitor] Adjusting polling interval: ${this.currentInterval}ms -> ${newInterval}ms` +
        ` (avg latency: ${Math.round(stats.average)}ms)`
      );
      
      this.currentInterval = newInterval;
      
      // Clear current interval and restart with new timing
      this.clearScheduledCheck();
      this.scheduleNextCheck();
    }
  }

  /**
   * Schedule next health check
   */
  private scheduleNextCheck(): void {
    if (!this.isRunning) {
      return;
    }

    this.intervalHandle = window.setTimeout(() => {
      this.performHealthCheck();
      this.scheduleNextCheck(); // Reschedule for next check
    }, this.currentInterval);
  }

  /**
   * Clear scheduled check
   */
  private clearScheduledCheck(): void {
    if (this.intervalHandle !== null) {
      window.clearTimeout(this.intervalHandle);
      this.intervalHandle = null;
    }
  }
}
