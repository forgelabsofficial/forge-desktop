import { useMemo, useState } from "react";
import type { ConnectionConfig } from "../types";
import type { NotificationItem } from "../hooks/useEventStream";
import { groupNotificationsByPackage } from "../hooks/useEventStream";
import { dispatchNotificationAction } from "../notifications";

interface Props {
  cfg: ConnectionConfig;
  notifications: NotificationItem[];
  onClear: () => void;
}

/**
 * Task 11.4 - In-app notification mirror with per-notification action
 * buttons. Fixes to the top-right of the desktop; stacked by package.
 */
export default function NotificationPanel({ cfg, notifications, onClear }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  const groups = useMemo(
    () => groupNotificationsByPackage(notifications).slice(0, 6),
    [notifications]
  );

  const total = notifications.length;

  return (
    <div
      className="fixed right-3 top-14 z-50 w-80 overflow-hidden rounded-xl border border-slate-700 bg-slate-900/95 shadow-2xl backdrop-blur"
      data-testid="notification-panel"
    >
      <div className="flex items-center justify-between border-b border-slate-700 bg-slate-800/80 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </span>
          <span className="text-sm font-semibold text-slate-100">
            Notifications {total > 0 && <span className="text-slate-400">({total})</span>}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="rounded px-1.5 text-sm text-slate-400 hover:bg-slate-700 hover:text-slate-100"
            title={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? "▸" : "▾"}
          </button>
          <button
            onClick={onClear}
            className="rounded px-1.5 text-sm text-slate-400 hover:bg-slate-700 hover:text-slate-100"
            title="Clear all"
          >
            ✕
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="max-h-96 overflow-y-auto p-2">
          {groups.length === 0 && (
            <div className="px-2 py-6 text-center text-sm text-slate-500">
              No device notifications yet.
            </div>
          )}
          {groups.map((g) => (
            <div key={g.packageName} className="mb-2 last:mb-0">
              <div className="mb-1 px-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                {g.packageName}
              </div>
              <div className="space-y-1.5">
                {g.items.map((n) => (
                  <div
                    key={n.id}
                    className="rounded-lg border border-slate-700/70 bg-slate-800/60 p-2"
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className="mt-0.5 h-8 w-8 flex-shrink-0 rounded-md bg-slate-700/60 bg-center bg-no-repeat"
                        style={
                          n.icon
                            ? {
                                backgroundImage: `url(data:image/png;base64,${n.icon})`,
                                backgroundSize: "cover",
                              }
                            : undefined
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-semibold text-slate-100">
                          {n.title || n.packageName}
                        </div>
                        <div className="line-clamp-2 text-xs text-slate-400">{n.body}</div>
                      </div>
                    </div>
                    {n.actions && n.actions.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {n.actions.map((a, idx) => (
                          <button
                            key={`${n.id}-${a.id ?? idx}`}
                            onClick={() =>
                              dispatchNotificationAction(cfg, n.id, a.id ?? String(idx))
                            }
                            className="rounded-md border border-slate-600 bg-slate-700/60 px-2 py-0.5 text-[11px] text-slate-200 hover:bg-slate-600"
                          >
                            {a.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}