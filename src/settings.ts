/**
 * Task 17/18 - Per-device configuration profiles + bandwidth-saver mode.
 * Settings persist per connection (host:port) in localStorage.
 * Desktop-only keys are stripped before syncing to Android (Task 17.3).
 */
import type { ConnectionConfig } from "./types";

export interface ForgeSettings {
  bandwidthSaverEnabled: boolean;
  fileSyncEnabled: boolean;
  clipboardSyncEnabled: boolean;
  notificationsEnabled: boolean;
  dataUsageThresholdMB: number;
  theme: "system" | "dark" | "light";
  windowSize: string;
}

export const DEFAULT_SETTINGS: ForgeSettings = {
  bandwidthSaverEnabled: false,
  fileSyncEnabled: true,
  clipboardSyncEnabled: true,
  notificationsEnabled: true,
  dataUsageThresholdMB: 100,
  theme: "system",
  windowSize: "default",
};

/** Keys that must NOT be sent to the Android device (Task 17.3). */
const DESKTOP_ONLY_KEYS = new Set(["theme", "windowSize"]);

export function settingsKey(cfg: ConnectionConfig): string {
  return `forge-settings-${cfg.host}:${cfg.port}`;
}

export function loadSettings(cfg: ConnectionConfig): ForgeSettings {
  try {
    const raw = localStorage.getItem(settingsKey(cfg));
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<ForgeSettings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(cfg: ConnectionConfig, s: ForgeSettings): void {
  localStorage.setItem(settingsKey(cfg), JSON.stringify(s));
}

/** Payload for POST /api/config — desktop-only fields stripped. */
export function toDeviceConfig(s: ForgeSettings): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (!DESKTOP_ONLY_KEYS.has(k)) out[k] = v;
  }
  // snake_case for the Android side
  return {
    bandwidth_saver_enabled: s.bandwidthSaverEnabled,
    file_sync_enabled: s.fileSyncEnabled,
    clipboard_sync_enabled: s.clipboardSyncEnabled,
    notifications_enabled: s.notificationsEnabled,
    data_usage_threshold_mb: s.dataUsageThresholdMB,
  };
}

/** Merge device config into settings — server wins (Task 17.2). */
export function mergeDeviceConfig(
  current: ForgeSettings,
  device: Record<string, unknown>
): ForgeSettings {
  const next = { ...current };
  if (typeof device.bandwidth_saver_enabled === "boolean")
    next.bandwidthSaverEnabled = device.bandwidth_saver_enabled;
  if (typeof device.file_sync_enabled === "boolean")
    next.fileSyncEnabled = device.file_sync_enabled;
  if (typeof device.clipboard_sync_enabled === "boolean")
    next.clipboardSyncEnabled = device.clipboard_sync_enabled;
  if (typeof device.notifications_enabled === "boolean")
    next.notificationsEnabled = device.notifications_enabled;
  if (typeof device.data_usage_threshold_mb === "number")
    next.dataUsageThresholdMB = device.data_usage_threshold_mb;
  return next;
}

/**
 * Task 18.1 - Bandwidth-saver effects: stop the file watcher and clipboard
 * watcher when enabled (or when those features are disabled).
 */
export async function applyFeatureToggles(s: ForgeSettings): Promise<void> {
  const isTauri = "__TAURI_INTERNALS__" in window;
  if (!isTauri) return;
  try {
    const { syncUnwatch } = await import("./sync");
    const { stopClipboardSync } = await import("./clipboard");
    if (s.bandwidthSaverEnabled || !s.fileSyncEnabled) {
      await syncUnwatch().catch(() => undefined);
    }
    if (s.bandwidthSaverEnabled || !s.clipboardSyncEnabled) {
      await stopClipboardSync().catch(() => undefined);
    }
  } catch {
    /* not in Tauri */
  }
}