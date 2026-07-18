"use client";

import type { TranscriptTurn } from "@/lib/transcript";

export type { TranscriptTurn };

/**
 * Renders a list of {role, content} turns as chat bubbles. Shared by
 * CallDetailBody (live-call transcripts) and the batch test-run detail
 * modal (simulated transcripts) — both shapes match exactly.
 */
export default function TranscriptView({ turns }: { turns: TranscriptTurn[] }) {
  if (turns.length === 0) {
    return <p className="text-sm text-zinc-500">No transcript available.</p>;
  }

  return (
    <div className="space-y-3">
      {turns.map((msg, i) => (
        <div
          key={i}
          className={`flex ${msg.role === "agent" ? "justify-start" : "justify-end"}`}
        >
          <div
            className={`max-w-[80%] px-3 py-2 rounded-lg text-sm break-words ${
              msg.role === "agent"
                ? "bg-zinc-100 dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200"
                : "bg-blue-600 text-white"
            }`}
          >
            <div className="text-[10px] font-semibold uppercase mb-0.5 opacity-60">
              {msg.role}
            </div>
            {msg.content}
          </div>
        </div>
      ))}
    </div>
  );
}
