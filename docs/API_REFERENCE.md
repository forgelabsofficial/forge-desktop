# Forge OS — API Reference

Base URL: `http://<device>:8789` · Auth: `Authorization: Bearer <token>` (pairing endpoints public)

## Pairing

### `POST /api/pairing/initiate`
```json
{ "desktop_name": "My Laptop" }
```
→ `200 { "code": "123456", "expires_in": 300 }`

### `POST /api/pairing/confirm`
```json
{ "code": "123456", "desktop_id": "desktop-uuid" }
```
→ `200 { "token": "<jwt>", "desktop_id": "...", "device": { "model": "...", "android_version": "...", "forge_os_version": "...", "capabilities": [...] } }`
Errors: `400 { "error": "invalid or expired code" }`

## Tools

### `POST /api/tool` (async)
```json
{ "name": "android_battery", "args": {} }
```
→ `200 { "opId": "<uuid>", "ok": true, "output": "operation started" }`
(Backward-compatible: older firmware answers `{ ok, output }` synchronously.)

### `GET /api/tool/{opId}/status`
→ `200 { "op_id": "...", "tool_name": "...", "status": "running|completed|failed|cancelled", "output": "...", "error": { "code", "message", "stack_trace" } }`

### `POST /api/tool/{opId}/cancel`
→ `200 { "cancelled": true }` (cancels the actual coroutine Job)

## File sync

### `POST /api/sync/upload` (multipart/form-data)
Fields: `path`, `chunk` (0-based index), `totalChunks`, `checksum` (whole-file SHA-256, same on every chunk), `compressed` (true/false), `data` (binary).
→ `200 { "uploaded": true, "receivedChunks": [0,1,...], "complete": true }`

### `GET /api/sync/download?path=<rel>`
Supports `Range: bytes=<start>-` → `206` partial (append mode) or `200` full; `404` when missing.

### `GET /api/sync/stat?path=<rel>`
→ `200 { "exists": true, "size": 123, "last_modified": 1714000000000, "checksum": "<sha256>" } | { "exists": false }`

## Clipboard

### `POST /api/clipboard`
```json
{ "type": "text", "content": "..." }
{ "type": "image", "image_data": "<base64 png>" }
```
→ `200 { "updated": true }` (images become real pastable clipboard images via FileProvider)

## Notifications

### `POST /api/notification/action`
```json
{ "notification_id": "...", "action_id": "0" }
```
→ `200 { "triggered": true }` — fires the notification's stored PendingIntent.

## Desktop tool bridge

- `GET /api/desktop/tools` → `{ "tools": [{ "name", "description", "schema" }] }`
- `POST /api/desktop/tool/invoke` → `{ "invoke_id": "..." }` (also emitted as a WS `desktop_tool_invoke`)
- `GET /api/desktop/tool/{invokeId}/result` → `{ "found": true, "success": true, "output": "...", "error": "" }`

## Config & status

- `GET /api/status` → health payload (used by HealthMonitor, 10s poll)
- `GET /api/config` / `POST /api/config` → config object validated against the device data class
- `GET /api/tools` → `{ "tools": [ToolDefinition] }` (JSON-schema style, cached 5 min)

## WebSocket

`ws://<device>:8790/api/events` — see [WEBSOCKET_PROTOCOL.md](WEBSOCKET_PROTOCOL.md).

## Error format
All errors: `{ "error": "<message>" }` with the appropriate HTTP status (400/401/404/500).