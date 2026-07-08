"use client";

import { useState } from "react";
import { X } from "lucide-react";
import TranscriptView, { type TranscriptTurn } from "./TranscriptView";
import { KeyValueList } from "./CallDetailBody";
import Stars from "./Stars";

export interface TestRun {
  test_case_job_id?: string;
  status?: string;
  result_explanation?: string;
  test_case_definition_snapshot?: {
    name?: string;
    user_prompt?: string;
    metrics?: string[];
  };
  transcript_snapshot?: {
    transcript?: TranscriptTurn[];
    dynamicVariables?: Record<string, unknown>;
  };
  ai_grade?: { score: number; note: string } | null;
}

type Tab = "transcript" | "ai_grade" | "variables" | "raw";

const TABS: { key: Tab; label: string }[] = [
  { key: "transcript", label: "Transcript" },
  { key: "ai_grade", label: "AI Grade" },
  { key: "variables", label: "Variables" },
  { key: "raw", label: "Raw JSON" },
];

const RUN_STATUS_STYLES: Record<string, string> = {
  pass: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
  fail: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  error: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  pending: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  in_progress: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
};

export default function TestRunDetailModal({
  run,
  onClose,
}: {
  run: TestRun;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("transcript");
  const name = run.test_case_definition_snapshot?.name ?? "Test case";
  const turns = run.transcript_snapshot?.transcript ?? [];
  const variables = run.transcript_snapshot?.dynamicVariables ?? {};
  const runStatus = (run.status ?? "").toLowerCase();
  const statusClass =
    RUN_STATUS_STYLES[runStatus] ?? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800 w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
          <h3 className="font-semibold text-sm truncate flex-1 min-w-0">{name}</h3>
          {run.status && (
            <span
              className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full shrink-0 ${statusClass}`}
            >
              {run.status}
            </span>
          )}
          {run.ai_grade && (
            <span title={run.ai_grade.note} className="shrink-0">
              <Stars
                value={run.ai_grade.score}
                size={13}
                filledClass="fill-purple-500 text-purple-500"
                emptyClass="text-zinc-200 dark:text-zinc-700"
              />
            </span>
          )}
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        {run.result_explanation && (
          <div className="px-4 py-3 text-sm text-zinc-600 dark:text-zinc-400 border-b border-zinc-100 dark:border-zinc-900 shrink-0 max-h-32 overflow-y-auto">
            {run.result_explanation}
          </div>
        )}

        <div className="flex items-center gap-1 px-4 pt-3 shrink-0">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                tab === t.key
                  ? "bg-blue-600 text-white"
                  : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {tab === "transcript" && <TranscriptView turns={turns} />}
          {tab === "ai_grade" &&
            (run.ai_grade ? (
              <div className="space-y-3">
                <Stars
                  value={run.ai_grade.score}
                  size={20}
                  filledClass="fill-purple-500 text-purple-500"
                />
                <p className="text-sm text-zinc-700 dark:text-zinc-300">{run.ai_grade.note}</p>
              </div>
            ) : (
              <p className="text-sm text-zinc-500">
                No AI grade yet — it&apos;s generated the first time this batch is
                opened and can take a few seconds.
              </p>
            ))}
          {tab === "variables" &&
            (Object.keys(variables).length > 0 ? (
              <KeyValueList entries={Object.entries(variables)} />
            ) : (
              <p className="text-sm text-zinc-500">No dynamic variables available.</p>
            ))}
          {tab === "raw" && (
            <pre className="text-xs font-mono whitespace-pre-wrap break-words text-zinc-700 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-900 rounded-lg p-4 overflow-x-auto">
              {JSON.stringify(run, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
