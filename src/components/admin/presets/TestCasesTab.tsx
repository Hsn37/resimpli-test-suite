"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Loader2, Plus, RotateCcw, Search, Trash2 } from "lucide-react";
import { useToast } from "@/components/Toast";
import { INPUT_CLASS } from "@/components/admin/formStyles";
import {
  AGENT_SCOPES,
  emptyTestPresetInput,
  presetId,
  type PresetDefaults,
  type TestPresetInput,
  type TestPresetRecord,
} from "@/lib/testPreset";
import PresetEditor from "./PresetEditor";

const PRIORITY_STYLES: Record<string, string> = {
  P0: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400",
  P1: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
  P2: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  Obs: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400",
};

const ALL_SCOPES = "All";

/** Record -> editable input (drops the server-owned fields). */
function toInput(record: TestPresetRecord): TestPresetInput {
  const { id, active, updated_by, updated_at, ...input } = record;
  void id;
  void active;
  void updated_by;
  void updated_at;
  return input;
}

export default function TestCasesTab() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [records, setRecords] = useState<TestPresetRecord[]>([]);
  const [defaults, setDefaults] = useState<PresetDefaults>({});
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<string>(ALL_SCOPES);
  const [showRetired, setShowRetired] = useState(false);
  // Non-null while editing. `editingId` is null for a case being created.
  const [draft, setDraft] = useState<TestPresetInput | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/presets");
      if (!res.ok) throw new Error("Failed to load test cases");
      const data = await res.json();
      setRecords(data.records ?? []);
      setDefaults(data.defaults ?? {});
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Load failed", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  const groups = useMemo(
    () => [...new Set(records.map((r) => r.group_name))].sort(),
    [records]
  );

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return records
      .filter((r) => (showRetired ? true : r.active))
      .filter((r) => (scope === ALL_SCOPES ? true : r.agent_scope === scope))
      .filter((r) =>
        term
          ? r.scenario.toLowerCase().includes(term) ||
            r.id.toLowerCase().includes(term) ||
            r.group_name.toLowerCase().includes(term)
          : true
      );
  }, [records, search, scope, showRetired]);

  // Grouped for display, in first-appearance order (which is test-number order,
  // since groups are contiguous blocks of numbers).
  const grouped = useMemo(() => {
    const map = new Map<string, TestPresetRecord[]>();
    for (const record of visible) {
      const list = map.get(record.group_name) ?? [];
      list.push(record);
      map.set(record.group_name, list);
    }
    return [...map.entries()];
  }, [visible]);

  const nextTestNo = useMemo(
    () => records.reduce((max, r) => Math.max(max, r.test_no), 0) + 1,
    [records]
  );

  function startNew() {
    setEditingId(null);
    setDraft(emptyTestPresetInput(nextTestNo));
  }

  function startEdit(record: TestPresetRecord) {
    setEditingId(record.id);
    setDraft(toInput(record));
  }

  /** Clone a case as a new one — most cases are variants of an existing case. */
  function startDuplicate(record: TestPresetRecord) {
    setEditingId(null);
    setDraft({
      ...toInput(record),
      test_no: nextTestNo,
      scenario: `${record.scenario} (copy)`,
    });
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await fetch(
        editingId ? `/api/admin/presets/${editingId}` : "/api/admin/presets",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Save failed");
      toast(`${presetId(draft.test_no)} saved`, "success");
      setDraft(null);
      setEditingId(null);
      await load();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  async function setActive(record: TestPresetRecord, active: boolean) {
    try {
      const res = await fetch(`/api/admin/presets/${record.id}`, {
        method: active ? "PATCH" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: active ? JSON.stringify({ ...toInput(record), active: true }) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Update failed");
      toast(`${record.id} ${active ? "restored" : "retired"}`, "success");
      await load();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Update failed", "error");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-zinc-400" size={32} />
      </div>
    );
  }

  if (draft) {
    return (
      <PresetEditor
        draft={draft}
        defaults={defaults}
        groups={groups}
        isNew={editingId === null}
        saving={saving}
        onChange={(patch) => setDraft((d) => (d ? { ...d, ...patch } : d))}
        onSave={save}
        onCancel={() => {
          setDraft(null);
          setEditingId(null);
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by number, scenario or group…"
            className={`${INPUT_CLASS} w-full pl-8`}
          />
        </div>
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          className={`${INPUT_CLASS} w-auto`}
        >
          {[ALL_SCOPES, ...AGENT_SCOPES].map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setShowRetired((v) => !v)}
          className={`text-xs font-medium px-3 py-2 rounded-lg transition-colors ${
            showRetired
              ? "bg-blue-600 text-white"
              : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
          }`}
        >
          Retired
        </button>
        <button
          type="button"
          onClick={startNew}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={16} />
          New case
        </button>
      </div>

      <p className="text-xs text-zinc-500">
        {visible.length} of {records.length} cases · next number {presetId(nextTestNo)}
      </p>

      {/* Grouped list */}
      <div className="space-y-5">
        {grouped.map(([group, rows]) => (
          <div key={group}>
            <h3 className="text-[11px] font-bold uppercase tracking-wide text-zinc-500 mb-1.5">
              {group}
            </h3>
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-900">
              {rows.map((record) => (
                <div
                  key={record.id}
                  className={`flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/50 ${
                    record.active ? "" : "opacity-50"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => startEdit(record)}
                    className="flex items-center gap-3 flex-1 min-w-0 text-left"
                  >
                    <code className="text-xs font-mono text-zinc-400 shrink-0 w-12">
                      {record.id}
                    </code>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                        PRIORITY_STYLES[record.priority] ?? PRIORITY_STYLES.P2
                      }`}
                    >
                      {record.priority}
                      {record.high_risk ? " ★" : ""}
                    </span>
                    <span className="text-[10px] font-medium text-zinc-500 shrink-0 w-16 truncate">
                      {record.agent_scope}
                    </span>
                    <span className="text-sm truncate">{record.scenario}</span>
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => startDuplicate(record)}
                      title="Duplicate as a new case"
                      className="p-1.5 text-zinc-300 hover:text-blue-500 transition-colors"
                    >
                      <Copy size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setActive(record, !record.active)}
                      title={record.active ? "Retire this case" : "Restore this case"}
                      className={`p-1.5 transition-colors ${
                        record.active
                          ? "text-zinc-300 hover:text-red-500"
                          : "text-zinc-300 hover:text-green-500"
                      }`}
                    >
                      {record.active ? <Trash2 size={14} /> : <RotateCcw size={14} />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {grouped.length === 0 && (
          <div className="text-center py-12 text-zinc-500 text-sm">No cases match.</div>
        )}
      </div>
    </div>
  );
}
