import { useEffect, useState } from "react";
import { formatBytes, metrics, type ToolMetrics } from "../metrics";
import { exportDiagnostics } from "../diagnostics";

/**
 * Task 14.2/14.3 - Monitoring dashboard: tool metrics table, data usage,
 * CSV export, reset, and diagnostics export (Task 15.3).
 */
export default function MonitoringDashboard() {
  const [, setTick] = useState(0);
  const [csvUrl, setCsvUrl] = useState<string | null>(null);
  const [diagStatus, setDiagStatus] = useState<string>("");

  useEffect(() => {
    const unsub = metrics.subscribe(() => setTick((t) => t + 1));
    return unsub;
  }, []);

  const toolMetrics = metrics.getToolMetrics();
  const usage = metrics.getUsage();
  const totals = metrics.getTotals();
  const maxUsage = usage.reduce((a, u) => Math.max(a, u.sent + u.received), 1);

  function downloadCsv() {
    const blob = new Blob([metrics.toCsv()], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    setCsvUrl(url);
    const a = document.createElement("a");
    a.href = url;
    a.download = `forge-tool-metrics-${Date.now()}.csv`;
    a.click();
  }

  async function handleDiagnostics() {
    try {
      const file = await exportDiagnostics();
      setDiagStatus(`Exported: ${file}`);
    } catch (e) {
      setDiagStatus(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-forge-text">Monitoring</h2>
        <div className="flex gap-2">
          <button
            onClick={downloadCsv}
            className="rounded-lg border border-forge-border bg-forge-panel px-3 py-1.5 text-xs font-medium hover:bg-forge-bg"
          >
            Export CSV
          </button>
          <button
            onClick={handleDiagnostics}
            className="rounded-lg border border-forge-border bg-forge-panel px-3 py-1.5 text-xs font-medium hover:bg-forge-bg"
          >
            Export diagnostics
          </button>
          <button
            onClick={() => {
              metrics.reset();
              setCsvUrl(null);
            }}
            className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20"
          >
            Reset metrics
          </button>
        </div>
      </div>
      {diagStatus && <div className="text-xs text-forge-muted">{diagStatus}</div>}

      {/* Data usage (Task 14.4) */}
      <section className="rounded-xl border border-forge-border bg-forge-panel p-4">
        <h3 className="mb-2 text-sm font-semibold text-forge-text">Data usage</h3>
        <div className="mb-3 flex flex-wrap gap-4 text-sm">
          <span className="text-forge-text">
            Total: <b>{formatBytes(totals.sent + totals.received)}</b>
          </span>
          <span className="text-forge-muted">↑ {formatBytes(totals.sent)}</span>
          <span className="text-forge-muted">↓ {formatBytes(totals.received)}</span>
        </div>
        {usage.length === 0 ? (
          <p className="text-xs text-forge-muted">No transfers recorded yet.</p>
        ) : (
          <div className="space-y-1.5">
            {usage.map((u) => (
              <div key={u.feature} className="flex items-center gap-2 text-xs">
                <span className="w-28 flex-shrink-0 capitalize text-forge-muted">
                  {u.feature.replace("_", " ")}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded bg-forge-bg">
                  <div
                    className="h-full rounded bg-forge-accent/70"
                    style={{
                      width: `${Math.max(2, ((u.sent + u.received) / maxUsage) * 100)}%`,
                    }}
                  />
                </div>
                <span className="w-40 text-right tabular-nums text-forge-muted">
                  {formatBytes(u.sent + u.received)} (↑{formatBytes(u.sent)} ↓
                  {formatBytes(u.received)})
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Tool metrics table (Task 14.2) */}
      <section className="rounded-xl border border-forge-border bg-forge-panel p-4">
        <h3 className="mb-2 text-sm font-semibold text-forge-text">Tool performance</h3>
        {toolMetrics.length === 0 ? (
          <p className="text-xs text-forge-muted">Run a tool to see metrics.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-forge-border text-xs uppercase tracking-wide text-forge-muted">
                <th className="pb-2">Tool</th>
                <th className="pb-2">Success rate</th>
                <th className="pb-2">Avg</th>
                <th className="pb-2">Min</th>
                <th className="pb-2">Max</th>
                <th className="pb-2">Runs</th>
              </tr>
            </thead>
            <tbody>
              {toolMetrics.map((m: ToolMetrics) => (
                <tr
                  key={m.toolName}
                  className={`border-b border-forge-border/50 last:border-0 ${
                    metrics.isSlow(m) ? "bg-red-500/10 text-red-300" : ""
                  }`}
                >
                  <td className="py-1.5 font-medium text-forge-text">
                    {m.toolName}
                    {metrics.isSlow(m) && (
                      <span className="ml-2 rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-semibold">
                        SLOW
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 tabular-nums text-forge-text">
                    {metrics.successRate(m).toFixed(0)}%
                  </td>
                  <td className="py-1.5 tabular-nums text-forge-muted">{m.avgMs.toFixed(0)} ms</td>
                  <td className="py-1.5 tabular-nums text-forge-muted">
                    {m.minMs === Number.MAX_SAFE_INTEGER ? "—" : `${m.minMs} ms`}
                  </td>
                  <td className="py-1.5 tabular-nums text-forge-muted">{m.maxMs} ms</td>
                  <td className="py-1.5 tabular-nums text-forge-muted">
                    {m.success + m.failure}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {csvUrl && (
        <p className="text-xs text-forge-muted">
          CSV written — check your downloads folder.
        </p>
      )}
    </div>
  );
}