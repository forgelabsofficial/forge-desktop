import type { ConnectionConfig, ToolDefinition } from "./types";
import { TokenExpiredError, tokenRotationManager } from "./services/tokenRotation";
import type { ConnectionProfile } from "./connectionManager";
import { metrics, featureForPath } from "./metrics";
import { logger, logRequest } from "./logger";
import { circuitAllow, circuitReport } from "./recovery";

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

// In Tauri we route through the Rust raw-TCP command (the device server
// speaks a minimal HTTP dialect). In a plain browser (dev mode) we fall
// back to fetch so the UI can be tested against a mock server.
const isTauri = "__TAURI_INTERNALS__" in window;

async function tauriInvoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

interface RawResponse {
  status: number;
  body: string;
}

/**
 * Internal raw request without retry logic
 */
export async function rawRequest(
  cfg: ConnectionConfig,
  method: string,
  path: string,
  body?: unknown,
  timeoutSecs = 30
): Promise<RawResponse> {
  const started = Date.now();
  let raw: { status: number; body: string };
  try {
    if (isTauri) {
      raw = await tauriInvoke<RawResponse>("forge_request", {
        host: cfg.host,
        port: cfg.port,
        token: cfg.token,
        method,
        path,
        body: body !== undefined ? JSON.stringify(body) : null,
        timeoutSecs,
      });
    } else {
      const res = await fetch(`http://${cfg.host}:${cfg.port}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.token}`,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      raw = { status: res.status, body: await res.text() };
    }
  } catch (error) {
    // Task 16.1 - mark network-level failures so retry logic can act.
    throw error instanceof NetworkError
      ? error
      : new NetworkError(error instanceof Error ? error.message : String(error));
  }
  // Task 14.4 - data usage accounting.
  const sent = body !== undefined ? JSON.stringify(body).length : 0;
  metrics.recordTransfer(featureForPath(path), sent, raw.body.length);
  // Task 15.1 - request logging.
  logRequest(method, path, raw.status, Date.now() - started);
  return raw;
}

/**
 * Request with automatic token rotation on 401 responses
 * 
 * Requirements:
 * - 2.7: Detect HTTP 401 as token expiration signal
 * - 2.7: Retry failed request with new token after rotation
 * 
 * @param cfg Connection configuration (will be updated with new token)
 * @param profile Optional connection profile for token rotation
 * @param method HTTP method
 * @param path API endpoint path
 * @param body Request body
 * @param timeoutSecs Request timeout in seconds
 * @returns Promise resolving to raw response
 */
async function rawRequestWithRetry(
  cfg: ConnectionConfig,
  profile: ConnectionProfile | null,
  method: string,
  path: string,
  body?: unknown,
  timeoutSecs = 30
): Promise<RawResponse> {
  // Task 16.2 - circuit breaker gate (fail fast when open).
  if (profile && !(await circuitAllow(profile.id))) {
    throw new Error("circuit open - connection failing repeatedly");
  }

  const isIdempotentMethod = method === "GET" || method === "PUT" || method === "DELETE";
  const maxNetworkRetries = isIdempotentMethod ? 3 : 1; // Task 16.1

  for (let attempt = 0; attempt <= maxNetworkRetries; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
      logger.warn(`retrying ${method} ${path} (attempt ${attempt + 1}/${maxNetworkRetries + 1}) after ${delay}ms`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    try {
      const res = await rawRequest(cfg, method, path, body, timeoutSecs);
      if (profile) void circuitReport(profile.id, true);
      return res;
    } catch (error) {
      if (error instanceof TokenExpiredError && profile) {
        logger.info("token expired, rotating...");
        try {
          const newToken = await tokenRotationManager.rotateToken(profile);
          cfg.token = newToken;
          const res = await rawRequest(cfg, method, path, body, timeoutSecs);
          if (profile) void circuitReport(profile.id, true);
          return res;
        } catch (rotationError) {
          if (profile) void circuitReport(profile.id, false);
          throw new Error(
            `Authentication failed: ${rotationError instanceof Error ? rotationError.message : String(rotationError)}`
          );
        }
      }
      if (error instanceof NetworkError && attempt < maxNetworkRetries) {
        if (profile) void circuitReport(profile.id, false);
        continue; // Task 16.1 - exponential backoff retry
      }
      throw error;
    }
  }
  throw new Error(`request failed after ${maxNetworkRetries + 1} attempts: ${method} ${path}`);
}

function parse<T>(r: RawResponse): T {
  // Requirement 2.7: Detect HTTP 401 as token expiration signal
  if (r.status === 401) {
    throw new TokenExpiredError("Unauthorized — token may be expired");
  }
  if (r.status >= 400) {
    try {
      const j = JSON.parse(r.body);
      throw new Error(j.error || `HTTP ${r.status}`);
    } catch {
      throw new Error(`HTTP ${r.status}: ${r.body.slice(0, 200)}`);
    }
  }
  return JSON.parse(r.body) as T;
}

export async function checkStatus(
  cfg: ConnectionConfig,
  profile?: ConnectionProfile | null
) {
  const r = await rawRequestWithRetry(cfg, profile || null, "GET", "/api/status", undefined, 10);
  return parse<{ 
    status: string; 
    port: number; 
    running: boolean; 
    server: string;
    connectedClients?: number; // Requirement 3.7, 17.6: Count of other connected clients
  }>(r);
}

export async function listTools(
  cfg: ConnectionConfig,
  profile?: ConnectionProfile | null
): Promise<ToolDefinition[]> {
  const r = await rawRequestWithRetry(cfg, profile || null, "GET", "/api/tools", undefined, 15);
  const j = parse<{ tools: ToolDefinition[] }>(r);
  return j.tools;
}

export async function callTool(
  cfg: ConnectionConfig,
  name: string,
  args: Record<string, unknown>,
  profile?: ConnectionProfile | null
): Promise<string> {
  // Task 14.1 - execution metrics
  const started = metrics.recordToolStart(name);
  const r = await rawRequestWithRetry(cfg, profile || null, "POST", "/api/tool", { name, args }, 120);
  const j = parse<{ opId?: string; ok: boolean; output: string; error?: string }>(r);

  // Backward-compatible synchronous response (older firmware): { ok, output }
  if (!j.opId) {
    if (!j.ok) {
      metrics.recordToolEnd(name, started, false);
      throw new Error(j.error || j.output || "tool failed");
    }
    metrics.recordToolEnd(name, started, true);
    return j.output;
  }

  // Async execution (Task 8.1): poll the operation status until it finishes.
  const opId = j.opId;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const sr = await rawRequestWithRetry(
      cfg,
      profile || null,
      "GET",
      `/api/tool/${opId}/status`,
      undefined,
      10
    );
    const st = parse<{ status?: string; output?: string; error?: { message?: string } }>(sr);
    const status = st.status ?? "";
    if (status === "completed" || status === "complete") {
      metrics.recordToolEnd(name, started, true);
      return st.output ?? "";
    }
    if (status === "failed" || status === "error") {
      metrics.recordToolEnd(name, started, false);
      throw new Error(st.error?.message || st.output || `tool ${name} failed`);
    }
    if (status === "cancelled") {
      metrics.recordToolEnd(name, started, false);
      throw new Error(`tool ${name} was cancelled`);
    }
  }
  metrics.recordToolEnd(name, started, false);
  throw new Error(`tool ${name} timed out after 120s`);
}

export async function sendChat(
  cfg: ConnectionConfig,
  message: string,
  sessionId?: string,
  profile?: ConnectionProfile | null
): Promise<{ reply: string; sessionId: string }> {
  const r = await rawRequestWithRetry(
    cfg,
    profile || null,
    "POST",
    "/api/chat",
    { message, session_id: sessionId },
    600 // agent turns can take minutes
  );
  const j = parse<{ ok: boolean; reply: string; session_id: string }>(r);
  return { reply: j.reply, sessionId: j.session_id };
}

/**
 * Initiate pairing with a device
 * Returns a 6-digit pairing code that will be displayed on the device
 */
export async function initiatePairing(
  host: string,
  port: number,
  desktopName: string
): Promise<{ pairingCode: string; expiresIn: number }> {
  // For pairing initiation, we don't have a token yet
  const cfg: ConnectionConfig = { host, port, token: "" };
  const r = await rawRequest(cfg, "POST", "/api/pairing/initiate", { desktop_name: desktopName }, 10);
  const j = parse<{ pairing_code: string; expires_in: number }>(r);
  return { pairingCode: j.pairing_code, expiresIn: j.expires_in };
}

/**
 * Confirm pairing with the 6-digit code displayed on the device
 * Returns the connection token and device metadata
 */
export async function confirmPairing(
  host: string,
  port: number,
  pairingCode: string,
  desktopId: string
): Promise<{
  token: string;
  deviceId: string;
  deviceMetadata: {
    model: string;
    androidVersion: string;
    forgeOsVersion: string;
    capabilities: string[];
  };
}> {
  const cfg: ConnectionConfig = { host, port, token: "" };
  const r = await rawRequest(
    cfg,
    "POST",
    "/api/pairing/confirm",
    { pairing_code: pairingCode, desktop_id: desktopId },
    10
  );
  const j = parse<{
    token: string;
    device_id: string;
    device_metadata: {
      model: string;
      android_version: string;
      forge_os_version: string;
      capabilities: string[];
    };
  }>(r);
  return {
    token: j.token,
    deviceId: j.device_id,
    deviceMetadata: {
      model: j.device_metadata.model,
      androidVersion: j.device_metadata.android_version,
      forgeOsVersion: j.device_metadata.forge_os_version,
      capabilities: j.device_metadata.capabilities,
    },
  };
}

/**
 * Trigger a notification action on the device (Task 11.4).
 * Desktop action clicks are sent back so Android can fire the PendingIntent.
 */
export async function postNotificationAction(
  cfg: ConnectionConfig,
  notificationId: string,
  actionId: string,
  profile?: ConnectionProfile | null
): Promise<{ triggered: boolean }> {
  const r = await rawRequestWithRetry(
    cfg,
    profile || null,
    "POST",
    "/api/notification/action",
    { notification_id: notificationId, action_id: actionId },
    15
  );
  return parse<{ triggered: boolean }>(r);
}
