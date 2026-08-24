import { useEffect, useState } from "react";
import type { ConnectionConfig } from "../types";
import {
  applyFeatureToggles,
  loadSettings,
  saveSettings,
  toDeviceConfig,
  type ForgeSettings,
} from "../settings";
import { rawRequest } from "../api";
import { logger } from "../logger";

interface Props {
  cfg: ConnectionConfig;
}

/**
 * Task 17.1/17.3 + Task 18.1 - Settings panel: syncs config to the device
 * via POST /api/config and applies bandwidth-saver feature toggles locally.
 */
export default function SettingsPanel({ cfg }: Props) {
  const [settings, setSettings] = useState<ForgeSettings>(() => loadSettings(cfg));
  const [saved, setSaved] = useState(false);
  const [syncState, setSyncState] = useState<"idle" | "saving" | "ok" | "error">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    setSettings(loadSettings(cfg));
  }, [cfg]);

  function update<K extends keyof ForgeSettings>(key: K, value: ForgeSettings[K]) {
    setSettings((s) => ({ ...s, [key]: value }));
    setSaved(false);
  }

  async function handleSyncToDevice() {
    setSyncState("saving");
    setError("");
    try {
      const payload = toDeviceConfig(settings);
      await rawRequest(cfg, "POST", "/api/config", payload, 15);
      saveSettings(cfg, settings);
      await applyFeatureToggles(settings);
      setSaved(true);
      setSyncState("ok");
      logger.info(`Settings synced to device (${cfg.host}:${cfg.port})`);
    } catch (e) {
      setSyncState("error");
      setError(e instanceof Error ? e.message : String(e));
      logger.error("Settings sync failed", e);
    }
  }

  const toggle = (label: string, key: keyof ForgeSettings, hint: string) => (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-2">
      <div>
        <div className="text-sm font-medium text-forge-text">{label}</div>
        <div className="text-xs text-forge-muted">{hint}</div>
      </div>
      <input
        type="checkbox"
        checked={settings[key] as boolean}
        onChange={(e) => update(key, e.target.checked)}
        className="h-4 w-4 accent-forge-accent"
      />
    </label>
  );

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4">
      <div>
        <h2 className="text-lg font-semibold text-forge-text">Settings</h2>
        <p className="text-xs text-forge-muted">
          Per-device profile (stored per {cfg.host}:{cfg.port}). Desktop-only options are
          never sent to Android.
        </p>
      </div>

      <section className="rounded-xl border border-forge-border bg-forge-panel p-4">
        <h3 className="mb-1 text-sm font-semibold text-forge-text">Features</h3>
        {toggle(
          "Bandwidth-saver mode",
          "bandwidthSaverEnabled",
          "Stops file + clipboard watchers; data usage becomes the focus (Task 18)"
        )}
        {toggle("File sync", "fileSyncEnabled", "Allow background file synchronization")}
        {toggle("Clipboard sync", "clipboardSyncEnabled", "Mirror clipboard to/from the device")}
        {toggle("Notifications", "notificationsEnabled", "Bridge Android notifications to desktop")}
        <div className="flex items-center justify-between gap-3 py-2">
          <div>
            <div className="text-sm font-medium text-forge-text">Data usage threshold</div>
            <div className="text-xs text-forge-muted">Warn when session usage exceeds this</div>
          </div>
          <input
            type="number"
            min={1}
            value={settings.dataUsageThresholdMB}
            onChange={(e) => update("dataUsageThresholdMB", Math.max(1, Number(e.target.value)))}
            className="w-24 rounded-md border border-forge-border bg-forge-bg px-2 py-1 text-sm text-forge-text"
          />
          <span className="text-xs text-forge-muted">MB</span>
        </div>
      </section>

      <section className="rounded-xl border border-forge-border bg-forge-panel p-4">
        <h3 className="mb-1 text-sm font-semibold text-forge-text">Desktop-only</h3>
        {toggle("Theme", "theme", "Not synced to the device")}
        <div className="flex items-center justify-between gap-3 py-2">
          <div>
            <div className="text-sm font-medium text-forge-text">Window size</div>
            <div className="text-xs text-forge-muted">Not synced to the device</div>
          </div>
          <select
            value={settings.windowSize}
            onChange={(e) => update("windowSize", e.target.value)}
            className="rounded-md border border-forge-border bg-forge-bg px-2 py-1 text-sm text-forge-text"
          >
            <option value="default">Default</option>
            <option value="small">Small</option>
            <option value="large">Large</option>
          </select>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSyncToDevice}
          disabled={syncState === "saving"}
          className="rounded-lg bg-forge-accent px-4 py-2 text-sm font-semibold text-black transition hover:bg-orange-400 disabled:opacity-40"
        >
          {syncState === "saving" ? "Syncing…" : "Sync to device"}
        </button>
        {saved && <span className="text-xs text-forge-accent">Saved ✓</span>}
        {syncState === "ok" && <span className="text-xs text-forge-accent">Device updated ✓</span>}
        {syncState === "error" && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </div>
  );
}