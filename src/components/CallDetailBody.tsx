"use client";

import { Loader2 } from "lucide-react";
import TranscriptView from "./TranscriptView";
import ToolCallCard from "./ToolCallCard";
import JsonTree from "./JsonTree";
import Stars from "./Stars";
import GradeBreakdown, { type CallGradeBreakdown } from "./GradeBreakdown";
import {
  resolveToolTimeline,
  type ToolTimelineEntry,
  type ToolCallSummary,
  type TimelineItem,
} from "@/lib/transcript";

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

// Fields already rendered in full by their own tab, or too heavy/low-signal
// to be worth including (access_token is a short-lived WebRTC join token,
// irrelevant once the call is over) — dropped from Raw JSON so it's the
// catch-all for everything else instead of a full duplicate dump.
const RAW_JSON_OMIT_KEYS = new Set([
  "transcript",
  "transcript_object",
  "transcript_with_tool_calls",
  "tool_calls",
  "retell_llm_dynamic_variables",
  "call_analysis",
  "access_token",
]);

/**
 * The grade trigger button. Renders nothing when `onGrade` is omitted (e.g. the
 * public share page). `label` lets callers say "Grade call" for a first grade or
 * "Rerun grader" to re-grade an already-graded call.
 */
function GradeButton({
  onGrade,
  grading,
  label,
}: {
  onGrade?: () => void;
  grading?: boolean;
  label: string;
}) {
  if (!onGrade) return null;
  return (
    <button
      onClick={onGrade}
      disabled={grading}
      className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
    >
      {grading && <Loader2 className="animate-spin" size={14} />}
      {grading ? "Grading…" : label}
    </button>
  );
}

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
  // transcript_with_tool_calls is Retell's single chronological array mixing
  // speech turns and tool-call events (verified against real get-call/
  // list-calls responses — see resolveToolTimeline's doc comment). tool_calls
  // is a separate summary array that carries per-call latency the timeline
  // itself doesn't have.
  const toolTimeline = data.transcript_with_tool_calls as ToolTimelineEntry[] | undefined;
  const toolSummary = data.tool_calls as ToolCallSummary[] | undefined;
  const resolvedToolCalls = resolveToolTimeline(toolTimeline ?? [], toolSummary ?? []).filter(
    (item): item is Extract<TimelineItem, { kind: "tool" }> => item.kind === "tool"
  );
  const analysis = data.call_analysis as Record<string, unknown> | undefined;
  const variables = data.retell_llm_dynamic_variables as
    | Record<string, unknown>
    | undefined;
  const aiGrade = data.ai_grade as { score: number; note: string } | null | undefined;
  // Full 0-100 grade row (from call_grades) — drives the rich breakdown; null
  // for dev calls that only have a legacy 0-10 ai_grade.
  const callGrades = data.call_grades as CallGradeBreakdown | null | undefined;

  if (tab === "transcript") {
    if (toolTimeline && toolTimeline.length > 0) {
      return (
        <TranscriptView
          turns={transcriptObj ?? []}
          toolTimeline={toolTimeline}
          toolSummary={toolSummary}
        />
      );
    }
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
        {resolvedToolCalls.length > 0 ? (
          <>
            <p className="text-xs text-zinc-500">
              {resolvedToolCalls.length} tool call{resolvedToolCalls.length === 1 ? "" : "s"}
            </p>
            {resolvedToolCalls.map((item) => (
              <ToolCallCard key={item.call.toolCallId} call={item.call} />
            ))}
          </>
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
    // Prefer the rich 0-100 breakdown when a call_grades row exists. Offer a
    // rerun so an already-graded call can be re-scored from the modal.
    if (callGrades) {
      return (
        <div className="space-y-4">
          <GradeBreakdown grade={callGrades} />
          <GradeButton onGrade={onGrade} grading={grading} label="Rerun grader" />
        </div>
      );
    }
    if (!aiGrade) {
      return (
        <div className="space-y-3">
          <p className="text-sm text-zinc-500">
            No AI grade yet — it&apos;s generated the first time this call is opened
            and can take a few seconds.
          </p>
          <GradeButton onGrade={onGrade} grading={grading} label="Grade call" />
        </div>
      );
    }
    // Dev fallback: legacy 0-10 stars + short note; rerun upgrades it to the
    // full 0-100 breakdown.
    return (
      <div className="space-y-3">
        <Stars
          value={aiGrade.score}
          size={20}
          filledClass="fill-purple-500 text-purple-500"
        />
        <p className="text-sm text-zinc-700 dark:text-zinc-300">{aiGrade.note}</p>
        <GradeButton onGrade={onGrade} grading={grading} label="Rerun grader" />
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

  const rawData = Object.fromEntries(
    Object.entries(data).filter(([key]) => !RAW_JSON_OMIT_KEYS.has(key))
  );
  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-400">
        Transcript, tool calls, analysis, and variables are shown in their own
        tabs — omitted here to keep this readable.
      </p>
      <div className="bg-zinc-50 dark:bg-zinc-900 rounded-lg p-4 overflow-x-auto">
        <JsonTree data={rawData} />
      </div>
    </div>
  );
}
