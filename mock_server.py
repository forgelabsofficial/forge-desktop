"""Mock ForgeHttpServer for forge-desktop UI development.

Mimics the real device's minimal HTTP/1.1 server (Connection: close,
Bearer auth, JSON bodies) so the React frontend can be browser-tested
without a phone. Not used in production.

Supports:
- /api/status, /api/tools, /api/tool, /api/tool/{opId}/status, /api/tool/{opId}/cancel
- /api/chat
- /api/pairing/initiate, /api/pairing/confirm   (Task 22.2)
- /api/clipboard, /api/config, /api/sync/stat   (stubs)
- WebSocket /api/events when --ws is passed (Task 22.1, needs `websockets`)

Usage:
    python mock_server.py [port] [--ws]          # default 8789, token = "test-token"
"""

import json
import sys
import threading
import time
import uuid

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = "test-token"

# In-memory pairing codes: code -> (expires_at, desktop_name)
PAIRING_CODES = {}
PAIRING_TTL_S = 5 * 60

# In-memory tool operations: op_id -> dict
TOOL_OPS = {}

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "file_read",
            "description": "Read a UTF-8 text file from the workspace sandbox.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Workspace-relative file path"}
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "android_battery",
            "description": "Get battery level, charging state and health.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "alarm_set",
            "description": "Schedule an alarm or reminder.",
            "parameters": {
                "type": "object",
                "properties": {
                    "label": {"type": "string", "description": "Alarm label"},
                    "in_seconds": {"type": "number", "description": "Seconds from now"},
                    "action": {
                        "type": "string",
                        "description": "What to do when it fires",
                        "enum": ["NOTIFY", "RUN_PROMPT", "RUN_TOOL"],
                    },
                },
                "required": ["label"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ddg_search",
            "description": "Search the web via DuckDuckGo instant answers.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query"},
                    "limit": {"type": "integer", "description": "Max results"},
                },
                "required": ["query"],
            },
        },
    },
]


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # quieter logs
        sys.stderr.write("[mock] " + fmt % args + "\n")

    def _send(self, status, obj):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def _auth_ok(self):
        # Pairing endpoints are public; everything else needs the token.
        if self.path.startswith("/api/pairing/"):
            return True
        return self.headers.get("Authorization", "") == f"Bearer {TOKEN}"

    def _body(self):
        n = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(n) or b"{}")

    def do_OPTIONS(self):
        # Browsers preflight cross-origin requests that carry Authorization.
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Content-Length", "0")
        self.send_header("Connection", "close")
        self.end_headers()

    def do_GET(self):
        if not self._auth_ok():
            return self._send(401, {"error": "unauthorized"})
        path = self.path.split("?")[0]
        if path == "/api/status":
            return self._send(200, {"status": "ok", "port": self.server.server_port,
                                    "running": True, "server": "Forge OS HTTP (mock)"})
        if path == "/api/tools":
            return self._send(200, {"tools": TOOLS})
        if path == "/api/events":
            # HTTP(S) request to the WS endpoint: handshake is provided by the
            # websockets thread when --ws is active; here we explain politely.
            return self._send(501, {"error": "use ws:// (run with --ws and the "
                                             "'websockets' package installed)"})
        if path.startswith("/api/tool/") and path.endswith("/status"):
            op_id = path[len("/api/tool/"):-len("/status")]
            op = TOOL_OPS.get(op_id)
            if not op:
                return self._send(404, {"error": f"unknown op {op_id}"})
            return self._send(200, {
                "op_id": op_id,
                "tool_name": op["tool_name"],
                "status": op["status"],
                "output": op.get("output"),
                "error": op.get("error"),
            })
        if path == "/api/sync/stat":
            return self._send(200, {"exists": False})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        if not self._auth_ok():
            return self._send(401, {"error": "unauthorized"})
        path = self.path.split("?")[0]

        # ── Task 22.2 - pairing ──────────────────────────────────────────────
        if path == "/api/pairing/initiate":
            try:
                data = self._body()
            except Exception:
                data = {}
            code = str(100000 + int(time.time() * 1000) % 900000)
            PAIRING_CODES[code] = (time.time() + PAIRING_TTL_S, data.get("desktop_name", "Mock Desktop"))
            return self._send(200, {"code": code, "expires_in": PAIRING_TTL_S})

        if path == "/api/pairing/confirm":
            try:
                data = self._body()
            except Exception:
                data = {}
            code = str(data.get("code", ""))
            entry = PAIRING_CODES.pop(code, None)
            if not entry:
                return self._send(400, {"error": "invalid or expired code"})
            now = time.time()
            if entry[0] < now:
                return self._send(400, {"error": "code expired"})
            desktop_id = data.get("desktop_id") or f"mock-desktop-{uuid.uuid4().hex[:8]}"
            # Mock JWT (not signed; matching shape only)
            token = "mock-jwt." + uuid.uuid4().hex + ".sig"
            return self._send(200, {
                "token": token,
                "desktop_id": desktop_id,
                "device": {
                    "model": "Pixel Mock",
                    "android_version": "14",
                    "forge_os_version": "0.1.0-mock",
                    "capabilities": ["tools", "sync", "clipboard", "notifications"],
                },
            })

        # ── Task 22.3 - async tool execution ────────────────────────────────
        if path == "/api/tool":
            try:
                data = self._body()
            except Exception:
                return self._send(400, {"error": "bad json"})
            name = data.get("name")
            if not name:
                return self._send(400, {"error": "missing 'name'"})
            op_id = uuid.uuid4().hex
            TOOL_OPS[op_id] = {"tool_name": name, "status": "completed",
                               "output": f"[mock] {name} executed with args: "
                                         + json.dumps(data.get("args", {}))}
            return self._send(200, {"opId": op_id, "ok": True, "output": "operation started"})

        if path.startswith("/api/tool/") and path.endswith("/cancel"):
            op_id = path[len("/api/tool/"):-len("/cancel")]
            op = TOOL_OPS.get(op_id)
            if not op:
                return self._send(404, {"error": f"unknown op {op_id}"})
            op["status"] = "cancelled"
            op["error"] = {"code": "CANCELLED", "message": "cancelled by user"}
            return self._send(200, {"cancelled": True, "op_id": op_id})

        # ── Stubs the frontend calls during normal operation ────────────────
        if path == "/api/chat":
            try:
                data = self._body()
            except Exception:
                return self._send(400, {"error": "bad json"})
            msg = data.get("message")
            if not msg:
                return self._send(400, {"error": "missing 'message'"})
            sid = data.get("session_id") or "mock-session-1"
            return self._send(200, {"ok": True,
                                    "reply": f"[mock reply] You said: {msg}\n\n"
                                             "⚙ file_list\nThis is a simulated agent response "
                                             "from the mock server — the real reply comes from "
                                             "ReActAgent on your device.",
                                    "session_id": sid})
        if path == "/api/clipboard":
            return self._send(200, {"updated": True})
        if path == "/api/config":
            return self._send(200, {"ok": True, "saved": True})
        self._send(404, {"error": "not found"})


def start_ws_server(port):
    """Task 22.1 - optional WebSocket /api/events via the `websockets` lib."""
    try:
        import websockets
        import asyncio
    except ImportError:
        print("[mock] 'websockets' package not installed; WS events disabled. "
              "Install with: pip install websockets")
        return

    async def handler(ws):
        try:
            await ws.send(json.dumps({"type": "welcome", "timestamp": int(time.time() * 1000)}))
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except Exception:
                    continue
                mtype = msg.get("type")
                if mtype == "auth":
                    await ws.send(json.dumps({"type": "auth_ok"}))
                elif mtype == "subscribe":
                    await ws.send(json.dumps({"type": "subscribed", "events": msg.get("events", [])}))
                elif mtype == "ping":
                    await ws.send(json.dumps({"type": "pong"}))
        except Exception:
            pass

    async def serve():
        async with websockets.serve(handler, "127.0.0.1", port):
            await asyncio.Future()

    print(f"[mock] WS /api/events on ws://127.0.0.1:{port}/api/events")
    threading.Thread(target=lambda: asyncio.run(serve()), daemon=True).start()


if __name__ == "__main__":
    args = sys.argv[1:]
    port = 8789
    ws_enabled = False
    for a in args:
        if a == "--ws":
            ws_enabled = True
        elif a.isdigit():
            port = int(a)
    print(f"Mock Forge server on http://127.0.0.1:{port}  (token: {TOKEN})")
    if ws_enabled:
        start_ws_server(port)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()