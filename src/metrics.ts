/**
 * Task 14 - MetricsCollector: per-tool execution metrics + data usage
 * tracking. Zero-dependency (CSV export is hand-rolled instead of papaparse).
 */
import type { ConnectionConfig } from "./types";

export interface ToolMetrics {
  toolName: string;
  success: number;
  failure: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  /** rolling window of last durations, for later analysis */
  samples: number[];
}

export interface TransferRecord {
  feature: string;
  sent: number;
  received: number;
}

export type DataFeature = "file_sync" | "clipboard" | "notifications" | "tool_calls" | "other";

type Listener = () => void;

const MAX_SAMPLES = 50;

class MetricsCollector {
  private tools = new Map<string, ToolMetrics>();
  private usage = new Map<string, TransferRecord>();
  private totals: TransferRecord = { feature: "total", sent: 0, received: 0 };
  private listeners = new Set<Listener>();
  private warningEmitted = new Set<string>();
  private thresholdBytes = 100 * 1024 * 1024; // default 100MB
  private onThreshold?: (msg: string) => void;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  setThresholdBytes(bytes: number, onThreshold?: (msg: string) => void) {
    this.thresholdBytes = bytes;
    this.onThreshold = onThreshold;
  }

  /** Call before dispatching a tool. */
  recordToolStart(_toolName: string): number {
    return Date.now();
  }

  /** Call after a tool finishes; duration from recordToolStart. */
  recordToolEnd(toolName: string, startMs: number, ok: boolean) {
    const duration = Date.now() - startMs;
    const m = this.tools.get(toolName) ?? {
      toolName,
      success: 0,
      failure: 0,
      avgMs: 0,
      minMs: Number.MAX_SAFE_INTEGER,
      maxMs: 0,
      samples: [],
    };
    if (ok) m.success++;
    else m.failure++;
    m.samples.push(duration);
    if (m.samples.length > MAX_SAMPLES) m.samples.shift();
    m.avgMs = m.samples.reduce((a, b) => a + b, 0) / m.samples.length;
    if (duration < m.minMs) m.minMs = duration;
    if (duration > m.maxMs) m.maxMs = duration;
    this.tools.set(toolName, m);
    this.emit();
  }

  /** Record bytes transferred for a feature (HTTP + WebSocket). */
  recordTransfer(feature: DataFeature, sent: number, received: number) {
    if (sent < 0) sent = 0;
    if (received < 0) received = 0;
    const rec = this.usage.get(feature) ?? { feature, sent: 0, received: 0 };
    rec.sent += sent;
    rec.received += received;
    this.usage.set(feature, rec);
    this.totals.sent += sent;
    this.totals.received += received;
    this.emit();

    // Threshold warning (Task 14.4)
    const totalBytes = this.totals.sent + this.totals.received;
    if (totalBytes > this.thresholdBytes && !this.warningEmitted.has("threshold")) {
      this.warningEmitted.add("threshold");
      this.onThreshold?.(`Data usage exceeded ${formatBytes(this.thresholdBytes)}`);
    }
  }

  getToolMetrics(): ToolMetrics[] {
    return Array.from(this.tools.values()).sort((a, b) => a.toolName.localeCompare(b.toolName));
  }

  getUsage(): TransferRecord[] {
    return Array.from(this.usage.values());
  }

  getTotals(): TransferRecord {
    return { ...this.totals };
  }

  getDataUsageBytes(): number {
    return this.totals.sent + this.totals.received;
  }

  /** Classic per-tool success rate in percent. */
  successRate(m: ToolMetrics): number {
    const total = m.success + m.failure;
    return total === 0 ? 100 : (m.success / total) * 100;
  }

  /** Task 14.2 - avg > 200% of overall avg => highlight. */
  isSlow(m: ToolMetrics): boolean {
    const all = this.getToolMetrics();
    const real = all.filter((x) => x.samples.length > 0);
    if (real.length < 2) return false;
    const overall = real.reduce((a, x) => a + x.avgMs, 0) / real.length;
    return m.avgMs > overall * 2;
  }

  /** Task 14.3 - CSV export (hand-rolled, papaparse not required). */
  toCsv(): string {
    const header = "toolName,avgTime,minTime,maxTime,successCount,failureCount,successRate";
    const rows = this.getToolMetrics().map((m) =>
      [
        csvEscape(m.toolName),
        m.avgMs.toFixed(1),
        m.minMs === Number.MAX_SAFE_INTEGER ? 0 : m.minMs,
        m.maxMs,
        m.success,
        m.failure,
        this.successRate(m).toFixed(1) + "%",
      ].join(",")
    );
    return [header, ...rows].join("\n");
  }

  reset() {
    this.tools.clear();
    this.usage.clear();
    this.totals = { feature: "total", sent: 0, received: 0 };
    this.warningEmitted.clear();
    this.emit();
  }
}

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Human-readable bytes: KB / MB / GB (Task 14.4). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Small helper shared by api.ts to label a request by its path. */
export function featureForPath(path: string): DataFeature {
  if (path.includes("/sync/")) return "file_sync";
  if (path.includes("/clipboard")) return "clipboard";
  if (path.includes("/notification")) return "notifications";
  if (path.includes("/tool")) return "tool_calls";
  if (path.includes("/chat") || path.includes("/events")) return "tool_calls";
  return "other";
}

export const metrics = new MetricsCollector();

export type { ConnectionConfig };