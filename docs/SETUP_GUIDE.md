# Forge Desktop — Setup Guide

Welcome to **Forge Desktop**, the Tauri companion for the Forge OS Android agent.
This guide covers first-time pairing and your first connected session.

## Prerequisites

- Forge OS app installed on your Android device with:
  - **HTTP bridge** running (ForgeHttpService) — port **8789** (default)
  - **Notification access** granted (Settings → Apps → Forge OS → Notification access) if you want on-device notification bridging
- Desktop platform: Windows / macOS / Linux with the Forge Desktop build

## 1. First-time pairing

1. Launch **Forge Desktop** → you'll land on the **Connect** screen.
2. Click **Discover devices** (mDNS) or enter the device IP manually.
3. Tap **Pair** next to your device. The app shows a 6-digit code.
4. On your phone, open Forge OS → Settings → **Pair desktop** → enter the 6-digit code.
5. Desktop confirms and stores the signed token in the OS keychain.
   - Pairing codes expire after 5 minutes (single-use).
   - Tokens are JWTs signed by the device (HS256, 1-year expiry) and rotated automatically on 401.

## 2. First look around

| Area | What it does |
|---|---|
| **Chat** | Talk to your Forge agent; sessions persist locally (40-message history, 24h expiry) |
| **Tools** | Browse device tools, validate args (Zod), run with live status polling |
| **Monitor** | Per-tool metrics + data usage, CSV export, diagnostics export |
| **Settings** | Feature toggles incl. bandwidth-saver; synced to the device via `/api/config` |

The top bar shows connection state (LIVE/RECONNECTING/IDLE), notification count,
pending offline queue size, and health (latency) status.

## 3. Verify it works

- **Events:** a LIVE badge means the WebSocket `/api/events` stream is up.
- **Tools:** run *android_battery* from the Tools tab — it should show the opId status flow.
- **Clipboard:** copy text on your phone → it appears in the desktop clipboard (and vice-versa).
- **Notifications:** trigger any notification on the phone → it mirrors top-right with action buttons.
- **Files:** add files to your workspace via sync (`sync_upload_file` / watcher) and watch
  `file_modified` events in the debug log.

## 4. Troubleshooting quick hits

| Symptom | Fix |
|---|---|
| "unauthorized" on first connect | Re-pair (codes are single-use) |
| No devices discovered | Check the phone and laptop are on the same LAN; check firewall on 8789 |
| LIVE badge stuck on RECONNECTING | Confirm the WS port (8790) is reachable |
| Notifications missing | Grant Notification access to Forge OS on the device |
| Desktop build fails | `npm install` then `npm run build`; `cargo check` in `src-tauri` |

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for the full guide.