/**
 * Task 21.1-21.7 (partial) - Manual verification examples for the Task 14
 * metrics collector. Follows the repo's verification-script convention
 * (see connectionManager.test.ts): import, run, observe console output.
 *
 * To verify manually:
 *   1. Import { metrics, formatBytes } from "./metrics"
 *   2. Run verifyMetrics() and check the console lines match expectations
 */

import { metrics, formatBytes } from "./metrics";

export function verifyMetrics(): void {
  const results: string[] = [];

  // 14.1: execution metrics
  const t1 = metrics.recordToolStart("file_read");
  metrics.recordToolEnd("file_read", t1, true);
  const t2 = metrics.recordToolStart("file_read");
  metrics.recordToolEnd("file_read", t2, true);
  const t3 = metrics.recordToolStart("file_read");
  metrics.recordToolEnd("file_read", t3, false);

  const list = metrics.getToolMetrics();
  const fr = list.find((m) => m.toolName === "file_read");
  results.push(`file_read: success=${fr?.success} failure=${fr?.failure} avg=${fr?.avgMs.toFixed(0)}ms`);
  // Expect success=2 failure=1
  results.push(fr?.success === 2 && fr?.failure === 1 ? "PASS" : "FAIL");

  // 14.2: success rate
  const rate = metrics.successRate(fr!);
  results.push(`successRate=${rate.toFixed(0)}%`); // expect ~67
  results.push(Math.round(rate) === 67 ? "PASS" : "FAIL");

  // 14.3: CSV export shape
  const csv = metrics.toCsv();
  results.push(`csv header=${csv.split("\n")[0]}`);
  results.push(csv.includes("toolName,avgTime,minTime,maxTime,successCount,failureCount,successRate") ? "PASS" : "FAIL");

  // 14.4: data usage + human-readable bytes
  metrics.recordTransfer("file_sync", 1024, 2048);
  metrics.recordTransfer("clipboard", 10, 20);
  results.push(`total=${JSON.stringify(metrics.getTotals())}`);
  results.push(formatBytes(1536) === "1.5 KB" ? "PASS formatBytes" : "FAIL formatBytes: " + formatBytes(1536));

  console.log("[metrics.test] " + results.join("\n[metrics.test] "));
}

/** Run when executed directly under a TS runner. */
if (typeof window !== "undefined" && (window as unknown as { __runMetricsTests?: boolean }).__runMetricsTests) {
  verifyMetrics();
}