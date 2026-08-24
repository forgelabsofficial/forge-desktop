import type { ConnectionConfig } from "./types";

export interface ClipboardPayload {
  text: string;
  timestamp: number;
}

export interface ClipboardPushResult {
  updated: boolean;
}

export interface ClipboardEncrypted {
  algorithm: string;
  keyB64: string;
  nonceB64: string;
  ciphertextB64: string;
}

const isTauri = "__TAURI_INTERNALS__" in window;

async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

function requireTauri(): void {
  if (!isTauri) {
    throw new Error("Clipboard sync requires the desktop (Tauri) build.");
  }
}

/** Start the clipboard watcher; pushes changes to the device when pushEnabled. */
export async function startClipboardSync(
  cfg: ConnectionConfig,
  opts?: { pushEnabled?: boolean }
): Promise<void> {
  requireTauri();
  return invoke<void>("clipboard_start", {
    host: cfg.host,
    port: cfg.port,
    token: cfg.token,
    pushEnabled: opts?.pushEnabled ?? false,
  });
}

/** Stop the clipboard watcher. */
export async function stopClipboardSync(): Promise<void> {
  requireTauri();
  return invoke<void>("clipboard_stop", {});
}

/** Read the current system clipboard text. */
export async function getClipboardText(): Promise<string> {
  requireTauri();
  return invoke<string>("clipboard_get", {});
}

/** Replace the system clipboard text. */
export async function setClipboardText(text: string): Promise<void> {
  requireTauri();
  return invoke<void>("clipboard_set", { text });
}

/** Push text to the device clipboard right now. */
export async function pushClipboardToDevice(
  cfg: ConnectionConfig,
  text: string
): Promise<ClipboardPushResult> {
  requireTauri();
  return invoke<ClipboardPushResult>("clipboard_push", {
    host: cfg.host,
    port: cfg.port,
    token: cfg.token,
    text,
  });
}

/** AES-256-GCM encrypt (random key+nonce unless keyB64 supplied). */
export async function encryptClipboard(
  plaintext: string,
  keyB64?: string
): Promise<ClipboardEncrypted> {
  requireTauri();
  return invoke<ClipboardEncrypted>("clipboard_encrypt", {
    plaintext,
    keyB64: keyB64 ?? null,
  });
}

/** AES-256-GCM decrypt. */
export async function decryptClipboard(enc: {
  keyB64: string;
  nonceB64: string;
  ciphertextB64: string;
}): Promise<string> {
  requireTauri();
  return invoke<string>("clipboard_decrypt", {
    keyB64: enc.keyB64,
    nonceB64: enc.nonceB64,
    ciphertextB64: enc.ciphertextB64,
  });
}