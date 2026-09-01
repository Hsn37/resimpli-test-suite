"use client";

import { useMemo, useState } from "react";
import { EyeOff, RotateCcw, Search } from "lucide-react";
import { INPUT_CLASS, textareaRows } from "@/components/admin/formStyles";
import { LOCKED_VAR_KEY, type OverrideValue } from "@/lib/testPreset";

interface Props {
  callType: string;
  defaults: Record<string, string>;
  overrides: Record<string, OverrideValue>;
  onChange: (overrides: Record<string, OverrideValue>) => void;
}

type RowState = "base" | "override" | "absent";

const STATE_STYLES: Record<RowState, string> = {
  base: "text-zinc-400",
  override: "text-blue-600 dark:text-blue-400",
  absent: "text-amber-600 dark:text-amber-400",
};

/**
 * Per-case variable editor. Unlike the tester-facing VarEditor this edits
 * OVERRIDES against the call type's base, and carries the third state the base
 * has no concept of: **absent**, an override of null, which deletes the
 * variable from the payload so a case can test what the agent does when it is
 * missing rather than blank (T-130 / T-135 / T-140).
 */
export default function OverridesEditor({
  callType,
  defaults,
  overrides,
  onChange,
}: Props) {
  const [search, setSearch] = useState("");
  const [overridesOnly, setOverridesOnly] = useState(false);

  const rows = useMemo(() => {
    // Union of the base and anything the case overrides, so a key that has
    // since been removed from the base is still visible (and fixable).
    const keys = new Set([...Object.keys(defaults), ...Object.keys(overrides)]);
    const term = search.trim().toLowerCase();
    return [...keys]
      .filter((key) => key !== LOCKED_VAR_KEY)
      .map((key) => {
        const overridden = key in overrides;
        const state: RowState = !overridden
          ? "base"
          : overrides[key] === null
            ? "absent"
            : "override";
        return {
          key,
          state,
          value: overridden ? (overrides[key] ?? "") : (defaults[key] ?? ""),
          orphaned: !(key in defaults),
        };
      })
      .filter((row) => (overridesOnly ? row.state !== "base" : true))
      .filter((row) => (term ? row.key.toLowerCase().includes(term) : true))
      .sort((a, b) => {
        // Overridden rows first — they are what the case is actually about.
        const rank = (s: RowState) => (s === "base" ? 1 : 0);
        return rank(a.state) - rank(b.state) || a.key.localeCompare(b.key);
      });
  }, [defaults, overrides, search, overridesOnly]);

  function setOverride(key: string, value: OverrideValue) {
    onChange({ ...overrides, [key]: value });
  }

  function resetToBase(key: string) {
    const next = { ...overrides };
    delete next[key];
    onChange(next);
  }

  const overrideCount = Object.keys(overrides).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter variables…"
            className={`${INPUT_CLASS} w-full pl-7`}
          />
        </div>
        <button
          type="button"
          onClick={() => setOverridesOnly((v) => !v)}
          className={`text-xs font-medium px-3 py-2 rounded-lg transition-colors shrink-0 ${
            overridesOnly
              ? "bg-blue-600 text-white"
              : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
          }`}
        >
          Overrides only ({overrideCount})
        </button>
      </div>

      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-900">
        {rows.map((row) => (
          <div key={row.key} className="flex items-start gap-2 px-2.5 py-2">
            <span
              className={`text-xs font-mono font-semibold pt-2 shrink-0 w-[190px] break-all ${STATE_STYLES[row.state]}`}
              title={row.orphaned ? `${row.key} — no longer a ${callType} default` : row.key}
            >
              {row.key}
              {row.orphaned && <span className="text-red-500"> ⚠</span>}
            </span>
            {row.state === "absent" ? (
              <span className="flex-1 text-xs italic text-amber-600 dark:text-amber-400 py-2">
                absent — deleted from the payload, not sent as blank
              </span>
            ) : (
              <textarea
                value={row.value}
                rows={textareaRows(row.value)}
                onChange={(e) => setOverride(row.key, e.target.value)}
                className={`flex-1 text-sm px-2.5 py-1.5 rounded border bg-white dark:bg-zinc-950 resize-none min-w-0 ${
                  row.state === "override"
                    ? "border-blue-400 dark:border-blue-600"
                    : "border-dashed border-zinc-300 dark:border-zinc-700"
                }`}
              />
            )}
            <div className="flex items-center gap-1 pt-1.5 shrink-0">
              <button
                type="button"
                onClick={() =>
                  row.state === "absent" ? resetToBase(row.key) : setOverride(row.key, null)
                }
                title={
                  row.state === "absent"
                    ? "Restore the base value"
                    : "Stage this variable as absent (deleted from the payload)"
                }
                className={`p-1 rounded transition-colors ${
                  row.state === "absent"
                    ? "text-amber-500"
                    : "text-zinc-300 hover:text-amber-500"
                }`}
              >
                <EyeOff size={13} />
              </button>
              <button
                type="button"
                onClick={() => resetToBase(row.key)}
                disabled={row.state === "base"}
                title="Reset to the base default"
                className="p-1 rounded text-zinc-300 hover:text-blue-500 disabled:opacity-30 disabled:hover:text-zinc-300 transition-colors"
              >
                <RotateCcw size={13} />
              </button>
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <div className="px-3 py-8 text-center text-sm text-zinc-400">
            No variables match.
          </div>
        )}
      </div>
      <p className="text-[11px] text-zinc-500">
        Dashed = inherited from the {callType} defaults. Blue = this case overrides it. Amber =
        staged absent. Add new variables in the Defaults tab.
      </p>
    </div>
  );
}
