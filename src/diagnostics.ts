/**
 * Task 15.3 - Diagnostic export: log ring + system info + profiles
 * (tokens redacted) + last 10 errors, saved as a timestamped JSON file
 * via browser download (or Tauri dialog when available).
 */
import { logger } from "./logger";
import { ConnectionManager } from "./connectionManager";
import type { ConnectionProfile } from "./types";

const isTauri = "__TAURI_INTERNALS__" in window;

interface DiagnosticBundle {
  exported_at: string;
  app: string;
  system: Record<string, unknown> | null;
  log_count: number;
  logs: unknown[];
  profiles: Array<Partial<ConnectionProfile> & { token: "***REDACTED***" }>;
  recent_errors: unknown[];
}

async function redactedProfiles(): Promise<DiagnosticBundle["profiles"]> {
  try {
    const mgr = new ConnectionManager();
    await mgr.initialize();
    const profiles: ConnectionProfile[] = mgr.getProfiles();
    return profiles.map((p) => ({
      ...p,
      token: "***REDACTED***",
      deviceMetadata: p.deviceMetadata ?? undefined,
    }));
  } catch {
    return [];
  }
}

async function systemInfo(): Promise<Record<string, unknown> | null> {
  if (!isTauri) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const diag = await invoke<{ system: Record<string, unknown> }>("diagnostics_collect");
    return diag.system ?? null;
  } catch {
    return null;
  }
}

export async function exportDiagnostics(): Promise<string> {
  const sys = await systemInfo();
  const bundle: DiagnosticBundle = {
    exported_at: new Date().toISOString(),
    app: "forge-desktop",
    system: sys,
    log_count: logger.getEntries().length,
    logs: logger.getEntries(),
    profiles: await redactedProfiles(),
    recent_errors: logger.getRecentErrors(),
  };

  const blob = new Blob([JSON.stringify(bundle, null, 2)], {
    type: "application/json",
  });
  const filename = `forge-diagnostics-${Date.now()}.json`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return filename;
}