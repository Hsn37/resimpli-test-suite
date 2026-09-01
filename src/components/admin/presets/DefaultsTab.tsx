"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Save, Search, Trash2 } from "lucide-react";
import { useToast } from "@/components/Toast";
import { INPUT_CLASS, LABEL_CLASS, textareaRows } from "@/components/admin/formStyles";
import {
  CALL_TYPES,
  LOCKED_VAR_KEY,
  validateDefaultKey,
  type PresetDefaults,
} from "@/lib/testPreset";

const DEFAULTS_ENDPOINT = "/api/admin/presets/defaults";

/**
 * The per-call-type variable base every case composes against. Adding a
 * variable here reaches every case for that call type immediately — cases store
 * overrides, not composed variables, so there is nothing to backfill.
 */
export default function DefaultsTab() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [defaults, setDefaults] = useState<PresetDefaults>({});
  const [callType, setCallType] = useState<string>(CALL_TYPES[0]);
  const [search, setSearch] = useState("");
  // Local edits, keyed "callType key", so only touched rows are saved.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/presets");
      if (!res.ok) throw new Error("Failed to load defaults");
      const data = await res.json();
      setDefaults(data.defaults ?? {});
      setEdits({});
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Load failed", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  const editKey = (key: string) => `${callType} ${key}`;

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return Object.entries(defaults[callType] ?? {})
      .filter(([key]) => (term ? key.toLowerCase().includes(term) : true))
      .sort(([a], [b]) => a.localeCompare(b));
  }, [defaults, callType, search]);

  async function saveValue(key: string, value: string) {
    setSavingKey(key);
    try {
      const res = await fetch(DEFAULTS_ENDPOINT, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callType, key, value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Save failed");
      setDefaults(data.defaults ?? {});
      setEdits((prev) => {
        const next = { ...prev };
        delete next[editKey(key)];
        return next;
      });
      toast(`${key} saved`, "success");
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Save failed", "error");
    } finally {
      setSavingKey(null);
    }
  }

  async function addVariable() {
    const key = newKey.trim();
    const problem = validateDefaultKey(key);
    if (problem) {
      toast(problem, "error");
      return;
    }
    if (key in (defaults[callType] ?? {})) {
      toast(`${key} already exists for ${callType}`, "error");
      return;
    }
    await saveValue(key, newValue);
    setNewKey("");
    setNewValue("");
  }

  /**
   * Remove a variable. The server answers 409 with the number of cases that
   * override it; those overrides would be orphaned, so the confirmation names
   * the count before we retry with force.
   */
  async function removeVariable(key: string) {
    const url = `${DEFAULTS_ENDPOINT}?callType=${encodeURIComponent(callType)}&key=${encodeURIComponent(key)}`;
    try {
      let res = await fetch(url, { method: "DELETE" });
      let data = await res.json().catch(() => ({}));

      if (res.status === 409) {
        const proceed = window.confirm(
          `${data.error}. Removing it drops those overrides. Continue?`
        );
        if (!proceed) return;
        res = await fetch(`${url}&force=1`, { method: "DELETE" });
        data = await res.json().catch(() => ({}));
      } else if (!window.confirm(`Remove "${key}" from the ${callType} defaults?`)) {
        // Nothing overrode it, but this still changes every case's payload.
        return;
      }

      if (!res.ok) throw new Error(data.error || "Remove failed");
      setDefaults(data.defaults ?? {});
      toast(`${key} removed`, "success");
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Remove failed", "error");
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
    <div className="space-y-4">
      <div className="flex items-center gap-1 flex-wrap">
        {CALL_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => setCallType(type)}
            className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
              callType === type
                ? "bg-blue-600 text-white"
                : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
            }`}
          >
            {type}
          </button>
        ))}
      </div>

      <p className="text-xs text-zinc-500">
        {rows.length} variables. Every {callType} case inherits these unless it overrides them.
        Variables the agent builds at call time (<code>section_*</code>, <code>edv_*</code>) are
        rejected — staging one would overwrite what the agent generates.
      </p>

      <div className="relative">
        <Search
          size={14}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none"
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter variables…"
          className={`${INPUT_CLASS} w-full pl-8`}
        />
      </div>

      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-900">
        {rows.map(([key, value]) => {
          const locked = key === LOCKED_VAR_KEY;
          const draft = edits[editKey(key)];
          const dirty = draft !== undefined && draft !== value;
          return (
            <div key={key} className="flex items-start gap-2 px-2.5 py-2">
              <span
                className={`text-xs font-mono font-semibold pt-2 shrink-0 w-[190px] break-all ${
                  locked ? "text-zinc-400" : "text-zinc-800 dark:text-zinc-200"
                }`}
                title={locked ? `${key} — set by the call direction` : key}
              >
                {key}
              </span>
              <textarea
                value={draft ?? value}
                disabled={locked}
                rows={textareaRows(draft ?? value)}
                onChange={(e) =>
                  setEdits((prev) => ({ ...prev, [editKey(key)]: e.target.value }))
                }
                className={`flex-1 text-sm px-2.5 py-1.5 rounded border bg-white dark:bg-zinc-950 resize-none min-w-0 ${
                  dirty
                    ? "border-blue-400 dark:border-blue-600"
                    : "border-zinc-300 dark:border-zinc-700"
                } ${locked ? "cursor-not-allowed opacity-60" : ""}`}
              />
              <div className="flex items-center gap-1 pt-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => saveValue(key, draft ?? value)}
                  disabled={!dirty || savingKey === key}
                  title="Save this value"
                  className="p-1 text-zinc-300 hover:text-blue-500 disabled:opacity-30 disabled:hover:text-zinc-300 transition-colors"
                >
                  {savingKey === key ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Save size={13} />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => removeVariable(key)}
                  disabled={locked}
                  title="Remove from the defaults"
                  className="p-1 text-zinc-300 hover:text-red-500 disabled:opacity-30 disabled:hover:text-zinc-300 transition-colors"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          );
        })}
        {rows.length === 0 && (
          <div className="px-3 py-8 text-center text-sm text-zinc-400">
            No variables match.
          </div>
        )}
      </div>

      {/* Add */}
      <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-3 space-y-2">
        <span className={LABEL_CLASS}>Add a variable to {callType}</span>
        <div className="flex items-start gap-2">
          <input
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="variable_name"
            className={`${INPUT_CLASS} font-mono w-[190px] shrink-0`}
          />
          <textarea
            value={newValue}
            rows={textareaRows(newValue)}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="Default value (may be blank)"
            className={`${INPUT_CLASS} resize-none flex-1 min-w-0`}
          />
          <button
            type="button"
            onClick={addVariable}
            disabled={!newKey.trim() || savingKey !== null}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 shrink-0"
          >
            <Plus size={14} />
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
