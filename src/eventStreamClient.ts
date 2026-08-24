type Listener = (...args: any[]) => void;

/** Minimal typed event emitter (browser-safe; avoids Node's "events" built-in). */
class EventEmitter {
  private listeners = new Map<string, Set<Listener>>();

  on(event: string, fn: Listener): this {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
    return this;
  }

  off(event: string, fn: Listener): this {
    this.listeners.get(event)?.delete(fn);
    return this;
  }

  emit(event: string, ...args: unknown[]): boolean {
    const set = this.listeners.get(event);
    if (!set) return false;
    for (const fn of Array.from(set)) fn(...args);
    return true;
  }

  removeAllListeners(): this {
    this.listeners.clear();
    return this;
  }
}



/**
 * Event message types from the WebSocket stream
 * Matches the EventMessage interface from design.md
 */
export type EventMessageType =
  | "tool_start"
  | "tool_progress"
  | "tool_complete"
  | "tool_error"
  | "agent_turn"
  | "file_modified"
  | "notification"
  | "clipboard"
  | "config_changed"
  | "desktop_tool_invoke";

/**
 * Base event message structure
 */
export interface EventMessage {
  type: EventMessageType;
  timestamp: number;
  payload: unknown;
}

/**
 * Tool start event payload
 */
export interface ToolStartEvent {
  opId: string;
  toolName: string;
  args: Record<string, unknown>;
}

/**
 * Tool progress event payload
 */
export interface ToolProgressEvent {
  opId: string;
  percent: number;
  message?: string;
}

/**
 * Tool complete event payload
 */
export interface ToolCompleteEvent {
  opId: string;
  output: string;
  duration: number;
  resourceUsage: {
    cpuMs: number;
    memoryBytes: number;
  };
}

/**
 * Tool error event payload
 */
export interface ToolErrorEvent {
  opId: string;
  error: {
    code: string;
    message: string;
    stackTrace?: string;
  };
}

/**
 * Desktop tool invoke event payload
 */
export interface DesktopToolInvokeEvent {
  invokeId: string;
  toolName: string;
  args: Record<string, unknown>;
  timeout: number;
}

/**
 * Notification event payload
 */
export interface NotificationEvent {
  id: string;
  packageName: string;
  title: string;
  body: string;
  icon?: string; // Base64 encoded
  actions: Array<{ id: string; label: string }>;
  removed?: boolean; // true = dismissed on device (Task 11.4)
}

/**
 * File modified event payload
 */
export interface FileModifiedEvent {
  path: string;
  checksum: string;
  size: number;
  lastModified: number;
}

/**
 * Agent turn event payload
 */
export interface AgentTurnEvent {
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

/**
 * Clipboard event payload
 */
export interface ClipboardEvent {
  type: "text" | "image" | "file";
  content?: string;
  imageData?: ArrayBuffer;
  fileName?: string;
  timestamp: number;
}

/**
 * Config changed event payload
 */
export interface ConfigChangedEvent {
  keys: string[];
  timestamp: number;
}

/**
 * EventStreamClient configuration
 */
export interface EventStreamConfig {
  host: string;
  port: number;
  token: string;
  wsPort?: number; // WebSocket server port (8790, separate from HTTP 8789)
  eventFilters?: EventMessageType[]; // Optional: filter events by type
}

/**
 * Connection state for EventStreamClient
 */
export type StreamConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting" | "error";

/**
 * EventStreamClient - WebSocket client for real-time event streaming
 * 
 * Features:
 * - Establishes WebSocket connection to /api/events
 * - Authenticates with Bearer token
 * - Subscribes to specific event types
 * - Parses and emits events using EventEmitter pattern
 * - Automatic reconnection with exponential backoff
 * - Preserves subscription filters across reconnections
 * 
 * **Validates: Requirements 8.2, 8.7**
 */
import { metrics } from "./metrics";
import { logger } from "./logger";

export class EventStreamClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: EventStreamConfig;
  private connectionState: StreamConnectionState = "disconnected";
  private subscriptionFilters: EventMessageType[] = [];
  private reconnectAttempt: number = 0;
  private reconnectTimer: number | null = null;
  private readonly maxReconnectDelay = 30000; // 30 seconds max
  private readonly baseReconnectDelay = 1000; // 1 second base
  private intentionalClose: boolean = false;

  constructor(config: EventStreamConfig) {
    super();
    this.config = config;
    
    // Store initial subscription filters if provided
    if (config.eventFilters) {
      this.subscriptionFilters = [...config.eventFilters];
    }
  }

  /**
   * Connect to the WebSocket endpoint
   * **Validates: Requirements 8.2**
   */
  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      console.warn("[EventStreamClient] Already connected or connecting");
      return;
    }

    this.intentionalClose = false;
    this.setConnectionState("connecting");

    const wsUrl = `ws://${this.config.host}:${this.config.wsPort ?? this.config.port}/api/events`;
    console.log(`[EventStreamClient] Connecting to ${wsUrl}`);

    try {
      // Create WebSocket connection with Authorization header
      // Note: WebSocket constructor doesn't support custom headers directly
      // We'll send the token in the initial auth message instead
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = this.handleOpen.bind(this);
      this.ws.onmessage = this.handleMessage.bind(this);
      this.ws.onerror = this.handleError.bind(this);
      this.ws.onclose = this.handleClose.bind(this);
    } catch (error) {
      console.error("[EventStreamClient] Failed to create WebSocket:", error);
      this.setConnectionState("error");
      this.emit("error", error);
      this.scheduleReconnect();
    }
  }

  /**
   * Handle WebSocket open event
   * **Validates: Requirements 8.2, 8.7**
   */
  private handleOpen(): void {
    console.log("[EventStreamClient] WebSocket connection established");
    this.setConnectionState("connected");
    this.reconnectAttempt = 0; // Reset reconnection counter on successful connect

    // Send authentication message
    this.sendAuthMessage();

    // Send subscription message if filters are configured
    if (this.subscriptionFilters.length > 0) {
      this.sendSubscriptionMessage();
    }

    this.emit("connected");
  }

  /**
   * Send authentication message with Bearer token
   * **Validates: Requirements 8.2**
   */
  private sendAuthMessage(): void {
    const authMessage = {
      type: "auth",
      token: this.config.token,
    };

    this.send(authMessage);
    console.log("[EventStreamClient] Sent authentication message");
  }

  /**
   * Send subscription message with event type filters
   * **Validates: Requirements 8.7**
   */
  private sendSubscriptionMessage(): void {
    const subscriptionMessage = {
      type: "subscribe",
      events: this.subscriptionFilters,
    };

    this.send(subscriptionMessage);
    console.log(`[EventStreamClient] Sent subscription for events:`, this.subscriptionFilters);
  }

  /**
   * Handle incoming WebSocket messages
   * **Validates: Requirements 8.2**
   */
  private handleMessage(event: MessageEvent): void {
    try {
      const message: EventMessage = JSON.parse(event.data);

      console.log(`[EventStreamClient] Received event: ${message.type}`);

      // Emit the parsed event
      this.emit("event", message);

      // Also emit specific event type for easier filtering
      this.emit(message.type, message.payload);
    } catch (error) {
      console.error("[EventStreamClient] Failed to parse message:", error);
      this.emit("parse-error", error);
    }
  }

  /**
   * Handle WebSocket error
   * **Validates: Requirements 8.6**
   */
  private handleError(event: Event): void {
    console.error("[EventStreamClient] WebSocket error:", event);
    this.setConnectionState("error");
    this.emit("error", event);
  }

  /**
   * Handle WebSocket close event
   * **Validates: Requirements 8.6, 3.7, 14.1**
   */
  private handleClose(event: CloseEvent): void {
    console.log(`[EventStreamClient] WebSocket closed: code=${event.code}, reason=${event.reason}`);
    
    this.ws = null;

    // Don't reconnect if this was an intentional close
    if (this.intentionalClose) {
      this.setConnectionState("disconnected");
      this.emit("disconnected");
      return;
    }

    // Attempt reconnection with exponential backoff
    this.setConnectionState("reconnecting");
    this.emit("connection-lost");
    this.scheduleReconnect();
  }

  /**
   * Schedule reconnection with exponential backoff
   * **Validates: Requirements 8.6, 3.7, 14.1**
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) {
      return; // Already scheduled
    }

    // Calculate backoff delay: Math.min(1000 * Math.pow(2, attempt), 30000)
    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempt),
      this.maxReconnectDelay
    );

    console.log(
      `[EventStreamClient] Scheduling reconnect attempt ${this.reconnectAttempt + 1} in ${delay}ms`
    );

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectAttempt++;
      this.connect();
    }, delay);
  }

  /**
   * Clear reconnection timer
   */
  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    this.intentionalClose = true;
    this.clearReconnectTimer();

    if (this.ws) {
      console.log("[EventStreamClient] Disconnecting...");
      this.ws.close();
      this.ws = null;
    }

    this.setConnectionState("disconnected");
    this.emit("disconnected");
  }

  /**
   * Update subscription filters
   * **Validates: Requirements 8.7**
   * 
   * @param filters - Array of event types to subscribe to
   */
  subscribe(filters: EventMessageType[]): void {
    this.subscriptionFilters = [...filters];

    // If already connected, send updated subscription
    if (this.connectionState === "connected") {
      this.sendSubscriptionMessage();
    }
  }

  /**
   * Get current subscription filters
   */
  getSubscriptionFilters(): EventMessageType[] {
    return [...this.subscriptionFilters];
  }

  /**
   * Send a message through the WebSocket
   */
  private send(data: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("[EventStreamClient] Cannot send message: WebSocket not connected");
      return;
    }

    try {
      this.ws.send(JSON.stringify(data));
      try {
        const raw = JSON.stringify(data);
        const t = (data as { type?: string })?.type ?? "?";
        const feature =
          t.startsWith("tool_") || t === "desktop_tool_result" ? "tool_calls" : "other";
        metrics.recordTransfer(feature as "tool_calls" | "other", raw.length, 0);
        logger.debug("ws -> " + t);
      } catch { /* metrics unavailable */ }
    } catch (error) {
      console.error("[EventStreamClient] Failed to send message:", error);
      this.emit("error", error);
    }
  }

  /**
   * Send desktop tool result back to the device
   * @param invokeId - The invoke ID from the desktop_tool_invoke event
   * @param success - Whether the tool executed successfully
   * @param output - The tool output or error message
   */
  sendDesktopToolResult(invokeId: string, success: boolean, output: string): void {
    const resultMessage = {
      type: "desktop_tool_result",
      invokeId,
      success,
      output,
    };

    this.send(resultMessage);
    console.log(`[EventStreamClient] Sent desktop tool result for ${invokeId}: ${success}`);
  }

  /**
   * Send an arbitrary JSON-serializable message (Task 12.1 - desktop tool
   * registrations). No-op when the socket isn't open.
   */
  sendRaw(data: unknown): void {
    this.send(data);
  }


  /**
   * Get the current connection state
   */
  getConnectionState(): StreamConnectionState {
    return this.connectionState;
  }

  /**
   * Check if currently connected
   */
  isConnected(): boolean {
    return this.connectionState === "connected" && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Get current reconnection attempt count
   */
  getReconnectAttempt(): number {
    return this.reconnectAttempt;
  }

  /**
   * Update configuration (requires reconnection)
   */
  updateConfig(config: Partial<EventStreamConfig>): void {
    const wasConnected = this.isConnected();
    
    // Update config
    this.config = { ...this.config, ...config };

    // Update subscription filters if provided
    if (config.eventFilters) {
      this.subscriptionFilters = [...config.eventFilters];
    }

    // Reconnect if we were connected
    if (wasConnected) {
      this.disconnect();
      this.connect();
    }
  }

  /**
   * Set connection state and emit state change event
   */
  private setConnectionState(state: StreamConnectionState): void {
    if (this.connectionState !== state) {
      const previousState = this.connectionState;
      this.connectionState = state;
      
      console.log(`[EventStreamClient] State changed: ${previousState} -> ${state}`);
      this.emit("state-changed", { from: previousState, to: state });

      // Emit reconnected event when transitioning from reconnecting to connected
      if (previousState === "reconnecting" && state === "connected") {
        console.log("[EventStreamClient] Reconnection successful");
        this.emit("reconnected");
      }
    }
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    this.disconnect();
    this.removeAllListeners();
  }
}
