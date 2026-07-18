"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Download,
} from "lucide-react";
import { ToastProvider } from "@/components/Toast";
import Skeleton from "@/components/Skeleton";
import AudioPlayer from "@/components/AudioPlayer";
import {
  fmtDateTime,
  fmtDuration,
  gradeBand,
  gradeBandClasses,
  GOOD_TEXT,
  BAD_TEXT,
  CALLOUT_TEXT,
  CALLOUT_CARD,
} from "@/lib/dashboard";

const CARD = "rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950";
const BADGE = "inline-flex items-center rounded-md px-2 py-0.5 text-sm font-semibold";

type ResultEntry = { applicable: boolean; passed: boolean; evidence: string };
type ScorecardEntry = { applicable: boolean; score: number | null; evidence: string };
type TranscriptTurn = { turn: number; role: string; content: string };

interface CallDetail {
  id: string;
  retell_call_id: string;
  timestamp: number | null;
  duration_seconds: number | null;
  phone_number: string | null;
  agent_id: string | null;
  agent_version: string | null;
  transcript: unknown;
  dynamic_variables: Record<string, unknown> | null;
  recording_url: string | null;
  call_grades: {
    grade: number | null;
    applicable_count: number;
    passed_count: number;
    results: Record<string, ResultEntry>;
    ai_callout: boolean;
    ai_callout_quote: string | null;
    rep_score: number | null;
    rep_scorecard: Record<string, ScorecardEntry>;
    model: string | null;
    error: string | null;
  } | null;
}

interface RubricRow {
  key: string;
  name: string;
}

// Retell transcript turns don't carry a `turn` field — fall back to 1-based
// index (same convention as the grader's formatTranscript / evidence tokens).
function normalizeTranscript(raw: unknown): TranscriptTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((t, i) => {
    const obj = (t ?? {}) as { turn?: unknown; role?: unknown; content?: unknown };
    return {
      turn: typeof obj.turn === "number" ? obj.turn : i + 1,
      role: String(obj.role ?? "unknown"),
      content: String(obj.content ?? ""),
    };
  });
}

function extractTurn(evidence?: string): number | null {
  if (!evidence) return null;
  const m = evidence.match(/\[(\d+)\]/);
  return m ? parseInt(m[1], 10) : null;
}

function splitVars(dv: Record<string, unknown> | null) {
  const prefilled: Record<string, unknown> = {};
  const empty: string[] = [];
  for (const [k, v] of Object.entries(dv ?? {})) {
    if (v == null) {
      empty.push(k);
      continue;
    }
    if (typeof v === "string") {
      const t = v.trim().toLowerCase();
      if (!t || ["unknown", "n/a", "none", "null"].includes(t)) {
        empty.push(k);
        continue;
      }
    }
    prefilled[k] = v;
  }
  return { prefilled, empty };
}

function CallDetailContent({ id }: { id: string }) {
  const [call, setCall] = useState<CallDetail | null>(null);
  const [failureClasses, setFailureClasses] = useState<RubricRow[]>([]);
  const [repDimensions, setRepDimensions] = useState<RubricRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [highlightTurn, setHighlightTurn] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/dashboard/calls/${id}`).then((r) => {
        if (r.status === 404) throw new Error("not_found");
        if (!r.ok) throw new Error("load_failed");
        return r.json();
      }),
      fetch("/api/dashboard/rubric").then((r) => (r.ok ? r.json() : { failureClasses: [], repDimensions: [] })),
    ])
      .then(([c, rubric]) => {
        if (cancelled) return;
        setCall(c);
        setFailureClasses(rubric.failureClasses ?? []);
        setRepDimensions(rubric.repDimensions ?? []);
      })
      .catch((e: Error) => {
        if (!cancelled && e.message === "not_found") setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const transcript = useMemo(() => normalizeTranscript(call?.transcript), [call?.transcript]);
  const { prefilled, empty } = useMemo(() => splitVars(call?.dynamic_variables ?? null), [call?.dynamic_variables]);

  if (loading) {
    return (
      <div className="space-y-4 max-w-6xl mx-auto">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (notFound || !call) {
    return (
      <div className="max-w-6xl mx-auto">
        <Link href="/dashboard" className="text-sm text-zinc-500 hover:text-zinc-700 inline-flex items-center gap-1">
          <ArrowLeft size={16} /> Dashboard
        </Link>
        <div className="text-sm text-red-600 dark:text-red-400 mt-4">Call not found.</div>
      </div>
    );
  }

  const grade = call.call_grades?.grade ?? null;
  const rep = call.call_grades?.rep_score ?? null;

  function handleDownload() {
    if (!call) return;
    const blob = new Blob([JSON.stringify(call, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `call_${call.retell_call_id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/dashboard" className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 inline-flex items-center gap-1">
          <ArrowLeft size={16} /> Dashboard
        </Link>
        <div className="flex items-center gap-3">
          <div className="text-xs text-zinc-500 font-mono">{call.retell_call_id}</div>
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 text-sm border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
          >
            <Download size={14} /> Download JSON
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-6">
        <Stat label="When" value={call.timestamp == null ? "—" : fmtDateTime(call.timestamp)} />
        <Stat label="Duration" value={fmtDuration(call.duration_seconds)} />
        <Stat label="Agent version" value={call.agent_version ?? "—"} />
        <Stat
          label="Grade"
          value={
            <span className={`${BADGE} ${gradeBandClasses(gradeBand(grade))}`}>
              {grade == null ? "n/a" : `${Math.round(grade)}`}
              {grade != null && <span className="text-xs opacity-70 ml-0.5">/100</span>}
            </span>
          }
        />
        <Stat
          label="Rep score"
          value={
            <span className={`${BADGE} ${gradeBandClasses(gradeBand(rep))}`}>
              {rep == null ? "n/a" : `${Math.round(rep)}`}
              {rep != null && <span className="text-xs opacity-70 ml-0.5">/100</span>}
            </span>
          }
        />
        <Stat label="Phone" value={call.phone_number ?? "—"} />
      </div>

      {call.recording_url && (
        <div className={`${CARD} p-3`}>
          <AudioPlayer src={call.recording_url} />
        </div>
      )}

      {call.call_grades?.ai_callout && (
        <div className={`${CARD} ${CALLOUT_CARD}`}>
          <div className={`p-4 pb-2 text-sm font-semibold flex items-center gap-1.5 ${CALLOUT_TEXT}`}>
            <AlertTriangle size={16} /> AI callout detected
          </div>
          <div className="px-4 pb-4 text-sm">
            {call.call_grades.ai_callout_quote || "Caller indicated suspicion of AI."}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Grading results */}
        <div className={CARD}>
          <div className="p-4 pb-3 text-base font-semibold">
            Grading results{" "}
            <span className="text-xs font-normal text-zinc-500 ml-1">
              {call.call_grades
                ? `${call.call_grades.passed_count}/${call.call_grades.applicable_count} applicable passed`
                : "not graded"}
            </span>
          </div>
          <div className="px-4 pb-4 space-y-2">
            {call.call_grades?.error && (
              <div className="text-sm text-red-600 dark:text-red-400">Grader error: {call.call_grades.error}</div>
            )}
            {failureClasses.map((cls) => (
              <ClassResultRow
                key={cls.key}
                name={cls.name}
                result={call.call_grades?.results?.[cls.key]}
                onHover={setHighlightTurn}
              />
            ))}
            {failureClasses.length === 0 && <div className="text-sm text-zinc-500">No failure classes configured.</div>}
          </div>
        </div>

        {/* Transcript */}
        <div className={CARD}>
          <div className="p-4 pb-3 text-base font-semibold">Transcript</div>
          <div className="px-4 pb-4 max-h-[600px] overflow-y-auto space-y-1.5">
            {transcript.map((t) => (
              <div
                key={t.turn}
                id={`turn-${t.turn}`}
                className={`rounded-md border p-2.5 text-sm transition-colors ${
                  highlightTurn === t.turn
                    ? "border-blue-500 bg-blue-50/60 dark:bg-blue-950/30"
                    : "border-zinc-200 dark:border-zinc-800"
                } ${t.role === "agent" ? "bg-zinc-50 dark:bg-zinc-900/40" : ""}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-mono text-zinc-500">[{t.turn}]</span>
                  <span className="text-xs font-medium capitalize">{t.role}</span>
                </div>
                <div className="text-sm leading-relaxed">{t.content}</div>
              </div>
            ))}
            {transcript.length === 0 && <div className="text-sm text-zinc-500">No transcript.</div>}
          </div>
        </div>
      </div>

      {/* Rep scorecard */}
      <div className={CARD}>
        <div className="p-4 pb-3 text-base font-semibold">
          Rep scorecard{" "}
          <span className="text-xs font-normal text-zinc-500 ml-1">
            {rep != null ? `avg ${Math.round(rep)}/100` : "not graded"}
          </span>
        </div>
        <div className="px-4 pb-4 grid grid-cols-1 gap-2 md:grid-cols-2">
          {repDimensions.map((d) => {
            const entry = call.call_grades?.rep_scorecard?.[d.key];
            const applicable = entry?.applicable ?? false;
            const score = entry?.score ?? null;
            return (
              <div key={d.key} className="rounded-md border border-zinc-200 dark:border-zinc-800 p-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{d.name}</span>
                  {applicable && score != null ? (
                    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums ${gradeBandClasses(gradeBand(score))}`}>
                      {score}
                    </span>
                  ) : (
                    <span className="text-xs text-zinc-500">n/a</span>
                  )}
                </div>
                {entry?.evidence && <div className="mt-1.5 text-xs text-zinc-500 italic">&ldquo;{entry.evidence}&rdquo;</div>}
              </div>
            );
          })}
          {repDimensions.length === 0 && (
            <div className="text-sm text-zinc-500 md:col-span-2">No rep dimensions configured.</div>
          )}
        </div>
      </div>

      {/* Dynamic variables */}
      <div className={CARD}>
        <div className="p-4 pb-3 text-base font-semibold">Dynamic variables</div>
        <div className="px-4 pb-4 grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <div className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Pre-filled ({Object.keys(prefilled).length})</div>
            <VarList vars={prefilled} />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Empty / unknown ({empty.length})</div>
            {empty.length === 0 ? (
              <div className="text-sm text-zinc-500">None.</div>
            ) : (
              <ul className="space-y-1">
                {empty.map((k) => (
                  <li key={k} className="text-sm font-mono">{k}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="text-sm font-medium mt-0.5">{value}</div>
    </div>
  );
}

function VarList({ vars }: { vars: Record<string, unknown> }) {
  const entries = Object.entries(vars);
  if (entries.length === 0) return <div className="text-sm text-zinc-500">None.</div>;
  return (
    <ul className="space-y-1">
      {entries.map(([k, v]) => (
        <li key={k} className="text-sm flex gap-2">
          <span className="font-mono text-zinc-500">{k}:</span>
          <span className="font-medium truncate">{typeof v === "string" ? v : JSON.stringify(v)}</span>
        </li>
      ))}
    </ul>
  );
}

function ClassResultRow({
  name,
  result,
  onHover,
}: {
  name: string;
  result?: ResultEntry;
  onHover: (turn: number | null) => void;
}) {
  const turnRef = useMemo(() => extractTurn(result?.evidence), [result?.evidence]);
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
        <button
          type="button"
          className="mt-1.5 text-xs text-zinc-500 text-left hover:text-zinc-800 dark:hover:text-zinc-200 w-full"
          onMouseEnter={() => onHover(turnRef)}
          onMouseLeave={() => onHover(null)}
          onClick={() => {
            if (turnRef != null) {
              document.getElementById(`turn-${turnRef}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
            }
          }}
        >
          <span className="italic">&ldquo;{result.evidence}&rdquo;</span>
        </button>
      )}
    </div>
  );
}

export default function CallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <ToastProvider>
      <div className="p-6 md:p-8">
        <CallDetailContent id={id} />
      </div>
    </ToastProvider>
  );
}
