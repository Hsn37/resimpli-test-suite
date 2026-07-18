"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, XCircle, MinusCircle } from "lucide-react";
import {
  gradeBand,
  gradeBandClasses,
  GOOD_TEXT,
  BAD_TEXT,
  CALLOUT_TEXT,
  CALLOUT_CARD,
} from "@/lib/dashboard";

// The 0-100 call_grades row, in the shape both the /calls modal and the
// /dashboard/calls/[id] page consume. Kept structurally compatible with
// DashCallGrade / getDashboardCallDetail so callers can pass either.
export interface CallGradeBreakdown {
  grade: number | null;
  applicable_count: number;
  passed_count: number;
  results: Record<string, { applicable: boolean; passed: boolean; evidence: string }>;
  ai_callout: boolean;
  ai_callout_quote?: string | null;
  rep_score: number | null;
  rep_scorecard: Record<string, { applicable: boolean; score: number | null; evidence: string }>;
}

interface RubricRow {
  key: string;
  name: string;
}

const BADGE = "inline-flex items-center rounded-md px-2 py-0.5 text-sm font-semibold";
const DEFAULT_CALLOUT_NOTE = "Caller indicated suspicion of AI.";

/**
 * Rich per-call grade breakdown: rep-score/100 + grade/100 chips + an
 * AI-callout card + per-rep-dimension scorecard + per-failure-class results
 * with evidence. Reuses the dashboard's gradeBand/theme helpers. Fetches the
 * workspace rubric (key→name) itself so callers only pass the grade row.
 */
export default function GradeBreakdown({ grade }: { grade: CallGradeBreakdown }) {
  const [failureClasses, setFailureClasses] = useState<RubricRow[]>([]);
  const [repDimensions, setRepDimensions] = useState<RubricRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/dashboard/rubric")
      .then((r) => (r.ok ? r.json() : { failureClasses: [], repDimensions: [] }))
      .then((rubric) => {
        if (cancelled) return;
        setFailureClasses(rubric.failureClasses ?? []);
        setRepDimensions(rubric.repDimensions ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const rep = grade.rep_score;
  const g = grade.grade;

  return (
    <div className="space-y-4">
      {/* Headline: rep score + grade, both as banded /100 chips */}
      <div className="flex flex-wrap items-center gap-3">
        <span className={`${BADGE} ${gradeBandClasses(gradeBand(rep))}`}>
          {rep == null ? "n/a" : `${Math.round(rep)}`}
          {rep != null && <span className="text-xs opacity-70 ml-0.5">/100</span>}
        </span>
        <span className="text-xs text-zinc-400">rep score</span>
        <span className={`${BADGE} ${gradeBandClasses(gradeBand(g))}`}>
          {g == null ? "n/a" : `${Math.round(g)}`}
          {g != null && <span className="text-xs opacity-70 ml-0.5">/100</span>}
        </span>
        <span className="text-xs text-zinc-400">grade</span>
      </div>

      {/* AI callout card */}
      {grade.ai_callout && (
        <div className={`rounded-xl border p-4 ${CALLOUT_CARD}`}>
          <div className={`text-sm font-semibold flex items-center gap-1.5 ${CALLOUT_TEXT}`}>
            <AlertTriangle size={16} /> AI callout detected
          </div>
          <div className="mt-1.5 text-sm">
            {grade.ai_callout_quote?.trim() || DEFAULT_CALLOUT_NOTE}
          </div>
        </div>
      )}

      {/* Rep scorecard */}
      <div>
        <div className="text-sm font-semibold mb-2">
          Rep scorecard{" "}
          <span className="text-xs font-normal text-zinc-500 ml-1">
            {rep != null ? `avg ${Math.round(rep)}/100` : "not graded"}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {repDimensions.map((d) => {
            const entry = grade.rep_scorecard?.[d.key];
            const applicable = entry?.applicable ?? false;
            const score = entry?.score ?? null;
            return (
              <div key={d.key} className="rounded-md border border-zinc-200 dark:border-zinc-800 p-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{d.name}</span>
                  {applicable && score != null ? (
                    <span
                      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums ${gradeBandClasses(
                        gradeBand(score)
                      )}`}
                    >
                      {score}
                    </span>
                  ) : (
                    <span className="text-xs text-zinc-500">n/a</span>
                  )}
                </div>
                {entry?.evidence && (
                  <div className="mt-1.5 text-xs text-zinc-500 italic">&ldquo;{entry.evidence}&rdquo;</div>
                )}
              </div>
            );
          })}
          {repDimensions.length === 0 && (
            <div className="text-sm text-zinc-500 md:col-span-2">No rep dimensions configured.</div>
          )}
        </div>
      </div>

      {/* Failure-class results */}
      <div>
        <div className="text-sm font-semibold mb-2">
          Grading results{" "}
          <span className="text-xs font-normal text-zinc-500 ml-1">
            {grade.passed_count}/{grade.applicable_count} applicable passed
          </span>
        </div>
        <div className="space-y-2">
          {failureClasses.map((cls) => (
            <ClassResultRow key={cls.key} name={cls.name} result={grade.results?.[cls.key]} />
          ))}
          {failureClasses.length === 0 && (
            <div className="text-sm text-zinc-500">No failure classes configured.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function ClassResultRow({
  name,
  result,
}: {
  name: string;
  result?: { applicable: boolean; passed: boolean; evidence: string };
}) {
  let icon: React.ReactNode;
  let statusText: string;
  let statusClass: string;
  if (!result || !result.applicable) {
    icon = <MinusCircle size={16} className="text-zinc-400" />;
    statusText = "n/a";
    statusClass = "text-zinc-500";
  } else if (result.passed) {
    icon = <CheckCircle2 size={16} className="text-green-600 dark:text-green-400" />;
    statusText = "passed";
    statusClass = GOOD_TEXT;
  } else {
    icon = <XCircle size={16} className="text-red-600 dark:text-red-400" />;
    statusText = "failed";
    statusClass = BAD_TEXT;
  }
  return (
    <div className="rounded-md border border-zinc-200 dark:border-zinc-800 p-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-medium">{name}</span>
        </div>
        <span className={`text-xs font-medium ${statusClass}`}>{statusText}</span>
      </div>
      {result?.evidence && (
        <div className="mt-1.5 text-xs text-zinc-500 italic">&ldquo;{result.evidence}&rdquo;</div>
      )}
    </div>
  );
}
