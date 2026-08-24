# Forge Desktop — User Guide

Covers everything you can do from the desktop app.

## Connection management

- **Profiles** are stored per device (host:port), tokens encrypted in the OS keychain.
- **Automatic reconnect**: the app watches `navigator.onLine`; when the network returns it
  reconnects the WebSocket (exponential backoff, max 30s) and re-registers desktop tools.
- **Fallback order**: TCP → ADB tunnel → (relay placeholder).
- **Offline queue**: chat/config operations that fail while offline are parked in IndexedDB
  and flushed FIFO on reconnect (items older than 1h are dropped). The amber **Queue n ✕**
  button in the header shows pending count and lets you cancel all.

## Chat & sessions (Task 19)

- **+ New session** starts a fresh conversation; every exchange is persisted locally
  (last 40 messages per session, up to 20 sessions shown).
- **Resume**: click a session chip in the top bar to restore its history.
- **Expiry**: sessions idle for >20h show a warning; >24h they are removed.
- **Typing indicator**: shows the agent thinking and live tool progress
  (tool name + percent from `tool_progress` events).

## Tools

- Tool list loads from `GET /api/tools`, cached and refreshed every 5 minutes.
- Args are validated client-side with **Zod** (built from the JSON schema).
- Invocation is **async**: `POST /api/tool` returns an `opId`, which is polled on
  `/api/tool/{opId}/status` until completion; progress events also stream over WS.
- The **Copy TS types** button exports generated type definitions.

## File sync (Task 9)

- Watch a folder: `syncWatch(path)` → debounced (500ms) batched `sync://file-change` events.
- Upload: chunked (256KB) with whole-file SHA-256 verified on every chunk; gzip compression
  flag for bandwidth-limited mode; 3-pass retry.
- Download: resumable via `Range` headers.
- Conflicts (Task 9.5): `syncAuto` compares mtime + checksum; remote newer → skip,
  same mtime + different content → keep both as `.conflict-<timestamp>`.

## Clipboard (Task 10)

- Desktop clipboard is polled (300ms, 500ms debounce) and pushed to the device
  (`POST /api/clipboard`); Android changes are forwarded as `clipboard://changed` events.
- Images supported (PNG, 2MP cap): desktop reads image clipboard, Android sets a real
  pastable image via FileProvider.
- Optional AES-256-GCM encrypt/decrypt helpers are available (`clipboard_encrypt`).

## Notifications (Task 11)

- Grant Notification access on the device; notifications stream over WS and mirror in the
  top-right panel, grouped by app.
- Native desktop notifications use the OS notification system (Tauri).
- **Action buttons** in the mirror panel send `POST /api/notification/action`
  back to the device, which fires the original `PendingIntent` (11.4).
- Dismissals sync both ways (removed events drop the mirror).

## Monitoring & metrics (Task 14)

- **Tool performance**: success rate, avg/min/max execution time per tool; tools running
  >200% of the overall average are highlighted **SLOW**.
- **Data usage**: per-feature bars (file sync / clipboard / notifications / tool calls)
  with human-readable sizes; configurable threshold warning.
- **Export CSV** downloads the metrics table; **Reset metrics** clears it.

## Settings & bandwidth-saver (Tasks 17/18)

- Toggles: **bandwidth-saver**, file sync, clipboard sync, notifications; data usage threshold.
- Synced to the device via `POST /api/config`; device-side changes come back via
  `config_changed` events and **server wins**.
- Bandwidth-saver stops the file watcher and clipboard watcher immediately.

## Diagnostics (Task 15)

- Every request/response and WS message is logged (tokens redacted) to a rotating file
  (10MB, keeps 5) plus an in-memory ring.
- **Export diagnostics** (Monitor tab) bundles the last 1000 log entries, system info,
  redacted profiles, and the last 10 errors into a timestamped JSON download.