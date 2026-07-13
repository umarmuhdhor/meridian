"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle, Warning, Info } from "@phosphor-icons/react";
import { useFile } from "@/lib/hooks";
import { Button } from "./ui/Button";
import { ConfirmModal } from "./ConfirmModal";
import { SkeletonRows, ErrorState } from "./states";
import { useDaemonStatus } from "./DaemonStatus";
import { CONFIG_FIELDS, CONFIG_GROUPS, type ConfigField } from "@/lib/config-map";
import type { ToolResult } from "@/lib/types";

type Val = string | boolean;
type Cfg = Record<string, unknown>;

function readValue(cfg: Cfg, field: ConfigField): unknown {
  const p = field.readPath ?? [field.key];
  let v: unknown = cfg;
  for (const part of p) {
    if (v == null || typeof v !== "object") return undefined;
    v = (v as Record<string, unknown>)[part];
  }
  return v;
}

function toInput(field: ConfigField, raw: unknown): Val {
  if (field.type === "boolean") return raw === true;
  if (field.type === "array") return Array.isArray(raw) ? raw.join(", ") : raw == null ? "" : String(raw);
  return raw == null ? "" : String(raw);
}

function coerce(field: ConfigField, v: Val): unknown {
  if (field.type === "boolean") return v === true;
  if (field.type === "number") return Number(v);
  if (field.type === "array")
    return String(v)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  return String(v);
}

const inputCls = "h-9 w-full rounded-[var(--radius-md)] border border-border-strong bg-surface-2 px-3 text-[13px] text-text-primary font-mono";

export function ConfigForm() {
  const q = useFile<Cfg>("user-config");
  const { online } = useDaemonStatus();
  const initialized = useRef(false);
  const [values, setValues] = useState<Record<string, Val>>({});
  const [initial, setInitial] = useState<Record<string, Val>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastResult, setLastResult] = useState<{ applied: string[]; unknown: string[] } | null>(null);

  // Initialize once from the first config payload; don't clobber edits on refetch.
  useEffect(() => {
    if (initialized.current || !q.data) return;
    const next: Record<string, Val> = {};
    for (const field of CONFIG_FIELDS) {
      // Secrets are shown/edited like any field (redaction disabled per owner).
      next[field.key] = toInput(field, readValue(q.data as Cfg, field));
    }
    setValues(next);
    setInitial(next);
    initialized.current = true;
  }, [q.data]);

  const set = (key: string, v: Val) => setValues((prev) => ({ ...prev, [key]: v }));

  // A change is submittable unless it's a number field cleared to empty / non-finite
  // (update_config is set-only; an empty number would silently become 0).
  const submittable = (field: ConfigField, v: Val): boolean => {
    if (field.type !== "number") return true;
    const s = String(v).trim();
    return s !== "" && Number.isFinite(Number(s));
  };

  const dirtyKeys = useMemo(
    () =>
      CONFIG_FIELDS.filter((f) => values[f.key] !== initial[f.key] && submittable(f, values[f.key])).map((f) => f.key),
    [values, initial]
  );

  const changes = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const key of dirtyKeys) {
      const field = CONFIG_FIELDS.find((f) => f.key === key)!;
      out[key] = coerce(field, values[key]);
    }
    return out;
  }, [dirtyKeys, values]);

  if (q.isLoading && !initialized.current) return <SkeletonRows rows={10} />;
  if (q.isError && !initialized.current) return <ErrorState message="Failed to load config." onRetry={() => q.refetch()} />;

  return (
    <div className="flex flex-col gap-6">
      {lastResult && (
        <div className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-border bg-surface-1 p-4">
          <div className="flex items-center gap-2 text-[13px] text-profit">
            <CheckCircle size={16} weight="fill" /> Applied {lastResult.applied.length} key(s)
          </div>
          {lastResult.applied.length > 0 && (
            <div className="font-mono text-[12px] text-text-secondary">{lastResult.applied.join(", ")}</div>
          )}
          {lastResult.unknown.length > 0 && (
            <div className="flex items-start gap-2 text-[12px] text-warning">
              <Warning size={14} className="mt-0.5" /> Unknown (skipped): {lastResult.unknown.join(", ")}
            </div>
          )}
        </div>
      )}

      {CONFIG_GROUPS.map((group) => {
        const fields = CONFIG_FIELDS.filter((f) => f.group === group);
        if (fields.length === 0) return null;
        return (
          <section key={group}>
            <h3 className="mb-2 text-[12px] font-medium uppercase tracking-wide text-text-tertiary">{group}</h3>
            <div className="grid grid-cols-1 gap-3 rounded-[var(--radius-lg)] border border-border bg-surface-1 p-4 md:grid-cols-2 lg:grid-cols-3">
              {fields.map((field) => {
                const dirty = values[field.key] !== initial[field.key] && submittable(field, values[field.key]);
                return (
                  <div key={field.key} className="flex flex-col gap-1">
                    <label className="flex items-center gap-1 text-[12px] text-text-tertiary" htmlFor={field.key}>
                      <span className="truncate">{field.key}</span>
                      {field.unit && <span className="text-text-disabled">· {field.unit}</span>}
                      {field.help && (
                        <span className="group relative inline-flex shrink-0 cursor-help text-text-disabled hover:text-text-secondary">
                          <Info size={13} weight="bold" />
                          <span
                            role="tooltip"
                            className="pointer-events-none absolute left-1/2 top-[130%] z-30 hidden w-60 -translate-x-1/2 rounded-[var(--radius-md)] border border-border bg-surface-3 px-2.5 py-1.5 text-[11px] font-normal leading-snug text-text-secondary shadow-lg group-hover:block"
                            style={{ boxShadow: "var(--shadow-lg)" }}
                          >
                            {field.help}
                          </span>
                        </span>
                      )}
                      {field.secret && <span className="text-text-disabled">(sensitive)</span>}
                      {dirty && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "var(--accent-bright)" }} />}
                    </label>
                    {field.type === "boolean" ? (
                      <label className="flex h-9 items-center gap-2 text-[13px] text-text-secondary">
                        <input
                          type="checkbox"
                          checked={values[field.key] === true}
                          onChange={(e) => set(field.key, e.target.checked)}
                        />
                        {values[field.key] === true ? "true" : "false"}
                      </label>
                    ) : field.options ? (
                      <select
                        id={field.key}
                        value={String(values[field.key] ?? "")}
                        onChange={(e) => set(field.key, e.target.value)}
                        className={inputCls}
                      >
                        {/* Preserve an out-of-enum current value so a stale config isn't silently rewritten. */}
                        {values[field.key] != null &&
                          String(values[field.key]) !== "" &&
                          !field.options.includes(String(values[field.key])) && (
                            <option value={String(values[field.key])}>{String(values[field.key])} (current)</option>
                          )}
                        {field.options.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={field.key}
                        value={String(values[field.key] ?? "")}
                        inputMode={field.type === "number" ? "decimal" : undefined}
                        placeholder={field.unit ?? undefined}
                        onChange={(e) => set(field.key, e.target.value)}
                        className={inputCls}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      <div className="sticky bottom-4 flex items-center justify-between rounded-[var(--radius-lg)] border border-border bg-surface-3 px-4 py-3 shadow-lg" style={{ boxShadow: "var(--shadow-lg)" }}>
        <span className="text-[13px] text-text-secondary">
          {dirtyKeys.length === 0 ? "No changes" : `${dirtyKeys.length} changed`}
        </span>
        <Button variant="primary" disabled={!online || dirtyKeys.length === 0} onClick={() => setConfirmOpen(true)}>
          Save changes
        </Button>
      </div>

      <ConfirmModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Apply config changes?"
        toolName="update_config"
        args={{ changes, reason: "dashboard" }}
        variant="primary"
        confirmLabel="Apply"
        invalidateKeys={["user-config"]}
        confirmDisabled={dirtyKeys.length === 0}
        successMessage={`Applied ${dirtyKeys.length} config change(s).`}
        impact="Changes apply to the live config immediately. Interval keys restart the cron jobs."
        fields={[{ label: "Changed keys", value: dirtyKeys.join(", ") || "-" }]}
        onDone={(r: ToolResult) => {
          const applied = r.applied && typeof r.applied === "object" ? Object.keys(r.applied) : [];
          const unknown = Array.isArray(r.unknown) ? r.unknown : [];
          setLastResult({ applied, unknown });
          // Reset dirty baseline to the just-submitted values.
          setInitial((prev) => ({ ...prev, ...values }));
        }}
      />
    </div>
  );
}
