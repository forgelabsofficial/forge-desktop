import { useEffect, useMemo, useState } from "react";
import type { ConnectionConfig, ToolDefinition } from "../types";
import { callTool, listTools } from "../api";

interface Props {
  cfg: ConnectionConfig;
}

export default function ToolsView({ cfg }: Props) {
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ToolDefinition | null>(null);
  const [args, setArgs] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    listTools(cfg)
      .then((t) => setTools(t.sort((a, b) => a.function.name.localeCompare(b.function.name))))
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, [cfg]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return tools;
    return tools.filter(
      (t) =>
        t.function.name.toLowerCase().includes(q) ||
        t.function.description.toLowerCase().includes(q)
    );
  }, [tools, query]);

  function selectTool(t: ToolDefinition) {
    setSelected(t);
    setArgs({});
    setResult(null);
  }

  async function run() {
    if (!selected) return;
    setRunning(true);
    setResult(null);
    const f = selected.function;
    const coerced: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args)) {
      if (v === "") continue; // omit unset optional fields
      const spec = f.parameters.properties[k];
      if (spec?.type === "number" || spec?.type === "integer") {
        const n = Number(v);
        coerced[k] = Number.isNaN(n) ? v : n;
      } else if (spec?.type === "boolean") {
        coerced[k] = v === "true";
      } else {
        coerced[k] = v;
      }
    }
    try {
      const out = await callTool(cfg, f.name, coerced);
      setResult({ ok: true, text: out });
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setRunning(false);
    }
  }

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="rounded-lg border border-red-900/50 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          Failed to load tools: {loadError}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Tool list */}
      <div className="flex w-72 flex-col border-r border-forge-border">
        <div className="border-b border-forge-border p-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${tools.length} tools…`}
            className="w-full rounded-lg border border-forge-border bg-forge-bg px-3 py-2 text-sm outline-none focus:border-forge-accent"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.map((t) => (
            <button
              key={t.function.name}
              onClick={() => selectTool(t)}
              className={`block w-full border-b border-forge-border/50 px-3 py-2 text-left transition hover:bg-forge-panel ${
                selected?.function.name === t.function.name ? "bg-forge-panel" : ""
              }`}
            >
              <div className="truncate font-mono text-xs text-forge-accent">
                {t.function.name}
              </div>
              <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-forge-muted">
                {t.function.description}
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="p-4 text-center text-xs text-forge-muted">No matches</div>
          )}
        </div>
      </div>

      {/* Detail / runner */}
      <div className="flex-1 overflow-y-auto p-6">
        {!selected ? (
          <div className="flex h-full items-center justify-center text-sm text-forge-muted">
            Select a tool to inspect and run it
          </div>
        ) : (
          <div className="mx-auto max-w-xl">
            <h2 className="font-mono text-lg font-semibold text-forge-accent">
              {selected.function.name}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-forge-muted">
              {selected.function.description}
            </p>

            <div className="mt-6 space-y-4">
              {Object.entries(selected.function.parameters.properties).map(([name, spec]) => {
                const required = selected.function.parameters.required.includes(name);
                return (
                  <div key={name}>
                    <label className="mb-1 block text-xs font-medium">
                      <span className="font-mono text-forge-text">{name}</span>
                      <span className="ml-2 text-forge-muted">
                        {spec.type}
                        {required && <span className="ml-1 text-forge-accent">*</span>}
                      </span>
                    </label>
                    {spec.enum && spec.enum.length > 0 ? (
                      <select
                        value={args[name] ?? ""}
                        onChange={(e) => setArgs((a) => ({ ...a, [name]: e.target.value }))}
                        className="w-full rounded-lg border border-forge-border bg-forge-panel px-3 py-2 text-sm outline-none focus:border-forge-accent"
                      >
                        <option value="">—</option>
                        {spec.enum.map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    ) : spec.type === "boolean" ? (
                      <select
                        value={args[name] ?? ""}
                        onChange={(e) => setArgs((a) => ({ ...a, [name]: e.target.value }))}
                        className="w-full rounded-lg border border-forge-border bg-forge-panel px-3 py-2 text-sm outline-none focus:border-forge-accent"
                      >
                        <option value="">—</option>
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </select>
                    ) : (
                      <input
                        value={args[name] ?? ""}
                        onChange={(e) => setArgs((a) => ({ ...a, [name]: e.target.value }))}
                        placeholder={spec.description}
                        className="w-full rounded-lg border border-forge-border bg-forge-panel px-3 py-2 text-sm outline-none focus:border-forge-accent"
                      />
                    )}
                    {spec.description && (
                      <p className="mt-1 text-[11px] text-forge-muted">{spec.description}</p>
                    )}
                  </div>
                );
              })}
              {Object.keys(selected.function.parameters.properties).length === 0 && (
                <p className="text-xs text-forge-muted">This tool takes no arguments.</p>
              )}
            </div>

            <button
              onClick={run}
              disabled={running}
              className="mt-6 rounded-lg bg-forge-accent px-4 py-2 text-sm font-semibold text-black transition hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {running ? "Running…" : "Run tool"}
            </button>

            {result && (
              <div className="mt-6">
                <div className="mb-1 flex items-center justify-between">
                  <span
                    className={`text-xs font-semibold ${
                      result.ok ? "text-green-400" : "text-red-400"
                    }`}
                  >
                    {result.ok ? "Result" : "Error"}
                  </span>
                  <button
                    onClick={() => navigator.clipboard.writeText(result.text)}
                    className="text-[11px] text-forge-muted hover:text-forge-text"
                  >
                    Copy
                  </button>
                </div>
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border border-forge-border bg-forge-bg p-3 font-mono text-xs leading-relaxed">
                  {result.text}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
