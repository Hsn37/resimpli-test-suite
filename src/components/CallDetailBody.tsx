"use client";

import { Loader2 } from "lucide-react";
import TranscriptView from "./TranscriptView";
import Stars from "./Stars";
import GradeBreakdown, { type CallGradeBreakdown } from "./GradeBreakdown";

export type CallDetailTab =
  | "transcript"
  | "tools"
  | "analysis"
  | "ai_grade"
  | "variables"
  | "raw";

export const CALL_DETAIL_TABS: { key: CallDetailTab; label: string }[] = [
  { key: "transcript", label: "Transcript" },
  { key: "tools", label: "Tool Calls" },
  { key: "analysis", label: "Analysis" },
  { key: "ai_grade", label: "AI Grade" },
  { key: "variables", label: "Variables" },
  { key: "raw", label: "Raw JSON" },
];

export function KeyValueList({ entries }: { entries: [string, unknown][] }) {
  return (
    <div className="space-y-2">
      {entries.map(([key, value]) => (
        <div
          key={key}
          className="flex gap-3 py-1.5 border-b border-zinc-100 dark:border-zinc-900 last:border-0"
        >
          <span className="text-xs font-mono font-semibold text-zinc-600 dark:text-zinc-400 w-[180px] shrink-0 break-all">
            {key}
          </span>
          <span className="text-sm text-zinc-800 dark:text-zinc-200 min-w-0 break-all">
            {typeof value === "string" ? value : JSON.stringify(value)}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Renders the body for the active call-detail tab. Shared by the CallViewer
 * modal and the public /share/[id] page so the two stay in sync.
 */
export default function CallDetailBody({
  data,
  tab,
  onGrade,
  grading,
}: {
  data: Record<string, unknown>;
  tab: CallDetailTab;
  /** Omit to hide the "Grade call" button (e.g. the public share page). */
  onGrade?: () => void;
  grading?: boolean;
}) {
  const transcript = (data.transcript as string) || "";
  const transcriptObj = data.transcript_object as
    | Array<{ role: string; content: string }>
    | undefined;
  const toolCalls = (data.tool_calls ?? data.tool_call_result) as
    | Array<Record<string, unknown>>
    | undefined;
  const analysis = data.call_analysis as Record<string, unknown> | undefined;
  const variables = data.retell_llm_dynamic_variables as
    | Record<string, unknown>
    | undefined;
  const aiGrade = data.ai_grade as { score: number; note: string } | null | undefined;
  // Full 0-100 grade row (from call_grades) — drives the rich breakdown; null
  // for dev calls that only have a legacy 0-10 ai_grade.
  const callGrades = data.call_grades as CallGradeBreakdown | null | undefined;

  if (tab === "transcript") {
    if (transcriptObj && transcriptObj.length > 0) {
      return <TranscriptView turns={transcriptObj} />;
    }
    if (transcript) {
      return (
        <pre className="text-sm whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
          {transcript}
        </pre>
      );
    }
    return <p className="text-sm text-zinc-500">No transcript available.</p>;
  }

  if (tab === "tools") {
    return (
      <div className="space-y-3">
        {toolCalls && toolCalls.length > 0 ? (
          toolCalls.map((tc, i) => (
            <div
              key={i}
              className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-3"
            >
              <pre className="text-xs font-mono whitespace-pre-wrap text-zinc-700 dark:text-zinc-300 overflow-x-auto">
                {JSON.stringify(tc, null, 2)}
              </pre>
            </div>
          ))
        ) : (
          <p className="text-sm text-zinc-500">No tool calls recorded.</p>
        )}
      </div>
    );
  }

  if (tab === "analysis") {
    return analysis && Object.keys(analysis).length > 0 ? (
      <KeyValueList entries={Object.entries(analysis)} />
    ) : (
      <p className="text-sm text-zinc-500">No analysis available.</p>
    );
  }

  if (tab === "ai_grade") {
    // Prefer the rich 0-100 breakdown when a call_grades row exists.
    if (callGrades) {
      return <GradeBreakdown grade={callGrades} />;
    }
    if (!aiGrade) {
      return (
        <div className="space-y-3">
          <p className="text-sm text-zinc-500">
            No AI grade yet — it&apos;s generated the first time this call is opened
            and can take a few seconds.
          </p>
          {onGrade && (
            <button
              onClick={onGrade}
              disabled={grading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
            >
              {grading && <Loader2 className="animate-spin" size={14} />}
              {grading ? "Grading…" : "Grade call"}
            </button>
          )}
        </div>
      );
    }
    // Dev fallback: legacy 0-10 stars + short note.
    return (
      <div className="space-y-3">
        <Stars
          value={aiGrade.score}
          size={20}
          filledClass="fill-purple-500 text-purple-500"
        />
        <p className="text-sm text-zinc-700 dark:text-zinc-300">{aiGrade.note}</p>
      </div>
    );
  }

  if (tab === "variables") {
    return variables && Object.keys(variables).length > 0 ? (
      <KeyValueList entries={Object.entries(variables)} />
    ) : (
      <p className="text-sm text-zinc-500">No dynamic variables available.</p>
    );
  }

  return (
    <pre className="text-xs font-mono whitespace-pre-wrap break-words text-zinc-700 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-900 rounded-lg p-4 overflow-x-auto">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}
