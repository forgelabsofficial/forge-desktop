# Forge Desktop — Tool Development Guide

Register a tool once; the device can invoke it any time after that.

## 1. Write a handler

`registerDesktopTool` keeps metadata locally + in the Rust registry and pushes a
`desktop_tool_register` message over the live WebSocket so the device knows it exists.

```ts
import { registerDesktopTool } from "./desktopTools";

registerDesktopTool({
  name: "open_website",
  description: "Open a URL in the default browser.",
  parametersSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "https URL to open" },
    },
    required: ["url"],
  },
  requiresConfirmation: true,
  handler: async (args) => {
    // args.url is validated by the schema
    const { url } = args as { url: string };
    // ... do the work ...
    return `opened ${url}`;
  },
});
```

## 2. Confirmation (Task 12.3)

With `requiresConfirmation: true`, the user gets a native `rfd` dialog before the handler
runs. Rejection returns `user rejected confirmation` as the tool error.

## 3. How invocation works (round trip)

```
device ──ws──> desktop_tool_invoke {invokeId, toolName, args}
desktop: look up tool → confirm? → handler(args)
desktop ──ws──> desktop_tool_result {invoke_id, success, output}
device: DesktopToolBridge.storeResult(...) → pollable via GET /api/desktop/tool/{invokeId}/result
```

HTTP alternative (any client): `POST /api/desktop/tool/invoke` — the device replies
`{invoke_id}` immediately and also emits `desktop_tool_invoke` over WS.

## 4. Error handling

Throw (or reject) in the handler → `success:false` with the error message. Always return a
string on success (it becomes `output`).

## 5. Timeouts

The invoke event carries a `timeout` (seconds, default 30). Long-running tools should still
report completion promptly; the device does not kill the handler, but the requester may
time out its poll.

## 6. Testing without a device

```bash
cd forge-desktop
python mock_server.py 8789 --ws     # needs: pip install websockets
```
Open the built UI at `http://localhost:5173` (or the Tauri app) and pair with code
`000001`-style codes printed by initiate (the mock accepts any 6-digit code).