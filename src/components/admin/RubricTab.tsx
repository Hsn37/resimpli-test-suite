"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, Plus, Save } from "lucide-react";
import { useToast } from "@/components/Toast";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { RUBRIC_KIND, type RubricKind } from "@/lib/rubricKinds";

interface RubricRow {
  key: string;
  name: string;
  definition: string;
  sort_order: number;
  active: boolean;
}

// Shared form-control styles matching the rest of the admin theme (zinc/blue).
const INPUT_CLASS =
  "w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm";
const LABEL_CLASS = "text-xs font-medium text-zinc-500";

// Suggested next key uses a lowercase snake_case placeholder; the server
// enforces the same immutable-key contract.
const NEW_ROW: RubricRow = { key: "", name: "", definition: "", sort_order: 0, active: true };

// Rubric tab: edit failure classes + rep dimensions (name/definition/active/
// sort_order, add-new with immutable key) and the grader system prompt, all
// per active workspace. Save writes back to the workspace's rows; the grader
// picks them up on its next run (reads from DB each time).
export default function RubricTab() {
  const { workspace } = useWorkspace();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [failureClasses, setFailureClasses] = useState<RubricRow[]>([]);
  const [repDimensions, setRepDimensions] = useState<RubricRow[]>([]);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [savingPrompt, setSavingPrompt] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/rubric");
      if (!res.ok) throw new Error("Failed to load rubric");
      const data = await res.json();
      setFailureClasses(data.failureClasses || []);
      setRepDimensions(data.repDimensions || []);
      setSystemPrompt(data.systemPrompt || "");
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Load failed", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Reload whenever the active workspace changes so the editor always reflects
  // the workspace whose rubric is being edited. Deferred into a microtask so
  // state updates land in a callback (avoids react-hooks/set-state-in-effect).
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load, workspace]);

  async function saveRow(kind: RubricKind, row: RubricRow, isNew: boolean) {
    const res = await fetch("/api/admin/rubric", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, row, isNew }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Save failed");
    }
  }

  async function handleSavePrompt() {
    setSavingPrompt(true);
    try {
      const res = await fetch("/api/admin/rubric", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemPrompt }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Save failed");
      }
      toast("System prompt saved", "success");
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Save failed", "error");
    } finally {
      setSavingPrompt(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-zinc-400" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <RubricSection
        title="Failure classes"
        blurb="Layer-1 checks — the “doesn't sound robotic” floor. Deactivating one removes it from grading."
        kind={RUBRIC_KIND.failureClass}
        rows={failureClasses}
        setRows={setFailureClasses}
        saveRow={saveRow}
        onSaved={load}
      />
      <RubricSection
        title="Rep dimensions"
        blurb="Layer-2 scorecard — QA-manager view of a human acquisitions rep."
        kind={RUBRIC_KIND.repDimension}
        rows={repDimensions}
        setRows={setRepDimensions}
        saveRow={saveRow}
        onSaved={load}
      />

      {/* Grader system prompt */}
      <div>
        <h3 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-1">
          Grader system prompt
        </h3>
        <p className="text-xs text-zinc-500 mb-3">
          Instructions handed to the grading model on every run for this workspace.
        </p>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={12}
          className={`${INPUT_CLASS} font-mono leading-relaxed`}
        />
        <div className="flex justify-end mt-2">
          <button
            onClick={handleSavePrompt}
            disabled={savingPrompt}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {savingPrompt ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Save prompt
          </button>
        </div>
      </div>
    </div>
  );
}

// One editable rubric layer (failure classes OR rep dimensions). Identical shape
// for both, so it's a single reusable section (DRY).
function RubricSection({
  title,
  blurb,
  kind,
  rows,
  setRows,
  saveRow,
  onSaved,
}: {
  title: string;
  blurb: string;
  kind: RubricKind;
  rows: RubricRow[];
  setRows: React.Dispatch<React.SetStateAction<RubricRow[]>>;
  saveRow: (kind: RubricKind, row: RubricRow, isNew: boolean) => Promise<void>;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<RubricRow | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  function patchRow(key: string, patch: Partial<RubricRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  async function commit(row: RubricRow, isNew: boolean) {
    setSavingKey(row.key || "__new__");
    try {
      await saveRow(kind, row, isNew);
      toast(`${title} saved`, "success");
      if (isNew) setDraft(null);
      onSaved();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Save failed", "error");
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide">{title}</h3>
        <button
          onClick={() => setDraft({ ...NEW_ROW, sort_order: rows.length + 1 })}
          disabled={draft !== null}
          className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline disabled:opacity-40 disabled:no-underline"
        >
          <Plus size={14} />
          Add
        </button>
      </div>
      <p className="text-xs text-zinc-500 mb-3">{blurb}</p>

      <div className="space-y-3">
        {rows.map((row) => (
          <RubricRowEditor
            key={row.key}
            row={row}
            saving={savingKey === row.key}
            onChange={(patch) => patchRow(row.key, patch)}
            onSave={() => commit(row, false)}
          />
        ))}

        {draft && (
          <RubricRowEditor
            row={draft}
            isNew
            saving={savingKey === "__new__"}
            onChange={(patch) => setDraft((d) => (d ? { ...d, ...patch } : d))}
            onSave={() => commit(draft, true)}
            onCancel={() => setDraft(null)}
          />
        )}

        {rows.length === 0 && !draft && (
          <div className="text-center py-8 text-zinc-500 text-sm">Nothing configured yet.</div>
        )}
      </div>
    </div>
  );
}

// A single rubric row's form. `key` is a plain input only when creating (isNew);
// once saved it's immutable (rendered read-only) because it's the grader contract.
function RubricRowEditor({
  row,
  isNew = false,
  saving,
  onChange,
  onSave,
  onCancel,
}: {
  row: RubricRow;
  isNew?: boolean;
  saving: boolean;
  onChange: (patch: Partial<RubricRow>) => void;
  onSave: () => void;
  onCancel?: () => void;
}) {
  return (
    <div
      className={`rounded-lg border p-3 space-y-2 ${
        row.active
          ? "border-zinc-200 dark:border-zinc-800"
          : "border-dashed border-zinc-300 dark:border-zinc-700 opacity-70"
      }`}
    >
      <div className="flex items-center gap-2">
        {isNew ? (
          <input
            placeholder="immutable_key"
            value={row.key}
            onChange={(e) => onChange({ key: e.target.value })}
            className={`${INPUT_CLASS} flex-1 font-mono`}
          />
        ) : (
          <code className="flex-1 text-xs text-zinc-500 font-mono truncate" title={row.key}>
            {row.key}
          </code>
        )}
        <label className="flex items-center gap-1 shrink-0">
          <span className={LABEL_CLASS}>sort</span>
          <input
            type="number"
            value={row.sort_order}
            onChange={(e) => onChange({ sort_order: Number(e.target.value) })}
            className={`${INPUT_CLASS} w-16`}
          />
        </label>
        <button
          onClick={() => onChange({ active: !row.active })}
          role="switch"
          aria-checked={row.active}
          title={row.active ? "Active — click to deactivate" : "Inactive — click to activate"}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
            row.active ? "bg-blue-600" : "bg-zinc-300 dark:bg-zinc-700"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              row.active ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>
      <input
        placeholder="Name"
        value={row.name}
        onChange={(e) => onChange({ name: e.target.value })}
        className={`${INPUT_CLASS} font-medium`}
      />
      <textarea
        placeholder="Definition"
        value={row.definition}
        onChange={(e) => onChange({ definition: e.target.value })}
        rows={3}
        className={INPUT_CLASS}
      />
      <div className="flex justify-end gap-2">
        {onCancel && (
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
          >
            Cancel
          </button>
        )}
        <button
          onClick={onSave}
          disabled={saving}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save
        </button>
      </div>
    </div>
  );
}
