"use client";

import type { TranscriptTurn, ToolTimelineEntry, ToolCallSummary } from "@/lib/transcript";
import { resolveToolTimeline } from "@/lib/transcript";
import ToolCallCard from "./ToolCallCard";

export type { TranscriptTurn };

function SpeechBubble({ role, content }: { role: string; content: string }) {
  return (
    <div className={`flex ${role === "agent" ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[80%] px-3 py-2 rounded-lg text-sm break-words ${
          role === "agent"
            ? "bg-zinc-100 dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200"
            : "bg-blue-600 text-white"
        }`}
      >
        <div className="text-[10px] font-semibold uppercase mb-0.5 opacity-60">{role}</div>
        {content}
      </div>
    </div>
  );
}

interface Props {
  turns: TranscriptTurn[];
  /** Retell's transcript_with_tool_calls — when present (real calls only,
   * not the batch-test-run simulated snapshots this component also renders),
   * tool calls are shown inline at the point they happened instead of just
   * the plain turns above. */
  toolTimeline?: ToolTimelineEntry[];
  /** Retell's separate tool_calls summary array, for per-call latency. */
  toolSummary?: ToolCallSummary[];
}

/**
 * Renders a call transcript as chat bubbles. Shared by CallDetailBody
 * (live-call transcripts, optionally tool-call-aware) and the batch test-run
 * detail modal (simulated transcripts, plain turns only).
 */
export default function TranscriptView({ turns, toolTimeline, toolSummary }: Props) {
  if (toolTimeline && toolTimeline.length > 0) {
    const items = resolveToolTimeline(toolTimeline, toolSummary);
    return (
      <div className="space-y-3">
        {items.map((item, i) =>
          item.kind === "tool" ? (
            <ToolCallCard key={`tool-${item.call.toolCallId}-${i}`} call={item.call} />
          ) : (
            <SpeechBubble key={`speech-${i}`} role={item.entry.role} content={item.entry.content} />
          )
        )}
      </div>
    );
  }

  if (turns.length === 0) {
    return <p className="text-sm text-zinc-500">No transcript available.</p>;
  }

  return (
    <div className="space-y-3">
      {turns.map((msg, i) => (
        <SpeechBubble key={i} role={msg.role} content={msg.content} />
      ))}
    </div>
  );
}
