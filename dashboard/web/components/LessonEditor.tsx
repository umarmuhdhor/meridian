"use client";

import { useMemo, useState } from "react";
import { PushPin, Trash, Plus, GraduationCap } from "@phosphor-icons/react";
import { useFile } from "@/lib/hooks";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { ConfirmModal } from "./ConfirmModal";
import { SkeletonRows, EmptyState, ErrorState } from "./states";
import { useDaemonStatus } from "./DaemonStatus";
import type { LessonsFile, Lesson } from "@/lib/types";

const ROLES = ["", "SCREENER", "MANAGER", "GENERAL"];
const inputCls = "h-9 rounded-[var(--radius-md)] border border-border-strong bg-surface-2 px-3 text-[13px] text-text-primary";

export function LessonEditor() {
  const q = useFile<LessonsFile>("lessons");
  const { online } = useDaemonStatus();
  const lessons = q.data?.lessons ?? [];

  // filters
  const [fRole, setFRole] = useState("all");
  const [fPinned, setFPinned] = useState("all");
  const [fTag, setFTag] = useState("");

  // add form
  const [rule, setRule] = useState("");
  const [tags, setTags] = useState("");
  const [role, setRole] = useState("");
  const [pinned, setPinned] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  // pin/unpin + clear
  const [pinTarget, setPinTarget] = useState<Lesson | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearMode, setClearMode] = useState<"all" | "keyword">("keyword");
  const [clearKeyword, setClearKeyword] = useState("");

  const filtered = useMemo(
    () =>
      lessons.filter(
        (l) =>
          (fRole === "all" || l.role === fRole) &&
          (fPinned === "all" || (fPinned === "pinned" ? l.pinned : !l.pinned)) &&
          (!fTag || (l.tags ?? []).some((t) => t.toLowerCase().includes(fTag.toLowerCase())) || l.rule.toLowerCase().includes(fTag.toLowerCase()))
      ),
    [lessons, fRole, fPinned, fTag]
  );

  const resetAdd = () => {
    setRule("");
    setTags("");
    setRole("");
    setPinned(false);
  };

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-text-primary">
          <GraduationCap size={18} /> Lessons <span className="text-[12px] font-normal text-text-tertiary">({lessons.length})</span>
        </h2>
        <div className="flex gap-2">
          <Button size="sm" variant="primary" disabled={!online} onClick={() => setAddOpen(true)}>
            <Plus size={14} /> Add lesson
          </Button>
          <Button size="sm" variant="danger-ghost" disabled={!online || lessons.length === 0} onClick={() => setClearOpen(true)}>
            <Trash size={14} /> Clear
          </Button>
        </div>
      </div>

      {/* filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select className={inputCls} value={fRole} onChange={(e) => setFRole(e.target.value)} aria-label="Filter role">
          <option value="all">All roles</option>
          {ROLES.filter(Boolean).map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <select className={inputCls} value={fPinned} onChange={(e) => setFPinned(e.target.value)} aria-label="Filter pinned">
          <option value="all">All</option>
          <option value="pinned">Pinned</option>
          <option value="unpinned">Unpinned</option>
        </select>
        <input className={inputCls} value={fTag} onChange={(e) => setFTag(e.target.value)} placeholder="Search tag / text" />
      </div>

      {q.isLoading ? (
        <SkeletonRows rows={4} />
      ) : q.isError ? (
        <ErrorState message="Failed to load lessons." onRetry={() => q.refetch()} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={GraduationCap} title="No lessons match." hint="Lessons you add are injected into the agent prompt on the next cycle (no restart)." />
      ) : (
        <ul className="divide-y divide-border rounded-[var(--radius-lg)] border border-border">
          {filtered.map((l) => (
            <li key={l.id} className="flex items-start gap-3 px-4 py-3">
              <button
                onClick={() => setPinTarget(l)}
                disabled={!online}
                aria-label={l.pinned ? "Unpin lesson" : "Pin lesson"}
                className={`mt-0.5 shrink-0 disabled:opacity-40 ${l.pinned ? "text-accent-bright" : "text-text-tertiary hover:text-text-primary"}`}
              >
                <PushPin size={16} weight={l.pinned ? "fill" : "regular"} />
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-text-primary">{l.rule}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[11px] text-text-tertiary">#{l.id}</span>
                  {l.role && <Badge tone="accent">{l.role}</Badge>}
                  {(l.tags ?? []).map((t) => (
                    <span key={t} className="text-[11px] text-text-tertiary">
                      #{t}
                    </span>
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Add lesson */}
      <ConfirmModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add lesson?"
        toolName="add_lesson"
        args={{ rule: rule.trim(), tags: tags.split(",").map((t) => t.trim()).filter(Boolean), role: role || undefined, pinned }}
        variant="primary"
        confirmLabel="Add lesson"
        invalidateKeys={["lessons"]}
        confirmDisabled={!rule.trim()}
        successMessage="Lesson added."
        onDone={resetAdd}
        impact="This lesson is injected into the agent prompt on its next cycle."
        extra={
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[12px] text-text-tertiary">Rule (required)</label>
              <textarea
                value={rule}
                onChange={(e) => setRule(e.target.value)}
                rows={3}
                className="w-full rounded-[var(--radius-md)] border border-border-strong bg-surface-2 px-3 py-2 text-[13px] text-text-primary"
                placeholder="e.g. AVOID pools with bot holders over 40%"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[12px] text-text-tertiary">Tags (comma separated)</label>
              <input value={tags} onChange={(e) => setTags(e.target.value)} className={inputCls} placeholder="risk, holders" />
            </div>
            <div className="flex items-center gap-3">
              <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
                <option value="">No role</option>
                {ROLES.filter(Boolean).map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-[13px] text-text-secondary">
                <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Pinned
              </label>
            </div>
          </div>
        }
      />

      {/* Pin / unpin */}
      <ConfirmModal
        open={!!pinTarget}
        onClose={() => setPinTarget(null)}
        title={pinTarget?.pinned ? "Unpin lesson?" : "Pin lesson?"}
        toolName={pinTarget?.pinned ? "unpin_lesson" : "pin_lesson"}
        args={{ id: pinTarget?.id }}
        variant="primary"
        confirmLabel={pinTarget?.pinned ? "Unpin" : "Pin"}
        invalidateKeys={["lessons"]}
        successMessage={pinTarget?.pinned ? "Lesson unpinned." : "Lesson pinned."}
        fields={pinTarget ? [{ label: "Lesson", value: `#${pinTarget.id}` }] : []}
        impact={pinTarget?.pinned ? "Removes the pin; it may drop off under the 3-tier cap." : "Pinned lessons always survive the 3-tier prompt cap."}
      />

      {/* Clear lessons */}
      <ConfirmModal
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        title="Clear lessons?"
        toolName="clear_lessons"
        args={clearMode === "keyword" ? { mode: "keyword", keyword: clearKeyword.trim() } : { mode: "all" }}
        variant="danger"
        confirmLabel="Clear lessons"
        invalidateKeys={["lessons"]}
        extraConfirmWord="DELETE"
        confirmDisabled={clearMode === "keyword" && !clearKeyword.trim()}
        successMessage="Lessons cleared."
        impact={clearMode === "all" ? "Removes all non-pinned lessons. This cannot be undone." : "Removes lessons matching the keyword."}
        extra={
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <label className="flex items-center gap-2 text-[13px] text-text-secondary">
                <input type="radio" checked={clearMode === "keyword"} onChange={() => setClearMode("keyword")} /> By keyword
              </label>
              <label className="flex items-center gap-2 text-[13px] text-text-secondary">
                <input type="radio" checked={clearMode === "all"} onChange={() => setClearMode("all")} /> All non-pinned
              </label>
            </div>
            {clearMode === "keyword" && (
              <input value={clearKeyword} onChange={(e) => setClearKeyword(e.target.value)} className={inputCls} placeholder="keyword to match" />
            )}
          </div>
        }
      />
    </section>
  );
}
