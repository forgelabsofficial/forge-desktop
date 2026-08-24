/**
 * Desktop Tool Runtime (Task 12.2) - TS-side execution of tools invoked by
 * the device over the WebSocket event stream.
 *
 * The Rust registry (`registry.rs`) holds the metadata; handlers live here
 * as JS functions. `handleDesktopToolInvoke` runs a tool with optional
 * native confirmation and reports the result back to the device through the
 * existing `sendDesktopToolResult` WebSocket message.
 */

export interface DesktopToolDef {
  name: string;
  description: string;
  parametersSchema?: Record<string, unknown>;
  requiresConfirmation?: boolean;
  handler: (args: Record<string, unknown>) => Promise<string>;
}

export type ToolResultSender = (
  invokeId: string,
  success: boolean,
  output: string
) => void;

const tools = new Map<string, DesktopToolDef>();

type RawSender = (msg: unknown) => void;

/** Sender attached by useEventStream while the WebSocket is live. */
let activeSender: RawSender | null = null;

export function setDesktopToolSender(sender: RawSender | null): void {
  activeSender = sender;
}

/** Push every registered tool to the device (Task 12.1). */
export function sendDesktopToolRegistrations(): void {
  if (!activeSender) return;
  for (const t of tools.values()) {
    activeSender({
      type: "desktop_tool_register",
      name: t.name,
      description: t.description,
      schema: JSON.stringify(t.parametersSchema ?? {}),
    });
  }
}

const isTauri = "__TAURI_INTERNALS__" in window;

async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** Register a tool locally and mirror it into the Rust backend registry. */
export async function registerDesktopTool(def: DesktopToolDef): Promise<void> {
  tools.set(def.name, def);
  if (isTauri) {
    try {
      await invoke<void>("register_desktop_tool", {
        name: def.name,
        description: def.description,
        parametersSchema: def.parametersSchema
          ? JSON.stringify(def.parametersSchema)
          : null,
        requiresConfirmation: def.requiresConfirmation ?? false,
      });
    } catch (e) {
      console.error("[DesktopTools] backend registration failed:", e);
    }
  }
  // Mirror to the device over the live WebSocket so it can invoke this tool.
  sendDesktopToolRegistrations();
}

export function getDesktopTool(name: string): DesktopToolDef | undefined {
  return tools.get(name);
}

export function listDesktopTools(): DesktopToolDef[] {
  return Array.from(tools.values());
}

/** Ask the user for confirmation via a native dialog (Task 12.3). */
export async function confirmToolRun(
  toolName: string,
  message: string
): Promise<boolean> {
  if (!isTauri) {
    return window.confirm(message);
  }
  return invoke<boolean>("confirm_dialog", {
    title: `Run desktop tool "${toolName}"?`,
    message,
  });
}

/**
 * Handle a `desktop_tool_invoke` event from the device: look up the tool,
 * confirm when required, execute, then report via the sender callback.
 */
export async function handleDesktopToolInvoke(
  invokeId: string,
  toolName: string,
  args: Record<string, unknown>,
  sendResult: ToolResultSender,
  timeoutSecs = 30
): Promise<void> {
  const tool = tools.get(toolName);
  if (!tool) {
    sendResult(invokeId, false, `tool not registered: ${toolName}`);
    return;
  }
  try {
    if (tool.requiresConfirmation) {
      const summary = Object.keys(args ?? {}).length
        ? Object.entries(args)
            .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
            .join(", ")
        : "no arguments";
      const ok = await confirmToolRun(toolName, `Invoke "${toolName}" with ${summary}?`);
      if (!ok) {
        sendResult(invokeId, false, "user rejected confirmation");
        return;
      }
    }
    // Task 12.2 - enforce the execution timeout from the invoke event.
    const output = await Promise.race([
      tool.handler(args ?? {}),
      new Promise<string>((_, reject) =>
        setTimeout(
          () => reject(new Error(`tool ${toolName} timed out after ${timeoutSecs}s`)),
          timeoutSecs * 1000
        )
      ),
    ]);
    sendResult(invokeId, true, output ?? "");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[DesktopTools] ${toolName} failed:`, error);
    sendResult(invokeId, false, message);
  }
}