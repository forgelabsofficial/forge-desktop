import type { ConnectionConfig, ToolDefinition } from "./types";

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

async function rawRequest(
  cfg: ConnectionConfig,
  method: string,
  path: string,
  body?: unknown,
  timeoutSecs = 30
): Promise<RawResponse> {
  if (isTauri) {
    return tauriInvoke<RawResponse>("forge_request", {
      host: cfg.host,
      port: cfg.port,
      token: cfg.token,
      method,
      path,
      body: body !== undefined ? JSON.stringify(body) : null,
      timeoutSecs,
    });
  }
  const res = await fetch(`http://${cfg.host}:${cfg.port}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.token}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.text() };
}

function parse<T>(r: RawResponse): T {
  if (r.status === 401) throw new Error("Unauthorized — check the API key");
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

export async function checkStatus(cfg: ConnectionConfig) {
  const r = await rawRequest(cfg, "GET", "/api/status", undefined, 10);
  return parse<{ status: string; port: number; running: boolean; server: string }>(r);
}

export async function listTools(cfg: ConnectionConfig): Promise<ToolDefinition[]> {
  const r = await rawRequest(cfg, "GET", "/api/tools", undefined, 15);
  const j = parse<{ tools: ToolDefinition[] }>(r);
  return j.tools;
}

export async function callTool(
  cfg: ConnectionConfig,
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const r = await rawRequest(cfg, "POST", "/api/tool", { name, args }, 120);
  const j = parse<{ ok: boolean; output: string; error?: string }>(r);
  if (!j.ok) throw new Error(j.error || j.output || "tool failed");
  return j.output;
}

export async function sendChat(
  cfg: ConnectionConfig,
  message: string,
  sessionId?: string
): Promise<{ reply: string; sessionId: string }> {
  const r = await rawRequest(
    cfg,
    "POST",
    "/api/chat",
    { message, session_id: sessionId },
    600 // agent turns can take minutes
  );
  const j = parse<{ ok: boolean; reply: string; session_id: string }>(r);
  return { reply: j.reply, sessionId: j.session_id };
}
