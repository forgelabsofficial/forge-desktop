import type { ConnectionConfig } from "./types";
const isTauri = "__TAURI_INTERNALS__" in window;

async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** Show a native desktop notification (Task 11.3). iconB64 is a Base64 PNG. */
export async function showNativeNotification(
  title: string,
  body: string,
  iconB64?: string
): Promise<void> {
  if (!isTauri) {
    throw new Error("Native notifications require the desktop (Tauri) build.");
  }
  return invoke<void>("notify_show", {
    title,
    body,
    iconB64: iconB64 ?? null,
  });
}

/** Action reference sent with notification events. */
export interface NotificationActionRef {
  id: string;
  label: string;
}

/**
 * Fire a notification action on the device (Task 11.4 round trip).
 * The Android side triggers the stored PendingIntent for the action.
 */
export async function dispatchNotificationAction(
  cfg: ConnectionConfig,
  notificationId: string,
  actionId: string
): Promise<{ triggered: boolean }> {
  const { postNotificationAction } = await import("./api");
  return postNotificationAction(cfg, notificationId, actionId);
}
