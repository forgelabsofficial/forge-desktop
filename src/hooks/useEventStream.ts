import { useCallback, useEffect, useRef, useState } from "react";
import {
  EventStreamClient,
  type DesktopToolInvokeEvent,
  type EventMessage,
  type NotificationEvent,
  type StreamConnectionState,
} from "../eventStreamClient";
import {
  handleDesktopToolInvoke,
  sendDesktopToolRegistrations,
  setDesktopToolSender,
} from "../desktopTools";
import { showNativeNotification } from "../notifications";
import { metrics, type DataFeature } from "../metrics";
import { logger } from "../logger";
import type { ConnectionConfig } from "../types";

export interface NotificationItem {
  id: string;
  packageName: string;
  title: string;
  body: string;
  icon?: string;
  actions?: Array<{ id: string; label: string }>;
  timestamp: number;
}

export interface NotificationGroup {
  packageName: string;
  items: NotificationItem[];
}

export interface ToolActivity {
  opId: string;
  toolName: string;
  status: "started" | "running" | "completed" | "failed" | "cancelled";
  percent?: number;
  message?: string;
}

export interface EventStreamState {
  state: StreamConnectionState;
  notificationCount: number;
  notifications: NotificationItem[];
  /** Task 19.2 - true while the agent is handling a turn. */
  agentActive: boolean;
  /** Task 19.2 - live tool executions (tool_start/progress/complete/error). */
  activeTools: ToolActivity[];
  /** Clear all received notifications. */
  clearNotifications: () => void;
}

const MAX_NOTIFICATIONS = 50;

/** Group a notification list by package, most frequent package first. */
export function groupNotificationsByPackage(
  list: NotificationItem[]
): NotificationGroup[] {
  const map = new Map<string, NotificationItem[]>();
  for (const item of list) {
    const arr = map.get(item.packageName) ?? [];
    arr.push(item);
    map.set(item.packageName, arr);
  }
  return Array.from(map.entries())
    .map(([packageName, items]) => ({ packageName, items }))
    .sort((a, b) => b.items.length - a.items.length);
}

function featureForWsType(type: string): DataFeature {
  if (type === "notification" || type === "notification_removed") return "notifications";
  if (type === "clipboard") return "clipboard";
  if (type.startsWith("tool_")) return "tool_calls";
  if (type === "file_modified") return "file_sync";
  return "other";
}

export interface UseEventStreamOptions {
  /** Task 17.2 - called with the merged device config on config_changed. */
  onDeviceConfig?: (cfg: Record<string, unknown>) => void;
  /** Task 16.3 - called after every (re)connect (offline queue flush etc.). */
  onReady?: () => void;
}

/**
 * Wires the WebSocket event stream (Task 6) into the app, plus:
 * - Task 11/11.4: notifications bridge + mirror + actions
 * - Task 12: desktop tool invocations + registration push on (re)connect
 * - Task 14.4: WebSocket data-usage accounting + debug logging (Task 15.1)
 * - Task 17.2: config_changed merging
 * - Task 19.2: agent typing + tool progress state
 */
export function useEventStream(
  cfg: ConnectionConfig | null,
  opts?: UseEventStreamOptions
): EventStreamState {
  const [state, setState] = useState<StreamConnectionState>("disconnected");
  const [notificationCount, setNotificationCount] = useState(0);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [agentActive, setAgentActive] = useState(false);
  const [activeTools, setActiveTools] = useState<ToolActivity[]>([]);

  // Keep callbacks stable so the WS effect doesn't restart every render.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const clearNotifications = useCallback(() => {
    setNotifications([]);
    setNotificationCount(0);
  }, []);

  useEffect(() => {
    if (!cfg) return;

    const client = new EventStreamClient({ host: cfg.host, port: cfg.port, token: cfg.token });

    // Give the desktop tool runtime a live sender so registrations can be
    // pushed to the device (Task 12.1).
    setDesktopToolSender((msg: unknown) => client.sendRaw(msg));

    const onState = (change: { to: StreamConnectionState }) => setState(change.to);

    // Re-register tools + flush offline queue after every (re)connect.
    const onReady = () => {
      sendDesktopToolRegistrations();
      optsRef.current?.onReady?.();
    };

    const upsertTool = (t: ToolActivity) =>
      setActiveTools((list) => {
        const rest = list.filter((x) => x.opId !== t.opId);
        return [t, ...rest].slice(0, 20);
      });

    const onEvent = (msg: EventMessage) => {
      // Task 14.4 - data usage accounting for every inbound WS message.
      const rawLen = JSON.stringify(msg).length;
      metrics.recordTransfer(featureForWsType(msg.type), 0, rawLen);
      logger.debug(`ws <- ${msg.type} (${rawLen} bytes)`);

      // Task 12.2 - device wants a desktop tool executed.
      if (msg.type === "desktop_tool_invoke") {
        const inv = (msg.payload ?? {}) as Partial<DesktopToolInvokeEvent>;
        if (inv.invokeId) {
          void handleDesktopToolInvoke(
            inv.invokeId,
            inv.toolName ?? "",
            inv.args ?? {},
            (invokeId, success, output) =>
              client.sendDesktopToolResult(invokeId, success, output),
            inv.timeout ?? 30
          );
        }
        return;
      }

      // Task 17.2 - server config wins.
      if (msg.type === "config_changed") {
        const p = (msg.payload ?? {}) as Record<string, unknown>;
        optsRef.current?.onDeviceConfig?.(p);
        return;
      }

      // Task 19.2 - agent turn / tool progress indicators.
      if (msg.type === "agent_turn") {
        const p = (msg.payload ?? {}) as { active?: boolean };
        setAgentActive(p.active ?? true);
        return;
      }
      if (msg.type === "tool_start") {
        const p = (msg.payload ?? {}) as { opId?: string; toolName?: string };
        if (p.opId) {
          setAgentActive(true);
          upsertTool({
            opId: p.opId,
            toolName: p.toolName ?? "tool",
            status: "started",
          });
        }
        return;
      }
      if (msg.type === "tool_progress") {
        const p = (msg.payload ?? {}) as {
          opId?: string;
          toolName?: string;
          percent?: number;
          message?: string;
        };
        if (p.opId) {
          upsertTool({
            opId: p.opId,
            toolName: p.toolName ?? "tool",
            status: "running",
            percent: p.percent ?? 0,
            message: p.message,
          });
        }
        return;
      }
      if (msg.type === "tool_complete" || msg.type === "tool_error") {
        const p = (msg.payload ?? {}) as { opId?: string; toolName?: string };
        if (p.opId) {
          upsertTool({
            opId: p.opId,
            toolName: p.toolName ?? "tool",
            status: msg.type === "tool_complete" ? "completed" : "failed",
          });
          // Keep a short fade: remove after 3s.
          setTimeout(
            () => setActiveTools((list) => list.filter((x) => x.opId !== p.opId)),
            3000
          );
        }
        return;
      }

      if (msg.type !== "notification") return;
      const p = (msg.payload ?? {}) as Partial<NotificationEvent>;

      // Device notification removed -> drop the local mirror.
      if (p.removed) {
        setNotifications((list) => list.filter((n) => n.id !== p.id));
        return;
      }

      const item: NotificationItem = {
        id: p.id ?? String(msg.timestamp),
        packageName: p.packageName ?? "unknown",
        title: p.title ?? "Forge OS",
        body: p.body ?? "",
        icon: p.icon,
        actions: p.actions,
        timestamp: msg.timestamp ?? Date.now(),
      };
      setNotificationCount((n) => n + 1);
      setNotifications((list) =>
        [item, ...list.filter((n) => n.id !== item.id)].slice(0, MAX_NOTIFICATIONS)
      );

      // Native desktop notification (Task 11.3), browser fallback.
      showNativeNotification(item.title, item.body, item.icon).catch(() => {
        try {
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            new Notification(item.title, { body: item.body });
          }
        } catch {
          /* ignore */
        }
      });
    };

    client.on("state-changed", onState);
    client.on("connected", onReady);
    client.on("reconnected", onReady);
    client.on("event", onEvent);
    client.connect();
    client.subscribe([
      "tool_start",
      "tool_progress",
      "tool_complete",
      "tool_error",
      "agent_turn",
      "file_modified",
      "notification",
      "clipboard",
      "config_changed",
      "desktop_tool_invoke",
    ]);

    return () => {
      client.off("state-changed", onState);
      client.off("connected", onReady);
      client.off("reconnected", onReady);
      client.off("event", onEvent);
      setDesktopToolSender(null);
      client.cleanup();
    };
  }, [cfg]);

  return { state, notificationCount, notifications, agentActive, activeTools, clearNotifications };
}