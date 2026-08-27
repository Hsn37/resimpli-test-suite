"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";

function PrimitiveValue({ value }: { value: unknown }) {
  if (value === null) return <span className="text-zinc-400 italic">null</span>;
  if (value === undefined) return <span className="text-zinc-400 italic">undefined</span>;
  if (typeof value === "string") {
    return (
      <span className="text-emerald-700 dark:text-emerald-400 break-words whitespace-pre-wrap">
        &quot;{value}&quot;
      </span>
    );
  }
  if (typeof value === "number") {
    return <span className="text-amber-700 dark:text-amber-400">{value}</span>;
  }
  if (typeof value === "boolean") {
    return <span className="text-purple-600 dark:text-purple-400">{String(value)}</span>;
  }
  return <span>{String(value)}</span>;
}

function TreeNode({ label, value, isLast }: { label?: string; value: unknown; isLast: boolean }) {
  const isCollection = value !== null && typeof value === "object";
  const [open, setOpen] = useState(true);

  if (!isCollection) {
    return (
      <div>
        {label !== undefined && (
          <>
            <span className="text-sky-700 dark:text-sky-400">&quot;{label}&quot;</span>
            <span className="text-zinc-400">: </span>
          </>
        )}
        <PrimitiveValue value={value} />
        {!isLast && <span className="text-zinc-400">,</span>}
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const entries = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);

  if (entries.length === 0) {
    return (
      <div>
        {label !== undefined && (
          <>
            <span className="text-sky-700 dark:text-sky-400">&quot;{label}&quot;</span>
            <span className="text-zinc-400">: </span>
          </>
        )}
        <span className="text-zinc-400">{isArray ? "[]" : "{}"}</span>
        {!isLast && <span className="text-zinc-400">,</span>}
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-0.5 align-middle text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
      >
        <ChevronRight size={11} className={`transition-transform ${open ? "rotate-90" : ""}`} />
        {label !== undefined && (
          <>
            <span className="text-sky-700 dark:text-sky-400">&quot;{label}&quot;</span>
            <span className="text-zinc-400">: </span>
          </>
        )}
        <span className="text-zinc-400">{isArray ? "[" : "{"}</span>
        {!open && (
          <span className="text-zinc-400 italic mx-1">
            {entries.length} {isArray ? "item" : "key"}
            {entries.length === 1 ? "" : "s"}
          </span>
        )}
        {!open && <span className="text-zinc-400">{isArray ? "]" : "}"}</span>}
      </button>
      {open && (
        <>
          <div className="pl-4 border-l border-zinc-100 dark:border-zinc-800 ml-1">
            {entries.map(([key, v], i) => (
              <TreeNode
                key={key}
                label={isArray ? undefined : key}
                value={v}
                isLast={i === entries.length - 1}
              />
            ))}
          </div>
          <span className="text-zinc-400">{isArray ? "]" : "}"}</span>
          {!isLast && <span className="text-zinc-400">,</span>}
        </>
      )}
    </div>
  );
}

/** Collapsible, colorized JSON viewer — no external deps. Every object/array
 * node can be toggled; everything else renders inline. */
export default function JsonTree({ data }: { data: unknown }) {
  return (
    <div className="text-xs font-mono leading-relaxed">
      <TreeNode value={data} isLast />
    </div>
  );
}
