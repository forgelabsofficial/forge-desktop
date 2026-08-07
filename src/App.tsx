import { useEffect, useState } from "react";
import type { ConnectionConfig } from "./types";
import ConnectScreen from "./components/ConnectScreen";
import ChatView from "./components/ChatView";
import ToolsView from "./components/ToolsView";

const isTauri = "__TAURI_INTERNALS__" in window;
const STORE_KEY = "connection";

type Tab = "chat" | "tools";

export default function App() {
  const [cfg, setCfg] = useState<ConnectionConfig | null>(null);
  const [initial, setInitial] = useState<ConnectionConfig>({
    host: "",
    port: 8789,
    token: "",
  });
  const [tab, setTab] = useState<Tab>("chat");
  const [loaded, setLoaded] = useState(false);

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

  if (!loaded) return null;

  if (!cfg) {
    return <ConnectScreen initial={initial} onConnect={handleConnect} />;
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-forge-border bg-forge-panel px-4 py-2.5">
        <div className="flex items-center gap-6">
          <span className="text-sm font-bold tracking-tight">
            Forge <span className="text-forge-accent">Desktop</span>
          </span>
          <nav className="flex gap-1">
            {(["chat", "tools"] as Tab[]).map((t) => (
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
          <span className="flex items-center gap-1.5 text-[11px] text-forge-muted">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-400" />
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

      <main className="flex-1 overflow-hidden">
        {tab === "chat" ? <ChatView cfg={cfg} /> : <ToolsView cfg={cfg} />}
      </main>
    </div>
  );
}
