# Forge Systems — Verification Checklist (Tasks 20 & 23)

Run these against a real device + desktop build. Mark each line as you go; both
checkpoints are considered complete when all boxes are ticked.

## Local build prerequisites

- [ ] `cd forge-desktop && npm install && npm run build` passes
- [ ] `cd forge-desktop/src-tauri && cargo check` passes
- [ ] Android: `gradle assembleDebug` passes (JavaWebSocket, java-jwt, Hilt)
- [ ] Desktop app launches and shows the Connect screen

## Task 20 — Core functionality

- [ ] **Pairing**: initiate shows a 6-digit code; confirm accepts it; a JWT is received and
      stored in the keychain; a second confirm with the same code fails (single-use)
- [ ] **Pairing expiry**: wait 5 minutes; the stale code is rejected
- [ ] **WebSocket**: LIVE badge flips connected; `auth_ok` + `subscribed` observed
- [ ] **Events**: run `android_battery` → `tool_start` → `tool_progress` → `tool_complete`
      events visible in the debug log
- [ ] **Async tool**: `POST /api/tool` returns `opId` immediately; status polls to completed
- [ ] **Cancellation**: cancel a long tool → status `cancelled`, `tool_error` emitted
- [ ] **Reconnect**: airplane-mode the phone → RECONNECTING → restore → LIVE again with no
      manual action; tool registrations re-sent (see device log)
- [ ] **Fallback**: with TCP blocked, ADB tunnel path connects (or logs the attempt order)
- [ ] **JWT auth**: token from pairing works on `/api/tools`; garbage token → 401
- [ ] **Multi-client**: 2 desktops on one token both receive events; 6th WS client rejected

## Task 23 — Full system verification

- [ ] **Tools**: `file_read` on a real workspace file; `alarm_set` with progress %
- [ ] **File sync**: edit a file in the watched folder → appears on device (checksum OK);
      device-side change → `file_modified` event → desktop mirror
- [ ] **Sync resume**: kill the upload mid-chunk → retry completes
- [ ] **Sync conflict**: same mtime, different content on both sides → `.conflict-<ts>` copy
- [ ] **Compression**: enable bandwidth-saver → uploads send `compressed=true` and the
      device decompresses correctly (file content identical)
- [ ] **Clipboard text**: desktop → phone within ~2s; phone → desktop within ~2s; no echo loop
- [ ] **Clipboard image**: copy a screenshot on desktop → paste on Android as real image
- [ ] **Notifications**: trigger an Android notification → desktop mirror ≤3s with icon;
      click an action button → PendingIntent fires on the phone; dismiss on phone → mirror drops
- [ ] **Sessions**: new session + resume restores history; >20h idle shows stale warning
- [ ] **Metrics**: run 5+ tools → Monitor shows avg/min/max, success rate, usage bars;
      CSV downloads; Reset clears
- [ ] **Offline queue**: kill network, send a chat → Queue badge increments; restore →
      message flushes automatically; Cancel ✕ empties the queue
- [ ] **Circuit breaker**: 5 unreachable pings → "circuit open" error → recovers after 30s
- [ ] **Diagnostics**: Export downloads a JSON with 1000-log ring, system info, redacted profiles
- [ ] **Log rotation**: log file >10MB → rotates, keeping 5 (`forge-desktop-<date>.log*`)
- [ ] **Performance**: health poll 10s ✓ · clipboard sync ≤2s ✓ · notification ≤3s ✓ ·
      event broadcast ≤500ms ✓
- [ ] **Platforms**: repeat core flows on macOS, Windows, Linux

## Mock server (no device needed)

```bash
cd forge-desktop
pip install websockets        # optional, only for WS
python mock_server.py 8789 --ws
```
- [ ] Pair with any 6-digit code → token returned
- [ ] Tools tab runs `android_battery` via opId/status flow
- [ ] Chat replies with the mock agent response; sessions persist
- [ ] `ws://127.0.0.1:8789/api/events` connects (when `--ws`)