"use client";

import { useState } from "react";
import { ChevronDown, Wrench, CheckCircle2, XCircle } from "lucide-react";
import type { ResolvedToolCall } from "@/lib/transcript";

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Collapsed-by-default card for one resolved tool call: name, position in
 * the call, latency, success, and expandable args/output. Used inline in the
 * transcript (at the point the call happened) and in the flat Tool Calls tab. */
export default function ToolCallCard({ call }: { call: ResolvedToolCall }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
      >
        <Wrench size={13} className="text-amber-600 dark:text-amber-500 shrink-0" />
        <span className="text-xs font-mono font-semibold text-amber-800 dark:text-amber-400 truncate">
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
          <CheckCircle2 size={12} className="text-green-600 dark:text-green-500 shrink-0" />
        )}
        <ChevronDown
          size={12}
          className={`ml-auto text-zinc-400 transition-transform shrink-0 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 text-xs font-mono">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-400 mb-0.5">
              Arguments
            </div>
            <pre className="whitespace-pre-wrap break-words text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-900 rounded p-2 overflow-x-auto">
              {formatValue(call.args) || "{}"}
            </pre>
          </div>
          {call.output !== null ? (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-zinc-400 mb-0.5">
                Output
              </div>
              <pre className="whitespace-pre-wrap break-words text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-900 rounded p-2 overflow-x-auto max-h-64 overflow-y-auto">
                {formatValue(call.output)}
              </pre>
            </div>
          ) : (
            <p className="text-zinc-400 italic">
              No result recorded — the call may have ended before it returned.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
