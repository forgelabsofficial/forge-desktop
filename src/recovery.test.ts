/**
 * Task 21.6/21.7 (partial) + Task 16 - Manual verification examples for the
 * circuit breaker wrapper and offline queue.
 *
 * To verify manually:
 *   1. Import { circuitAllow/circuitReport } and { offlineQueue } from "./recovery"
 *   2. Run verifyRecovery() (Tauri build recommended for the real breaker)
 */

import { circuitAllow, circuitReport, offlineQueue } from "./recovery";

export async function verifyRecovery(): Promise<void> {
  const results: string[] = [];

  // Circuit breaker: 5 failures should trip the breaker open.
  const id = "test-profile";
  for (let i = 0; i < 5; i++) await circuitReport(id, false);
  const allow1 = await circuitAllow(id);
  results.push(`after 5 failures allow=${allow1} (expect false in Tauri, true in browser)`);

  // Success closes it again.
  await circuitReport(id, true);
  const allow2 = await circuitAllow(id);
  results.push(`after success allow=${allow2} (expect true)`);

  // Offline queue: enqueue -> count -> process -> count 0.
  await offlineQueue.cancelAll();
  await offlineQueue.enqueue({ kind: "chat", payload: { message: "hello" } });
  await offlineQueue.enqueue({ kind: "chat", payload: { message: "world" } });
  const n = await offlineQueue.count();
  results.push(`queued=${n} (expect 2)`);

  const processed = await offlineQueue.processAll(async (op) => {
    if (op.payload.message === "world") throw new Error("simulated failure");
  });
  results.push(`processed=${processed} (expect 1, the other retries and drops after 3)`);
  results.push(`remaining=${await offlineQueue.count()}`);

  await offlineQueue.cancelAll();
  console.log("[recovery.test] " + results.join("\n[recovery.test] "));
}