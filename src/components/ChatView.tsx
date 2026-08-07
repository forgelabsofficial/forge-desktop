import { useEffect, useRef, useState } from "react";
import type { ChatMessage, ConnectionConfig } from "../types";
import { sendChat } from "../api";

interface Props {
  cfg: ConnectionConfig;
}

export default function ChatView({ cfg }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text, at: Date.now() }]);
    setBusy(true);
    try {
      const { reply, sessionId: sid } = await sendChat(cfg, text, sessionId);
      setSessionId(sid);
      setMessages((m) => [...m, { role: "assistant", text: reply, at: Date.now() }]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: `❌ ${e instanceof Error ? e.message : String(e)}`,
          at: Date.now(),
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center text-sm text-forge-muted">
            Start a conversation with your Forge agent
          </div>
        )}
        <div className="mx-auto max-w-2xl space-y-4">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-4 py-2.5 text-sm leading-relaxed ${
                  m.role === "user"
                    ? "bg-forge-accent text-black"
                    : "border border-forge-border bg-forge-panel"
                }`}
              >
                {m.text}
              </div>
            </div>
          ))}
          {busy && (
            <div className="flex justify-start">
              <div className="rounded-xl border border-forge-border bg-forge-panel px-4 py-2.5 text-sm text-forge-muted">
                Agent is working…
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-forge-border p-4">
        <div className="mx-auto flex max-w-2xl gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Message Forge…  (Enter to send)"
            rows={1}
            className="flex-1 resize-none rounded-lg border border-forge-border bg-forge-panel px-3 py-2.5 text-sm outline-none focus:border-forge-accent"
          />
          <button
            onClick={send}
            disabled={busy || !input.trim()}
            className="rounded-lg bg-forge-accent px-4 py-2 text-sm font-semibold text-black transition hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
