"use client";

import { useCallback, useRef, useState } from "react";

export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

export interface ToolEvt {
  name: string;
  done: boolean;
  success?: boolean;
}

// Client for the streaming /api/chat proxy. Sends { message, history } and reads
// back SSE frames (event: tool | done | error). The assistant reply lands as one
// bubble on `done` (agentLoop returns final text, not token-by-token); while it
// runs we surface the live tool trace instead — same UX as the Telegram live msg.
export function useChat() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [toolTrace, setToolTrace] = useState<ToolEvt[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || streaming) return;

      setError(null);
      setToolTrace([]);
      // Snapshot history BEFORE appending the new user turn.
      const history = messages.slice(-10);
      setMessages((m) => [...m, { role: "user", content: message }]);
      setStreaming(true);

      const ac = new AbortController();
      abortRef.current = ac;
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, history }),
          signal: ac.signal,
        });
        if (!res.body) throw new Error("no response stream");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let gotReply = false;

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });

          const frames = buf.split("\n\n");
          buf = frames.pop() ?? ""; // keep the trailing partial frame

          for (const frame of frames) {
            const ev = /^event:\s*(.+)$/m.exec(frame)?.[1];
            const dataRaw = /^data:\s*(.+)$/m.exec(frame)?.[1];
            if (!ev || !dataRaw) continue; // comment lines (": ping") → skip

            let data: Record<string, unknown>;
            try {
              data = JSON.parse(dataRaw);
            } catch {
              continue; // malformed frame → ignore
            }

            if (ev === "tool") {
              const name = String(data.name ?? "");
              if (data.phase === "start") {
                setToolTrace((t) => [...t, { name, done: false }]);
              } else {
                setToolTrace((t) =>
                  t.map((x) =>
                    x.name === name && !x.done
                      ? { ...x, done: true, success: Boolean(data.success) }
                      : x
                  )
                );
              }
            } else if (ev === "done") {
              gotReply = true;
              const content = String(data.content ?? "").trim() || "(no answer)";
              setMessages((m) => [...m, { role: "assistant", content }]);
            } else if (ev === "error") {
              setError(String(data.message ?? "chat error"));
            }
          }
        }

        if (!gotReply && !ac.signal.aborted) {
          setError((e) => e ?? "stream ended without a reply");
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [messages, streaming]
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  return { messages, send, stop, streaming, toolTrace, error };
}
