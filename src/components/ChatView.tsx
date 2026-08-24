import { useEffect, useRef, useState } from "react";
import type { ChatMessage, ConnectionConfig } from "../types";
import { sendChat } from "../api";
import { logger } from "../logger";
import type { ToolActivity } from "../hooks/useEventStream";

interface Props {
  cfg: ConnectionConfig;
  /** Task 19.2 - agent typing + tool progress from the event stream. */
  agentActive: boolean;
  activeTools: ToolActivity[];
}

interface SessionMeta {
  sessionId: string;
  label: string;
  updatedAt: number;
}

const MAX_HISTORY = 40;
const WARN_AGE_MS = 20 * 60 * 60 * 1000; // 20h
const EXPIRE_AGE_MS = 24 * 60 * 60 * 1000; // 24h

function sessionsKey(cfg: ConnectionConfig): string {
  return `forge-sessions-${cfg.host}:${cfg.port}`;
}
function historyKey(cfg: ConnectionConfig, sessionId: string): string {
  return `forge-chat-${cfg.host}:${cfg.port}-${sessionId}`;
}

function loadSessions(cfg: ConnectionConfig): SessionMeta[] {
  try {
    const raw = localStorage.getItem(sessionsKey(cfg));
    const list: SessionMeta[] = raw ? JSON.parse(raw) : [];
    const now = Date.now();
    // Task 19.3 - drop sessions inactive for >24h.
    const fresh = list.filter((s) => now - s.updatedAt <= EXPIRE_AGE_MS);
    if (fresh.length !== list.length) localStorage.setItem(sessionsKey(cfg), JSON.stringify(fresh));
    return fresh;
  } catch {
    return [];
  }
}

function loadHistory(cfg: ConnectionConfig, sessionId: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(historyKey(cfg, sessionId));
    return raw ? (JSON.parse(raw) as ChatMessage[]) : [];
  } catch {
    return [];
  }
}

function persist(cfg: ConnectionConfig, sessionId: string, messages: ChatMessage[]) {
  try {
    localStorage.setItem(historyKey(cfg, sessionId), JSON.stringify(messages.slice(-MAX_HISTORY)));
    const sessions = loadSessions(cfg).filter((s) => s.sessionId !== sessionId);
    sessions.unshift({ sessionId, label: messages[0]?.text.slice(0, 40) || "Session", updatedAt: Date.now() });
    localStorage.setItem(sessionsKey(cfg), JSON.stringify(sessions.slice(0, 20)));
  } catch {
    /* storage full/unavailable */
  }
}

export default function ChatView({ cfg, agentActive, activeTools }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [sessions, setSessions] = useState<SessionMeta[]>(() => loadSessions(cfg));
  const [busy, setBusy] = useState(false);
  const [sessionWarn, setSessionWarn] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy, activeTools]);

  function startNewSession() {
    setSessionId(undefined);
    setMessages([]);
    setSessionWarn(false);
  }

  function resumeSession(id: string) {
    const sid = id || sessionId;
    if (!sid) return;
    setSessionId(sid);
    setMessages(loadHistory(cfg, sid));
    const meta = sessions.find((s) => s.sessionId === sid);
    // Task 19.3 - warn when last activity is >20h old.
    setSessionWarn(!!meta && Date.now() - meta.updatedAt > WARN_AGE_MS);
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    const userMsg: ChatMessage = { role: "user", text, at: Date.now() };
    setMessages((m) => [...m, userMsg]);
    setBusy(true);
    setSessionWarn(false);
    try {
      const { reply, sessionId: sid } = await sendChat(cfg, text, sessionId);
      setSessionId(sid);
      setMessages((m) => {
        const next = [...m, { role: "assistant" as const, text: reply, at: Date.now() }];
        if (sid) persist(cfg, sid, next);
        setSessions(loadSessions(cfg));
        return next;
      });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      logger.error("sendChat failed", e);
      setMessages((m) => [
        ...m,
        { role: "assistant", text: `❌ ${errMsg}`, at: Date.now() },
      ]);
    } finally {
      setBusy(false);
    }
  }

  const hasExpiring = sessions.some((s) => Date.now() - s.updatedAt > WARN_AGE_MS);

  return (
    <div className="flex h-full flex-col">
      {/* Task 19.1 - session bar */}
      <div className="flex items-center gap-2 border-b border-forge-border bg-forge-panel px-4 py-2">
        <button
          onClick={startNewSession}
          className="rounded-md bg-forge-accent px-2.5 py-1 text-xs font-semibold text-black hover:bg-orange-400"
        >
          + New session
        </button>
        <div className="flex flex-1 items-center gap-1 overflow-x-auto">
          {sessions.map((s) => (
            <button
              key={s.sessionId}
              onClick={() => resumeSession(s.sessionId)}
              title={`Resume ${s.label}`}
              className={`max-w-[180px] truncate rounded-md border px-2 py-1 text-xs ${
                sessionId === s.sessionId
                  ? "border-forge-accent bg-forge-bg text-forge-text"
                  : "border-forge-border text-forge-muted hover:text-forge-text"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <span className="flex-shrink-0 text-[10px] text-forge-muted">
          {sessions.length} saved
        </span>
      </div>

      {hasExpiring && (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-300">
          Some sessions haven't been active for 20h+ — they'll be removed after 24h.
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center text-sm text-forge-muted">
            {sessionWarn
              ? "This session is stale (20h+). Start a new one."
              : "Start a conversation with your Forge agent"}
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

          {/* Task 19.2 - typing indicator + tool progress */}
          {(busy || agentActive || activeTools.length > 0) && (
            <div className="flex justify-start">
              <div className="w-full max-w-[85%] rounded-xl border border-forge-border bg-forge-panel px-4 py-2.5 text-sm">
                {activeTools.length > 0 ? (
                  <div className="space-y-1.5">
                    {activeTools.slice(0, 3).map((t) => (
                      <div key={t.opId} className="flex items-center gap-2">
                        <span className="relative flex h-2 w-2 flex-shrink-0">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-forge-accent opacity-60" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-forge-accent" />
                        </span>
                        <span className="text-xs text-forge-muted">
                          {t.toolName}
                          {typeof t.percent === "number" && (
                            <span className="ml-1 tabular-nums">({t.percent}%)</span>
                          )}
                          {t.message && <span className="ml-1">— {t.message}</span>}
                        </span>
                      </div>
                    ))}
                    {agentActive && (
                      <div className="text-xs text-forge-muted">Agent is thinking…</div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-forge-muted">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-forge-accent" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-forge-accent [animation-delay:120ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-forge-accent [animation-delay:240ms]" />
                    <span className="ml-1 text-xs">Agent is working…</span>
                  </div>
                )}
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