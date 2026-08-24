# Forge Desktop — Troubleshooting Guide

## Connection problems

**"unauthorized" / HTTP 401 on connect or pairing confirm**
- Pairing codes are single-use and expire after 5 minutes. Re-run the pairing flow.
- The token may have rotated; the app re-prompts automatically (ReAuthDialog) — complete it.

**Device not discovered over mDNS**
- Same LAN / Wi-Fi? Check AP isolation is off.
- Firewall: allow inbound TCP on 8789 (HTTP) and 8790 (WebSocket).
- Try manual host:port entry, then the ADB tunnel fallback (Task 3.3).

**LIVE badge stuck on RECONNECTING**
- The HTTP server may be up while the WS port is blocked. Verify `ws://<host>:8790/api/events`.
- Check the device: ForgeHttpService running? Bridge enabled in Forge OS settings?

**"circuit open - connection failing repeatedly"**
- The circuit breaker tripped after 5 consecutive failures (Task 16.2). It auto-opens a
  test request after 30s (half-open), so just wait or reconnect; persistent failures mean
  the device is unreachable — check network first.

## Pairing issues

- Code rejected as expired → codes last 5 minutes; regenerate.
- Code accepted but token fails on first request → clock skew: ensure the device clock is
  accurate (JWT `iat`/`exp` checks).

## Sync problems (files)

- Upload fails at chunk 1 with "checksum mismatch" → the device verifies the **whole-file
  SHA-256 on every chunk**; a mid-transfer local edit will fail. Re-sync the file.
- Conflicts → `sync_auto` keeps both (`.conflict-<ts>`); resolve manually and re-upload.
- Sync dir not watching → start the watcher (`syncWatch`), and check bandwidth-saver
  isn't stopping it (Settings → File sync toggle).

## Clipboard problems

- Desktop → phone text not appearing → confirm `/api/clipboard` succeeds (Monitor tab
  data usage shows clipboard traffic). Android suppresses its own echo for 2s, so the
  mirror may lag slightly.
- Images not pastable on Android → the PNG is written to cache and exposed via FileProvider
  (`ClipData.newUri`); very large captures (>2MP) are skipped by design.
- Desktop not picking up phone clipboard → Android needs the bridge service active and the
  clipboard listener permission; check the log ring via **Export diagnostics**.

## Notifications problems

- Nothing arrives on desktop → Android **Notification access** is not granted for Forge OS.
- Actions do nothing → the original app's `PendingIntent` may require the app to be
  running; this is an Android OS limitation (Task 11.4 works for most apps).
- Windows note: the Tauri notification plugin has no native action buttons on Windows —
  use the in-app mirror panel buttons (that is the cross-platform path).

## Desktop app problems

- **Build fails on missing imports/types** → run `npm install` (this project uses zod and
  @tauri-apps plugins) then `npm run build`.
- **Rust build fails** → `cd src-tauri && cargo check`; ensure the toolchain is ≥1.77.
- **Export diagnostics is empty of file logs** → the rotating log lives in the OS app-log
  dir (Tauri `app_log_dir()`); the in-memory ring always has the last 1000 entries.

## FAQ

**Q: Is my token stored in plaintext?**
No — tokens live in the OS keychain via `keyring` (Credential Store/Keychain/libsecret).
The JWT itself is signed by the device and expires in 1 year.

**Q: Can two desktops connect at once?**
Yes, up to 5 WebSocket clients per token (10 total) — the device rejects extras (Task 2.4).

**Q: What happens to my offline queue items?**
They persist in IndexedDB, flush FIFO on reconnect, retry up to 3 times, and are dropped
after 1 hour or when you cancel them from the header button.

**Q: Where are session histories stored?**
localStorage per device (`forge-chat-<host>:<port>-<sessionId>`), capped at 40 messages,
with 24h inactivity cleanup.