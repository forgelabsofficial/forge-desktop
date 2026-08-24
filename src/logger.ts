/**
 * Task 15.1 - Minimal structured logger.
 *
 * Zero-dependency substitute for winston: console transport + in-memory ring
 * buffer (last 1000 entries) + optional Tauri file append via the Rust
 * `log_append` command (which does the 10MB rotation).
 *
 * Token redaction: any Authorization/Bearer/token-looking values are replaced
 * with ***REDACTED*** before anything leaves the module.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  ts: string; // ISO 8601
  level: LogLevel;
  msg: string;
}

const REDACT_RE =
  /(Bearer\s+[A-Za-z0-9._-]+|authorization[=:\s"]+[A-Za-z0-9._-]+|token[=:\s"]+[A-Za-z0-9._-]{8,}|password[=:\s"]+[^\s"&]+|api[_-]?key[=:\s"]+[A-Za-z0-9._-]{8,})/gi;

const RING_SIZE = 1000;
const ring: LogEntry[] = [];
const errors: { ts: string; message: string; stack?: string }[] = [];
let consoleEnabled = true;

const isTauri = "__TAURI_INTERNALS__" in window;

async function tauriAppend(level: LogLevel, msg: string): Promise<void> {
  if (!isTauri) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("log_append", { level, message: msg });
  } catch {
    /* Rust side unavailable — ring buffer still has everything */
  }
}

export function redact(text: string): string {
  return text.replace(REDACT_RE, "***REDACTED***");
}

export function log(level: LogLevel, msg: string): void {
  const entry: LogEntry = { ts: new Date().toISOString(), level, msg: redact(msg) };
  ring.push(entry);
  if (ring.length > RING_SIZE) ring.shift();
  if (level === "error") {
    errors.push({ ts: entry.ts, message: entry.msg });
    if (errors.length > 10) errors.shift();
  }
  if (consoleEnabled) {
    const fn = level === "debug" ? console.debug : level === "warn" ? console.warn : level === "error" ? console.error : console.log;
    fn(`[forge:${level}] ${entry.msg}`);
  }
  void tauriAppend(level, entry.msg);
}

export const logger = {
  debug: (m: string) => log("debug", m),
  info: (m: string) => log("info", m),
  warn: (m: string) => log("warn", m),
  error: (m: string, e?: unknown) =>
    log("error", e instanceof Error ? `${m}: ${e.message}\n${e.stack ?? ""}` : `${m}: ${String(e)}`),
  setConsole(enabled: boolean) {
    consoleEnabled = enabled;
  },
  getEntries(): LogEntry[] {
    return [...ring];
  },
  getRecentErrors() {
    return [...errors];
  },
};

/** Convenience for HTTP request/response logging (Task 15.1). */
export function logRequest(method: string, path: string, status: number, durationMs: number) {
  logger.debug(`${method} ${path} -> ${status} (${durationMs}ms)`);
}