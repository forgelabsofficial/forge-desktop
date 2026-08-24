import { useEffect, useState } from "react";
import { rawRequest, sendChat } from "./api";
import { offlineQueue } from "./recovery";
import { metrics } from "./metrics";
import {
  applyFeatureToggles,
  loadSettings,
  mergeDeviceConfig,
  saveSettings,
  type ForgeSettings,
} from "./settings";
import type { ConnectionConfig } from "./types";
import ConnectScreen from "./components/ConnectScreen";
import ChatView from "./components/ChatView";
import ToolsView from "./components/ToolsView";
import ReAuthDialog from "./components/ReAuthDialog";
import ConnectionStatus from "./components/ConnectionStatus";
import NotificationPanel from "./components/NotificationPanel";
import MonitoringDashboard from "./components/MonitoringDashboard";
import SettingsPanel from "./components/SettingsPanel";
import { useTokenRotation } from "./hooks/useTokenRotation";
import { HealthMonitor } from "./healthMonitor";
import { useEventStream } from "./hooks/useEventStream";

const isTauri = "__TAURI_INTERNALS__" in window;
const STORE_KEY = "connection";

type Tab = "chat" | "tools" | "monitor" | "settings";

export default function App() {
  const [cfg, setCfg] = useState<ConnectionConfig | null>(null);
  const [initial, setInitial] = useState<ConnectionConfig>({
    host: "",
    port: 8789,
    token: "",
  });
  const [tab, setTab] = useState<Tab>("chat");
  const [settings, setSettings] = useState<ForgeSettings | null>(null);
  const [queueCount, setQueueCount] = useState(0);
  const [loaded, setLoaded] = useState(false);

  // Setup token rotation support (Requirement 2.7)
  const {
    showReAuthDialog,
    profileNeedingAuth,
    handleReAuthSuccess,
    handleReAuthCancel,
  } = useTokenRotation();

  // Setup health monitoring (Requirement 3.1-3.7)
  const [healthMonitor] = useState(() => new HealthMonitor());

  // Live event stream (Task 6): real-time events from the device
const {
    state: streamState,
    notificationCount,
    notifications: streamNotifications,
    clearNotifications,
    agentActive,
    activeTools,
  } = useEventStream(cfg, {
    onDeviceConfig: (deviceCfg: Record<string, unknown>) => {
      // Task 17.2 - server wins.
      setSettings((prev) => {
        const base = prev ?? loadSettings(cfg!);
        const merged = mergeDeviceConfig(base, deviceCfg);
        saveSettings(cfg!, merged);
        return merged;
      });
    },
    onReady: () => {
      // Task 16.3 - flush the offline queue when the connection is restored.
      void offlineQueue
        .processAll(async (op) => {
          if (op.kind === "chat") {
            await sendChat(
              cfg!,
              String(op.payload.message ?? ""),
              op.payload.session_id as string | undefined
            );
          } else if (op.kind === "config") {
            await rawRequest(cfg!, "POST", "/api/config", op.payload, 15);
          }
        })
        .then((n) => {
          if (n > 0) console.log(`[OfflineQueue] flushed ${n} operation(s)`);
        })
        .catch(() => undefined);
    },
  });

  // Task 17/18 - settings lifecycle + offline queue badge
  useEffect(() => {
    if (!cfg) return;
    const s = loadSettings(cfg);
    setSettings(s);
    metrics.setThresholdBytes(s.dataUsageThresholdMB * 1024 * 1024);
    void applyFeatureToggles(s);
    let unsub: (() => void) | undefined;
    offlineQueue
      .count()
      .then((n) => {
        setQueueCount(n);
        unsub = offlineQueue.subscribe(() => {
          void offlineQueue.count().then(setQueueCount);
        });
      })
      .catch(() => undefined);
    return () => unsub?.();
  }, [cfg]);

  useEffect(() => {
    if (!cfg || !settings) return;
    saveSettings(cfg, settings);
    metrics.setThresholdBytes(settings.dataUsageThresholdMB * 1024 * 1024);
    void applyFeatureToggles(settings);
  }, [settings, cfg]);

  useEffect(() => {
    (async () => {
      if (isTauri) {
        try {
          const { load } = await import("@tauri-apps/plugin-store");
          const store = await load("forge-desktop.json");
          const saved = await store.get<ConnectionConfig>(STORE_KEY);
          if (saved) setInitial(saved);
        } catch {
          // first run / corrupt store — fall back to defaults
        }
      } else {
        try {
          const saved = localStorage.getItem(STORE_KEY);
          if (saved) setInitial(JSON.parse(saved));
        } catch {
          // ignore
        }
      }
      setLoaded(true);
    })();
  }, []);

  async function handleConnect(c: ConnectionConfig) {
    if (isTauri) {
      try {
        const { load } = await import("@tauri-apps/plugin-store");
        const store = await load("forge-desktop.json");
        await store.set(STORE_KEY, c);
        await store.save();
      } catch {
        // non-fatal
      }
    } else {
      localStorage.setItem(STORE_KEY, JSON.stringify(c));
    }
    setCfg(c);
  }

  // Start/stop health monitoring when connection changes (Requirement 3.1)
  useEffect(() => {
    if (cfg) {
      healthMonitor.start(cfg);
      return () => {
        healthMonitor.stop();
      };
    }
  }, [cfg, healthMonitor]);

  if (!loaded) return null;

  if (!cfg) {
    return <ConnectScreen initial={initial} onConnect={handleConnect} />;
  }

  return (
    <>
      {/* Requirement 2.7: Re-authentication dialog for token rotation */}
      {showReAuthDialog && profileNeedingAuth && (
        <ReAuthDialog
          profile={profileNeedingAuth}
          onSuccess={handleReAuthSuccess}
          onCancel={handleReAuthCancel}
        />
      )}

      <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-forge-border bg-forge-panel px-4 py-2.5">
        <div className="flex items-center gap-6">
          <span className="text-sm font-bold tracking-tight">
            Forge <span className="text-forge-accent">Desktop</span>
          </span>
          <nav className="flex gap-1">
            {(["chat", "tools", "monitor", "settings"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition ${
                  tab === t
                    ? "bg-forge-bg text-forge-text"
                    : "text-forge-muted hover:text-forge-text"
                }`}
              >
                {t}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {/* Connection Status with Health Monitoring (Requirements 3.2-3.7, 17.6) */}
          <ConnectionStatus healthMonitor={healthMonitor} />
          <span className={`text-[10px] font-semibold ${streamState === "connected" ? "text-forge-accent" : "text-forge-muted"}`}>
            {streamState === "connected" ? "LIVE" : streamState === "reconnecting" ? "RECONNECTING" : "IDLE"}
          </span>
          {notificationCount > 0 && (
            <span className="rounded-full bg-forge-accent px-1.5 py-0.5 text-[10px] font-semibold text-black">
              {notificationCount}
            </span>
          )}
          {queueCount > 0 && (
            <button
              onClick={() => offlineQueue.cancelAll().then(() => setQueueCount(0))}
              className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-300 hover:bg-amber-500/30"
              title="Cancel all queued operations (Task 16.3)"
            >
              Queue {queueCount} ✕
            </button>
          )}
          <span className="text-[11px] text-forge-muted">
            {cfg.host}:{cfg.port}
          </span>
          <button
            onClick={() => setCfg(null)}
            className="text-[11px] text-forge-muted hover:text-forge-text"
          >
            Disconnect
          </button>
        </div>
      </header>

      {/* Task 11.4 - in-app notification mirror with action buttons */}
      {streamNotifications.length > 0 && (
        <NotificationPanel
          cfg={cfg}
          notifications={streamNotifications}
          onClear={clearNotifications}
        />
      )}

      <main className="flex-1 overflow-hidden">
        {tab === "chat" && (
          <ChatView cfg={cfg} agentActive={agentActive} activeTools={activeTools} />
        )}
        {tab === "tools" && <ToolsView cfg={cfg} />}
        {tab === "monitor" && <MonitoringDashboard />}
        {tab === "settings" && <SettingsPanel cfg={cfg} />}
      </main>
    </div>
    </>
  );
}
