import { useState } from "react";
import type { ConnectionConfig } from "../types";
import { checkStatus } from "../api";

interface Props {
  initial: ConnectionConfig;
  onConnect: (cfg: ConnectionConfig) => void;
}

export default function ConnectScreen({ initial, onConnect }: Props) {
  const [host, setHost] = useState(initial.host);
  const [port, setPort] = useState(String(initial.port));
  const [token, setToken] = useState(initial.token);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleConnect() {
    setBusy(true);
    setError("");
    const cfg: ConnectionConfig = {
      host: host.trim(),
      port: parseInt(port, 10) || 8789,
      token: token.trim(),
    };
    try {
      await checkStatus(cfg);
      onConnect(cfg);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="text-3xl font-bold tracking-tight">
            Forge <span className="text-forge-accent">Desktop</span>
          </div>
          <p className="mt-2 text-sm text-forge-muted">
            Connect to your Forge OS device over LAN
          </p>
        </div>

        <div className="space-y-4 rounded-xl border border-forge-border bg-forge-panel p-6">
          <div>
            <label className="mb-1 block text-xs font-medium text-forge-muted">
              Device IP
            </label>
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="192.168.1.42"
              className="w-full rounded-lg border border-forge-border bg-forge-bg px-3 py-2 text-sm outline-none focus:border-forge-accent"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-forge-muted">
              Port
            </label>
            <input
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="8789"
              inputMode="numeric"
              className="w-full rounded-lg border border-forge-border bg-forge-bg px-3 py-2 text-sm outline-none focus:border-forge-accent"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-forge-muted">
              API Key
            </label>
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="From Settings → API Server"
              type="password"
              className="w-full rounded-lg border border-forge-border bg-forge-bg px-3 py-2 text-sm outline-none focus:border-forge-accent"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          <button
            onClick={handleConnect}
            disabled={busy || !host.trim() || !token.trim()}
            className="w-full rounded-lg bg-forge-accent px-3 py-2 text-sm font-semibold text-black transition hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Connecting…" : "Connect"}
          </button>

          <p className="text-center text-[11px] leading-relaxed text-forge-muted">
            On your phone: Settings → API Server → Start.
            <br />
            Both devices must be on the same network.
          </p>
        </div>
      </div>
    </div>
  );
}
