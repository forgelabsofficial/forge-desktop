/**
 * Task 16 - Error recovery: circuit breaker (Rust-backed) + offline queue
 * (IndexedDB-backed, Task 16.3/16.4).
 */

// ─── Circuit breaker (Task 16.2) ────────────────────────────────────────────

const isTauri = "__TAURI_INTERNALS__" in window;

async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** Gate a request through the circuit breaker (no-op outside Tauri). */
export async function circuitAllow(profileId: string): Promise<boolean> {
  if (!isTauri) return true;
  try {
    return await invoke<boolean>("circuit_allow", { profileId });
  } catch {
    return true;
  }
}

export async function circuitReport(profileId: string, success: boolean): Promise<void> {
  if (!isTauri) return;
  try {
    await invoke<void>("circuit_report", { profileId, success });
  } catch {
    /* ignore */
  }
}

export async function circuitStatus(): Promise<
  Record<string, { state: string; failures: number }>
> {
  if (!isTauri) return {};
  try {
    return await invoke<Record<string, { state: string; failures: number }>>("circuit_status", {});
  } catch {
    return {};
  }
}

// ─── Offline queue (Task 16.3/16.4) ─────────────────────────────────────────

export interface QueuedOperation {
  id: string;
  kind: "chat" | "tool" | "config";
  payload: Record<string, unknown>;
  createdAt: number;
  attempts: number;
}

const DB_NAME = "forge-offline-queue";
const STORE = "ops";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("tx failed"));
    tx.onabort = () => reject(tx.error ?? new Error("tx aborted"));
  });
}

class OfflineQueue {
  private listeners = new Set<() => void>();
  private processing = false;

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  async enqueue(op: Omit<QueuedOperation, "id" | "createdAt" | "attempts">): Promise<void> {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({
      ...op,
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`,
      createdAt: Date.now(),
      attempts: 0,
    } as QueuedOperation);
    await txDone(tx);
    this.emit();
  }

  async count(): Promise<number> {
    const db = await openDb();
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).count();
    return new Promise((resolve) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(0);
    });
  }

  async list(): Promise<QueuedOperation[]> {
    const db = await openDb();
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    return new Promise((resolve) => {
      req.onsuccess = () => resolve((req.result as QueuedOperation[]) ?? []);
      req.onerror = () => resolve([]);
    });
  }

  async cancelAll(): Promise<void> {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    await txDone(tx);
    this.emit();
  }

  /**
   * Task 16.3/16.4 - Process queued operations FIFO when the connection is
   * restored. Skips (drops) ops older than 1 hour. Failed ops are retried
   * up to 3 attempts, then dropped.
   */
  async processAll(runner: (op: QueuedOperation) => Promise<void>): Promise<number> {
    if (this.processing) return 0;
    this.processing = true;
    let done = 0;
    try {
      const ops = (await this.list()).sort((a, b) => a.createdAt - b.createdAt);
      const now = Date.now();
      for (const op of ops) {
        if (now - op.createdAt > 60 * 60 * 1000) {
          await this.remove(op.id);
          continue;
        }
        try {
          await runner(op);
          await this.remove(op.id);
          done++;
        } catch {
          op.attempts += 1;
          if (op.attempts >= 3) {
            await this.remove(op.id);
          } else {
            await this.update(op);
          }
        }
      }
    } finally {
      this.processing = false;
    }
    this.emit();
    return done;
  }

  private async remove(id: string): Promise<void> {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    await txDone(tx);
  }

  private async update(op: QueuedOperation): Promise<void> {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(op);
    await txDone(tx);
  }
}

export const offlineQueue = new OfflineQueue();