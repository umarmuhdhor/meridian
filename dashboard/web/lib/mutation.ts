"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ToolResult } from "./types";

// Thin error carrying the failure kind so the UI can style blocked vs error.
export class ToolError extends Error {
  kind: "inflight" | "http" | "blocked" | "error";
  result?: ToolResult;
  constructor(message: string, kind: ToolError["kind"], result?: ToolResult) {
    super(message);
    this.kind = kind;
    this.result = result;
  }
}

export interface ToolVars {
  name: string;
  args: Record<string, unknown>;
}

// All writes go through here. Sends confirm:true (the ConfirmModal is the human
// gate). On success invalidates the given query keys. On non-ok / blocked / 409
// throws a ToolError the modal renders inline (F4/F6, §9.2).
export function useToolMutation(invalidateKeys: string[] = []) {
  const qc = useQueryClient();
  return useMutation<ToolResult, ToolError, ToolVars>({
    mutationFn: async ({ name, args }) => {
      let r: Response;
      try {
        r = await fetch("/api/tool", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, args, confirm: true }),
        });
      } catch (e) {
        throw new ToolError((e as Error).message || "Network error", "http");
      }
      const outer = await r.json().catch(() => null);
      const payload = outer?.body ?? outer; // route returns bridge body directly

      if (r.status === 409) throw new ToolError("Action already in progress, please wait.", "inflight");
      if (r.status >= 400) throw new ToolError(payload?.error ?? `HTTP ${r.status}`, "http");

      const ok: boolean = payload?.ok;
      const result: ToolResult = payload?.result ?? {};
      if (!ok) {
        if (result.blocked) throw new ToolError(result.reason ?? "Blocked by safety check.", "blocked", result);
        throw new ToolError(result.error ?? "Action failed.", "error", result);
      }
      return result;
    },
    onSuccess: () => {
      for (const k of invalidateKeys) qc.invalidateQueries({ queryKey: [k] });
    },
  });
}
