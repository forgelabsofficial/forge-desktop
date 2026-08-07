"""Mock ForgeHttpServer for forge-desktop UI development.

Mimics the real device's minimal HTTP/1.1 server (Connection: close,
Bearer auth, JSON bodies) so the React frontend can be browser-tested
without a phone. Not used in production.

Usage:
    python mock_server.py [port]     # default 8789, token = "test-token"
"""

import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

TOKEN = "test-token"

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
        if self.path == "/api/status":
            return self._send(200, {"status": "ok", "port": self.server.server_port,
                                    "running": True, "server": "Forge OS HTTP (mock)"})
        if self.path == "/api/tools":
            return self._send(200, {"tools": TOOLS})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        if not self._auth_ok():
            return self._send(401, {"error": "unauthorized"})
        try:
            data = self._body()
        except Exception:
            return self._send(400, {"error": "bad json"})
        if self.path == "/api/tool":
            name = data.get("name")
            if not name:
                return self._send(400, {"error": "missing 'name'"})
            return self._send(200, {"ok": True,
                                    "output": f"[mock] {name} executed with args: "
                                              + json.dumps(data.get("args", {}))})
        if self.path == "/api/chat":
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
        self._send(404, {"error": "not found"})


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8789
    print(f"Mock Forge server on http://127.0.0.1:{port}  (token: {TOKEN})")
    HTTPServer(("127.0.0.1", port), Handler).serve_forever()
