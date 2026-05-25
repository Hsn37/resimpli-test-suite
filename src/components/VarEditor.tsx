"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

interface Props {
  variables: Record<string, string>;
  onChange: (vars: Record<string, string>) => void;
  lockedKeys?: string[];
}

export default function VarEditor({ variables, onChange, lockedKeys = [] }: Props) {
  const [newKey, setNewKey] = useState("");

  const entries = useMemo(() => {
    const all = Object.entries(variables);
    const filled = all.filter(([, v]) => v !== "").sort((a, b) => a[0].localeCompare(b[0]));
    const empty = all.filter(([, v]) => v === "").sort((a, b) => a[0].localeCompare(b[0]));
    return [...filled, ...empty];
  }, [variables]);

  function updateValue(key: string, value: string) {
    onChange({ ...variables, [key]: value });
  }

  function removeKey(key: string) {
    const next = { ...variables };
    delete next[key];
    onChange(next);
  }

  function addKey() {
    const trimmed = newKey.trim();
    if (!trimmed || trimmed in variables) return;
    onChange({ ...variables, [trimmed]: "" });
    setNewKey("");
  }

  return (
    <div className="space-y-0.5">
      {entries.map(([key, value]) => {
        const locked = lockedKeys.includes(key);
        const isEmpty = value === "";
        return (
          <div
            key={key}
            className={`flex items-start gap-2 rounded-lg px-2.5 py-2 transition-colors ${
              locked
                ? "opacity-50"
                : "hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
            }`}
          >
            <span
              className={`text-xs font-mono font-semibold pt-1.5 shrink-0 w-[200px] break-all ${
                locked
                  ? "text-zinc-400"
                  : isEmpty
                    ? "text-zinc-400"
                    : "text-zinc-800 dark:text-zinc-200"
              }`}
              title={key}
            >
              {key}
            </span>
            <textarea
              value={value}
              disabled={locked}
              rows={value.length > 80 ? 3 : 1}
              onChange={(e) => updateValue(key, e.target.value)}
              className={`flex-1 text-sm px-2.5 py-1 rounded border bg-white dark:bg-zinc-950 resize-y min-w-0 ${
                locked
                  ? "border-zinc-200 dark:border-zinc-800 cursor-not-allowed"
                  : isEmpty
                    ? "border-dashed border-zinc-300 dark:border-zinc-700"
                    : "border-zinc-300 dark:border-zinc-700"
              }`}
            />
            {!locked && (
              <button
                onClick={() => removeKey(key)}
                className="pt-1.5 text-zinc-300 hover:text-red-500 transition-colors shrink-0"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        );
      })}
      <div className="flex items-center gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
        <input
          type="text"
          placeholder="Add variable..."
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addKey()}
          className="text-sm px-2.5 py-1.5 rounded border border-dashed border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 flex-1"
        />
        <button
          onClick={addKey}
          className="text-zinc-400 hover:text-blue-500 transition-colors"
        >
          <Plus size={16} />
        </button>
      </div>
    </div>
  );
}
