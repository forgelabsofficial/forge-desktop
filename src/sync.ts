import type { ConnectionConfig } from "./types";

export interface SyncUploadResult {
  path: string;
  chunks: number;
  complete: boolean;
  bytes: number;
  compressed: boolean;
}

export interface SyncDownloadResult {
  path: string;
  bytes: number;
  resumed: boolean;
}

export interface SyncFileChange {
  kind: string;
  paths: string[];
}

export interface SyncStatResult {
  exists: boolean;
  size?: number | null;
  lastModified?: number | null;
  checksum?: string | null;
}

export interface SyncAutoResult {
  action: "uploaded" | "noop" | "skip_remote_newer" | "conflict_kept_both";
  path: string;
  bytes: number;
  compressed: boolean;
}

const isTauri = "__TAURI_INTERNALS__" in window;

async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

function requireTauri(): void {
  if (!isTauri) {
    throw new Error("File sync requires the desktop (Tauri) build.");
  }
}

/** Upload a local file to the device in chunks (Task 9.2). */
export async function syncUploadFile(
  cfg: ConnectionConfig,
  localPath: string,
  remotePath: string,
  opts?: {
    chunkSize?: number;
    compress?: boolean;
    localModifiedMs?: number;
    remoteModifiedMs?: number;
  }
): Promise<SyncUploadResult> {
  requireTauri();
  return invoke<SyncUploadResult>("sync_upload_file", {
    host: cfg.host,
    port: cfg.port,
    token: cfg.token,
    localPath,
    remotePath,
    chunkSize: opts?.chunkSize,
    compress: opts?.compress,
    localModifiedMs: opts?.localModifiedMs,
    remoteModifiedMs: opts?.remoteModifiedMs,
  });
}

/** Download a file from the device to localDir (Task 9.4). */
export async function syncDownload(
  cfg: ConnectionConfig,
  remotePath: string,
  localDir: string,
  offset?: number
): Promise<SyncDownloadResult> {
  requireTauri();
  return invoke<SyncDownloadResult>("sync_download", {
    host: cfg.host,
    port: cfg.port,
    token: cfg.token,
    remotePath,
    localDir,
    offset,
  });
}

/** Watch a directory and receive sync://file-change events (Task 9.1). */
export async function syncWatch(path: string): Promise<void> {
  requireTauri();
  return invoke<void>("sync_watch", { path });
}

/** Stop the file watcher started by `syncWatch`. */
export async function syncUnwatch(): Promise<void> {
  requireTauri();
  return invoke<void>("sync_unwatch", {});
}

/** Stat a remote file for conflict detection (Task 9.5). */
export async function syncStat(
  cfg: ConnectionConfig,
  remotePath: string
): Promise<SyncStatResult> {
  requireTauri();
  return invoke<SyncStatResult>("sync_stat", {
    host: cfg.host,
    port: cfg.port,
    token: cfg.token,
    remotePath,
  });
}

/** Full last-write-wins sync with keep-both conflicts (Task 9.5). */
export async function syncAuto(
  cfg: ConnectionConfig,
  localPath: string,
  remotePath: string
): Promise<SyncAutoResult> {
  requireTauri();
  return invoke<SyncAutoResult>("sync_auto", {
    host: cfg.host,
    port: cfg.port,
    token: cfg.token,
    localPath,
    remotePath,
  });
}