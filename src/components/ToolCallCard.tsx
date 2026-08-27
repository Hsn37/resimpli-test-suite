"use client";

import { useState } from "react";
import { ChevronDown, Wrench, CheckCircle2, XCircle } from "lucide-react";
import type { ResolvedToolCall } from "@/lib/transcript";

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Recursively renders a JSON value in a readable shape instead of a single
 * flat code dump — real tool outputs are often an object whose values are
 * multi-paragraph prose (agent instructions/scripts), which reads far better
 * as labeled text blocks than squeezed into escaped JSON. */
function PrettyValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-zinc-400 italic">null</span>;
  }
  if (typeof value === "string") {
    return (
      <p className="whitespace-pre-wrap break-words text-zinc-700 dark:text-zinc-300">
        {value || <span className="text-zinc-400 italic">(empty)</span>}
      </p>
    );
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return <span className="font-mono text-zinc-700 dark:text-zinc-300">{String(value)}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-zinc-400 italic">(empty list)</span>;
    return (
      <ul className="list-disc list-inside space-y-1">
        {value.map((v, i) => (
          <li key={i} className="text-zinc-700 dark:text-zinc-300">
            {typeof v === "object" && v !== null ? (
              <span className="font-mono text-xs break-words">{JSON.stringify(v)}</span>
            ) : (
              String(v)
            )}
          </li>
        ))}
      </ul>
    );
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return <span className="text-zinc-400 italic">(empty object)</span>;
  return (
    <div className="space-y-2.5">
      {entries.map(([key, v]) => (
        <div key={key}>
          <div className="text-[10px] font-mono font-semibold uppercase tracking-wide text-zinc-400 mb-0.5">
            {key}
          </div>
          <PrettyValue value={v} />
        </div>
      ))}
    </div>
  );
}

/** Collapsed-by-default card for one resolved tool call: name, position in
 * the call, latency, success, and expandable args/output. Used inline in the
 * transcript (at the point the call happened) and in the flat Tool Calls tab. */
export default function ToolCallCard({ call }: { call: ResolvedToolCall }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/40 dark:bg-indigo-950/20">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left"
      >
        <Wrench size={13} className="text-indigo-500 dark:text-indigo-400 shrink-0" />
        <span className="text-xs font-mono font-semibold text-indigo-700 dark:text-indigo-300 truncate">
          {call.name}
        </span>
        <span className="text-[10px] text-zinc-400 font-mono shrink-0">
          {formatTime(call.timeSec)}
        </span>
        {call.latencyMs != null && (
          <span className="text-[10px] text-zinc-400 shrink-0">
            {Math.round(call.latencyMs)}ms
          </span>
        )}
        {call.successful === false && (
          <XCircle size={12} className="text-red-500 shrink-0" />
        )}
        {call.successful === true && (
          <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />
        )}
        <ChevronDown
          size={12}
          className={`ml-auto text-zinc-400 transition-transform shrink-0 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="px-3.5 pb-3.5 space-y-3 text-sm border-t border-indigo-200/60 dark:border-indigo-900/40 pt-3">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1">
              Arguments
            </div>
            <PrettyValue value={call.args} />
          </div>
          {call.output !== null ? (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1">
                Output
              </div>
              <div className="max-h-64 overflow-y-auto pr-1">
                <PrettyValue value={call.output} />
              </div>
            </div>
          ) : (
            <p className="text-zinc-400 italic text-xs">
              No result recorded — the call may have ended before it returned.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
