# Forge OS — WebSocket Protocol

Endpoint: `ws://<device>:8790/api/events`
Every JSON message has a `type`; events also carry `timestamp` (ms) and a string `payload`.

## Client → Server

```json
{ "type": "auth", "token": "<jwt-or-token>" }
{ "type": "subscribe", "events": ["notification", "tool_start", "desktop_tool_invoke"] }
{ "type": "unsubscribe", "events": ["notification"] }
{ "type": "ping" }
{ "type": "desktop_tool_register", "name": "open_website", "description": "...", "schema": "{...}" }
{ "type": "desktop_tool_result", "invoke_id": "...", "success": true, "output": "..." }
```

ACKs: `auth_ok`, `subscribed`, `unsubscribed`, `pong`, `desktop_tool_register_ack`, `desktop_tool_result_ack`.

## Server → Client (EventType)

| type | payload |
|---|---|
| `tool_start` | `{ "opId", "toolName", "args" }` |
| `tool_progress` | `{ "opId", "toolName", "percent", "message" }` |
| `tool_complete` | `{ "opId", "toolName", "output", "durationMs", "resourceUsage" }` |
| `tool_error` | `{ "opId", "toolName", "error" }` |
| `agent_turn` | `{ "active": true }` |
| `file_modified` | `{ "path", "checksum", "size" }` |
| `notification` | `{ "id", "packageName", "title", "body", "icon" (b64 PNG), "actions": [{"id","label"}], "removed": false }` |
| `notification_removed` | `{ "id" }` |
| `clipboard` | `{ "type": "text", "content" }` |
| `config_changed` | merged config object |
| `desktop_tool_invoke` | `{ "invokeId", "toolName", "args", "timeout" }` |

## Behavior notes

- **Auth**: `Authorization: Bearer` header on upgrade, or an `auth` message on open.
- **Connection limits**: 5 clients per token, 10 total; extra connections are closed with a
  limit frame (Task 2.4).
- **Reconnect**: subs are re-sent automatically; the desktop re-registers tools and flushes
  the offline queue on every reconnect.
- **Subscriptions** filter which event types are delivered; unsubscribed types are not sent.
- Events broadcast within ~500ms of occurrence.