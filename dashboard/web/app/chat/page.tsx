"use client";

import { useEffect, useRef, useState } from "react";
import { PaperPlaneRight, Stop } from "@phosphor-icons/react";
import { Button } from "@/components/ui/Button";
import { useChat, type ToolEvt } from "@/lib/useChat";
import { cn } from "@/lib/cn";

const SUGGESTIONS = [
  "Apa yang sudah kamu pelajari sejauh ini?",
  "Posisi aku sekarang gimana?",
  "Kenapa kamu belum deploy hari ini?",
  "Ringkas performa 24 jam terakhir",
];

function toolLabel(t: ToolEvt): string {
  const icon = t.done ? (t.success ? "✅" : "❌") : "⏳";
  return `${icon} ${t.name}`;
}

export default function ChatPage() {
  const { messages, send, stop, streaming, toolTrace, error } = useChat();
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, toolTrace, streaming]);

  const submit = () => {
    const text = input.trim();
    if (!text || streaming) return;
    send(text);
    setInput("");
  };

  return (
    <div className="flex h-[calc(100dvh-10rem)] flex-col gap-3">
      {/* Message list */}
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto pr-1">
        {messages.length === 0 && !streaming && (
          <div className="flex flex-1 flex-col items-start justify-center gap-4">
            <div>
              <h2 className="text-lg font-semibold text-text-primary">Tanya Meridian</h2>
              <p className="mt-1 text-sm text-text-secondary">
                Chat baca-saja ke agent — tanya soal yang dipelajari, posisi, PnL, atau alasan
                keputusannya. Aksi (deploy/close) tetap lewat halaman terkait.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-[var(--radius-md)] border border-border bg-surface-2 px-3 py-1.5 text-sm text-text-secondary transition-colors hover:border-accent-bright hover:text-text-primary"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            className={cn("max-w-[85%]", m.role === "user" ? "self-end" : "self-start")}
          >
            <div
              className={cn(
                "whitespace-pre-wrap rounded-[var(--radius-lg)] px-3.5 py-2.5 text-sm leading-relaxed",
                m.role === "user"
                  ? "bg-[var(--accent-tint)] text-text-primary"
                  : "border border-border bg-surface-2 text-text-primary"
              )}
            >
              {m.content}
            </div>
          </div>
        ))}

        {/* Live tool trace while the agent works */}
        {streaming && (
          <div className="self-start max-w-[85%] rounded-[var(--radius-lg)] border border-border bg-surface-1 px-3.5 py-2.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-text-secondary">
              {toolTrace.length === 0 ? (
                <span className="mrd-pulse">berpikir…</span>
              ) : (
                toolTrace.map((t, i) => <span key={`${t.name}-${i}`}>{toolLabel(t)}</span>)
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="self-start max-w-[85%] rounded-[var(--radius-lg)] border border-border bg-[var(--loss-tint)] px-3.5 py-2.5 text-sm text-loss">
            ⚠️ {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="flex items-end gap-2 border-t border-border pt-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Tanya apa saja… (Enter kirim, Shift+Enter baris baru)"
          rows={1}
          className="max-h-40 min-h-[2.5rem] flex-1 resize-none rounded-[var(--radius-md)] border border-border bg-surface-1 px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent-bright"
        />
        {streaming ? (
          <Button variant="secondary" onClick={stop} aria-label="Hentikan">
            <Stop size={16} weight="fill" aria-hidden /> Stop
          </Button>
        ) : (
          <Button variant="primary" onClick={submit} disabled={!input.trim()} aria-label="Kirim">
            <PaperPlaneRight size={16} weight="fill" aria-hidden /> Kirim
          </Button>
        )}
      </div>
    </div>
  );
}
