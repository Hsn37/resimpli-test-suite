"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronUp,
  Copy,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import VarEditor from "./VarEditor";
import TestCaseJsonImport from "./TestCaseJsonImport";
import { LLM_MODEL_OPTIONS, emptyTestCase, type TestCase } from "@/lib/testCase";

type CaseDraft = Omit<TestCase, "id">;

interface Item {
  key: number;
  case: CaseDraft;
}

interface Props {
  cases: CaseDraft[];
  onChange: (cases: CaseDraft[]) => void;
  /** Fires with the indices (into `cases`, in its current order) of the cases
   * currently checked to run. New/imported cases are checked by default. */
  onSelectionChange?: (selectedIndices: number[]) => void;
}

function MetricsEditor({
  metrics,
  onChange,
}: {
  metrics: string[];
  onChange: (metrics: string[]) => void;
}) {
  const [newMetric, setNewMetric] = useState("");

  function add() {
    const trimmed = newMetric.trim();
    if (!trimmed) return;
    onChange([...metrics, trimmed]);
    setNewMetric("");
  }

  function update(i: number, value: string) {
    onChange(metrics.map((m, idx) => (idx === i ? value : m)));
  }

  function remove(i: number) {
    onChange(metrics.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-1.5">
      {metrics.map((m, i) => (
        <div key={i} className="flex items-start gap-2">
          <input
            value={m}
            onChange={(e) => update(i, e.target.value)}
            className="flex-1 text-sm px-2.5 py-1.5 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            onClick={() => remove(i)}
            className="pt-1.5 text-zinc-300 hover:text-red-500 transition-colors shrink-0"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2 pt-1">
        <input
          type="text"
          placeholder="Add a success metric..."
          value={newMetric}
          onChange={(e) => setNewMetric(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          className="text-sm px-2.5 py-1.5 rounded border border-dashed border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 flex-1"
        />
        <button onClick={add} className="text-zinc-400 hover:text-blue-500 transition-colors">
          <Plus size={16} />
        </button>
      </div>
    </div>
  );
}

function CaseCard({
  index,
  item,
  expanded,
  selected,
  onToggle,
  onToggleSelected,
  onUpdate,
  onDuplicate,
  onRemove,
}: {
  index: number;
  item: Item;
  expanded: boolean;
  selected: boolean;
  onToggle: () => void;
  onToggleSelected: () => void;
  onUpdate: (next: CaseDraft) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const c = item.case;

  return (
    <div
      className={`rounded-lg border overflow-hidden ${
        selected
          ? "border-zinc-200 dark:border-zinc-800"
          : "border-zinc-200 dark:border-zinc-800 opacity-50"
      }`}
    >
      <div className="flex items-center gap-2.5 px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelected}
          title="Include in run"
          className="shrink-0 h-4 w-4 accent-blue-600"
        />
        <span className="text-xs font-mono tabular-nums text-zinc-400 shrink-0 w-6">
          {String(index + 1).padStart(2, "0")}
        </span>
        <input
          value={c.name}
          onChange={(e) => onUpdate({ ...c, name: e.target.value })}
          placeholder="Test case name"
          className="flex-1 text-sm font-medium bg-transparent focus:outline-none min-w-0"
        />
        {!expanded && (
          <span className="hidden sm:inline text-[11px] text-zinc-400 shrink-0 tabular-nums">
            {c.metrics.length} metric{c.metrics.length === 1 ? "" : "s"} · {Object.keys(c.dynamic_variables).length} var{Object.keys(c.dynamic_variables).length === 1 ? "" : "s"}
          </span>
        )}
        <span className="text-xs text-zinc-400 shrink-0">{c.llm_model}</span>
        <button
          onClick={onToggle}
          className={`text-zinc-400 hover:text-blue-500 transition-colors shrink-0 ${expanded ? "text-blue-500" : ""}`}
          title={expanded ? "Close editor" : "Edit"}
        >
          {expanded ? <ChevronUp size={15} /> : <Pencil size={14} />}
        </button>
        <button
          onClick={onDuplicate}
          className="text-zinc-400 hover:text-blue-500 transition-colors shrink-0"
          title="Duplicate"
        >
          <Copy size={14} />
        </button>
        <button
          onClick={onRemove}
          className="text-zinc-400 hover:text-red-500 transition-colors shrink-0"
          title="Remove"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-4 border-t border-zinc-100 dark:border-zinc-900">
          <div>
            <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">
              User Prompt (simulator instructions)
            </label>
            <textarea
              value={c.user_prompt}
              onChange={(e) => onUpdate({ ...c, user_prompt: e.target.value })}
              rows={6}
              className="w-full mt-1 text-sm px-2.5 py-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 resize-y"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">
              Success Metrics
            </label>
            <div className="mt-1">
              <MetricsEditor
                metrics={c.metrics}
                onChange={(metrics) => onUpdate({ ...c, metrics })}
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">
              Dynamic Variables
            </label>
            <div className="mt-1">
              <VarEditor
                variables={c.dynamic_variables}
                onChange={(dynamic_variables) => onUpdate({ ...c, dynamic_variables })}
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">
              Simulator Model
            </label>
            <select
              value={c.llm_model}
              onChange={(e) => onUpdate({ ...c, llm_model: e.target.value })}
              className="mt-1 w-full text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-2"
            >
              {LLM_MODEL_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">
              Tool Mocks (raw JSON array)
            </label>
            <textarea
              value={JSON.stringify(c.tool_mocks, null, 2)}
              onChange={(e) => {
                try {
                  const parsed = JSON.parse(e.target.value);
                  if (Array.isArray(parsed)) onUpdate({ ...c, tool_mocks: parsed });
                } catch {
                  // ignore invalid JSON while typing
                }
              }}
              rows={3}
              className="w-full mt-1 text-xs font-mono px-2.5 py-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 resize-y"
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default function TestCaseSetEditor({ cases, onChange, onSelectionChange }: Props) {
  const nextKey = useRef(cases.length);
  const [items, setItems] = useState<Item[]>(() =>
    cases.map((c, i) => ({ key: i, case: c }))
  );
  const [expandedKey, setExpandedKey] = useState<number | null>(
    items.length === 1 ? items[0].key : null
  );
  // All cases run by default; unchecking narrows a run to a subset.
  const [selectedKeys, setSelectedKeys] = useState<Set<number>>(
    () => new Set(items.map((i) => i.key))
  );

  useEffect(() => {
    onSelectionChange?.(
      items.reduce<number[]>((acc, item, index) => {
        if (selectedKeys.has(item.key)) acc.push(index);
        return acc;
      }, [])
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, selectedKeys]);

  function commit(next: Item[]) {
    setItems(next);
    onChange(next.map((i) => i.case));
  }

  function addCase() {
    const item = { key: nextKey.current++, case: emptyTestCase() };
    commit([...items, item]);
    setSelectedKeys((prev) => new Set(prev).add(item.key));
    setExpandedKey(item.key);
  }

  function importCases(imported: CaseDraft[]) {
    const newItems = imported.map((c) => ({ key: nextKey.current++, case: c }));
    commit([...items, ...newItems]);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      for (const item of newItems) next.add(item.key);
      return next;
    });
  }

  function updateCase(key: number, next: CaseDraft) {
    commit(items.map((i) => (i.key === key ? { ...i, case: next } : i)));
  }

  function duplicateCase(key: number) {
    const idx = items.findIndex((i) => i.key === key);
    if (idx === -1) return;
    const copy = { key: nextKey.current++, case: { ...items[idx].case, name: `${items[idx].case.name} (copy)` } };
    const next = [...items];
    next.splice(idx + 1, 0, copy);
    commit(next);
    setSelectedKeys((prev) => new Set(prev).add(copy.key));
  }

  function removeCase(key: number) {
    commit(items.filter((i) => i.key !== key));
    setSelectedKeys((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }

  function toggleSelected(key: number) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const selectedCount = items.filter((i) => selectedKeys.has(i.key)).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">
            {selectedCount} of {items.length} selected
          </span>
          {items.length > 0 && (
            <>
              <button
                onClick={() => setSelectedKeys(new Set(items.map((i) => i.key)))}
                disabled={selectedCount === items.length}
                className="text-xs font-medium text-blue-600 hover:underline disabled:opacity-40 disabled:no-underline"
              >
                Select all
              </button>
              <button
                onClick={() => setSelectedKeys(new Set())}
                disabled={selectedCount === 0}
                className="text-xs font-medium text-zinc-500 hover:underline disabled:opacity-40 disabled:no-underline"
              >
                Select none
              </button>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <TestCaseJsonImport onImport={importCases} />
          <button
            onClick={addCase}
            className="flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
          >
            <Plus size={13} />
            Add Case
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-10 text-zinc-500 text-sm border border-dashed border-zinc-300 dark:border-zinc-700 rounded-lg">
          No test cases yet. Add one or import a JSON file.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item, index) => (
            <CaseCard
              key={item.key}
              index={index}
              item={item}
              expanded={expandedKey === item.key}
              selected={selectedKeys.has(item.key)}
              onToggle={() => setExpandedKey(expandedKey === item.key ? null : item.key)}
              onToggleSelected={() => toggleSelected(item.key)}
              onUpdate={(next) => updateCase(item.key, next)}
              onDuplicate={() => duplicateCase(item.key)}
              onRemove={() => removeCase(item.key)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
