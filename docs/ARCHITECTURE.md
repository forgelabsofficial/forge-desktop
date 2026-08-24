# Forge Desktop — Architecture

```mermaid
flowchart LR
    subgraph Device["Android — Forge OS"]
        HTTP[ForgeHttpServer :8789]
        WS[ForgeWebSocketServer :8790]
        EV[EventBroadcaster]
        TEM[ToolExecutionManager]
        SYNC[SyncService]
        CB[ClipboardService]
        NL[NotificationListenerService]
        PS[PairingService + JWT]
        B[DesktopToolBridge]
        HTTP --> TEM
        HTTP --> SYNC
        HTTP --> CB
        HTTP --> PS
        HTTP --> B
        NL --> EV
        TEM --> EV
        SYNC --> EV
        CB --> EV
        EV --> WS
    end

    subgraph Desktop["Forge Desktop (Tauri + React)"]
        UI[App.tsx<br/>Chat/Tools/Monitor/Settings]
        ES[useEventStream]
        API[api.ts — retry + circuit]
        M[MetricsCollector]
        Q[OfflineQueue IndexedDB]
        LOG[logger.ts redacted]
        DTR[desktopTools.ts runtime]
        SY[SyncEngine sync.rs]
        CL[ClipboardEngine clipboard.rs]
        NB[notifications.rs]
        DIAG[diagnostics.rs ring + rotate]
        CKT[circuit.rs]
        UI --> API
        UI --> ES
        API --> Q
        API --> M
        ES --> M
        ES --> LOG
        ES --> DTR
        M --> UI
        Q --> UI
        UI --> SY
        UI --> CL
        UI --> DIAG
        API --> CKT
    end

    HTTP <--> |HTTP JSON| API
    WS  <--> |JSON events| ES
    API <--> |tor.ByteArray chunks| SY
    API <--> |clipboard POST| CL
    ES <--> |desktop_tool_*| DTR
```

## Component responsibilities

| Component | Responsibility |
|---|---|
| `EventStreamClient` (TS) | WS lifecycle, backoff reconnect, resubscribe, msg emit |
| `useEventStream` (TS) | App-facing state: notifications, tool activity, agent typing, config merges |
| `api.ts` | All HTTP; token rotation (401), network retry (backoff), circuit gate, usage accounting |
| `forge_request` (Rust) | Binary-safe proxy: raw TCP, byte-searched headers, Content-Length always set |
| `ToolExecutionManager` (Kotlin) | Async op registry, progress, real Job cancellation |
| `EventBroadcaster` (Kotlin) | 1000-entry queue, type-filtered WS fan-out |
| `SyncService` (Kotlin) | Chunk reassembly, whole-file SHA-256, gzip decompress, `file_modified` events |
| `sync.rs` | Watcher (500ms debounce), chunked upload, range download, `sync_auto` conflicts |
| `PairingService` (Kotlin) | 6-digit codes (5 min), HS256 JWT 1y, token get/save/revoke |
| `MetricsCollector` (TS) | Per-tool perf, per-feature data usage, CSV |
| `Overlay kill-switches` | // placeholder removed |

## Data flows

1. **Tool call**: UI → `callTool` → `POST /api/tool` → `{opId}` → poll status (or WS progress) → metrics recorded.
2. **Notification**: NLService → EventBroadcaster → WS `notification` → panel + native toast; action click → `POST /api/notification/action` → PendingIntent.
3. **File sync**: watcher → debounce → `sync_upload_file` chunks (+gzip flag) → SyncService reassemble → verify → write → `file_modified` event → desktop mirrors.
4. **Config**: SettingsPanel → `POST /api/config`; device changes → `config_changed` → server-wins merge.

## Security

- Tokens: OS keychain (keyring) on desktop; Android Keystore / SecureKeyStore on device.
- Requests: Bearer JWT (HS256, `iss=forge-os`, 1y) — three-way auth check (API key / stored token / JWT).
- Logs: token/password/api-key values redacted via regex before persistence.
- Diagnostics export redacts tokens before download.

## Tech stack

Android: Kotlin, Ktor-style raw ServerSocket HTTP, java-websocket, java-jwt, Hilt.
Desktop: Tauri 2 + React 18 + TypeScript, Rust (tokio, notify, sha2, flate2, arboard,
aes-gcm, rfd), Tailwind. Zero new runtime npm deps for tasks 14–19 (logs/CSV/queue are
hand-rolled over browser APIs / IndexedDB).