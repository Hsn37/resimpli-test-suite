"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, FlaskConical, Loader2 } from "lucide-react";
import { ToastProvider, useToast } from "@/components/Toast";
import TestRunDetailModal, { type TestRun } from "@/components/TestRunDetailModal";
import Stars from "@/components/Stars";
import Skeleton from "@/components/Skeleton";
import { downloadCsvObjects } from "@/lib/downloadRecording";

const TERMINAL_RUN_STATUSES = new Set(["pass", "fail", "error"]);

const CSV_COLUMNS = [
  "name",
  "status",
  "result_explanation",
  "dynamic_variables",
  "test_case_job_id",
  "transcript",
];

function transcriptText(run: TestRun): string {
  const turns = run.transcript_snapshot?.transcript ?? [];
  return turns
    .filter((t) => t.role === "agent" || t.role === "user")
    .map((t) => `${t.role}: ${t.content}`)
    .join("\n");
}

function runsToCsvRows(runs: TestRun[]): Record<string, string>[] {
  return runs.map((run) => ({
    name: run.test_case_definition_snapshot?.name ?? "",
    status: run.status ?? "",
    result_explanation: run.result_explanation ?? "",
    dynamic_variables: JSON.stringify(run.transcript_snapshot?.dynamicVariables ?? {}),
    test_case_job_id: run.test_case_job_id ?? "",
    transcript: transcriptText(run),
  }));
}

interface BatchStatus {
  test_case_batch_job_id?: string;
  status?: string;
  pass_count?: number;
  fail_count?: number;
  error_count?: number;
  total_count?: number;
}

const TERMINAL_STATUSES = new Set(["complete", "completed", "done", "failed", "error"]);

const STATUS_STYLES: Record<string, string> = {
  complete: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
  completed: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
  in_progress: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
  pending: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  error: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  failed: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
};

const RUN_STATUS_STYLES: Record<string, string> = {
  pass: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
  fail: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  error: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  pending: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  in_progress: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
};

function StatTile({
  label,
  value,
  valueClass = "text-zinc-900 dark:text-zinc-100",
}: {
  label: string;
  value: React.ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div className={`text-xl font-semibold tabular-nums mt-0.5 ${valueClass}`}>{value}</div>
    </div>
  );
}

function SkeletonRunRow() {
  return (
    <tr className="border-b border-zinc-100 dark:border-zinc-900 last:border-0">
      <td className="py-3 pl-4 pr-3 w-20">
        <Skeleton className="h-4 w-full" />
      </td>
      <td className="py-3 px-3">
        <Skeleton className="h-4 w-4/5" />
      </td>
      <td className="py-3 px-3 w-20">
        <Skeleton className="h-4 w-3/4" />
      </td>
      <td className="py-3 px-3 w-36">
        <Skeleton className="h-4 w-full" />
      </td>
      <td className="py-3 px-3 pr-4 w-44">
        <Skeleton className="h-4 w-full" />
      </td>
    </tr>
  );
}

function BatchTestDetailContent({ id }: { id: string }) {
  const [batch, setBatch] = useState<BatchStatus | null>(null);
  const [testRuns, setTestRuns] = useState<TestRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewingRun, setViewingRun] = useState<TestRun | null>(null);
  const { toast } = useToast();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`/api/batch-tests/${id}`);
        if (!res.ok) throw new Error("Failed to fetch batch test");
        const data = await res.json();
        if (cancelled) return;
        setBatch(data.batch);
        setTestRuns(data.test_runs ?? []);

        const status = (data.batch?.status ?? "").toLowerCase();
        if (TERMINAL_STATUSES.has(status) && intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to fetch batch test";
        toast(message, "error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    poll();
    intervalRef.current = setInterval(poll, 4000);

    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const status = (batch?.status ?? "").toLowerCase();
  const statusClass = STATUS_STYLES[status] ?? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
  const showSkeleton = loading && !batch;

  return (
    <div className="max-w-4xl mx-auto p-8">
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/batch-tests"
          className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
        >
          <ArrowLeft size={18} />
        </Link>
        <h1 className="font-semibold text-lg flex items-center gap-2 flex-1">
          <FlaskConical size={18} />
          Batch Test Run
        </h1>
        <button
          onClick={() =>
            downloadCsvObjects(runsToCsvRows(testRuns), CSV_COLUMNS, `batch-test-${id}.csv`)
          }
          disabled={testRuns.length === 0}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors disabled:opacity-0 disabled:pointer-events-none"
        >
          <Download size={13} />
          Download CSV
        </button>
        <span
          className={`text-xs font-semibold uppercase tracking-wide px-2 py-1 rounded-full min-w-[72px] text-center ${
            batch?.status ? statusClass : "invisible"
          }`}
        >
          {batch?.status ?? "—"}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-6">
        {showSkeleton ? (
          Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="rounded-lg border border-zinc-200 dark:border-zinc-800 px-4 py-3">
              <Skeleton className="h-3 w-14 mb-2" />
              <Skeleton className="h-6 w-10" />
            </div>
          ))
        ) : (
          <>
            <StatTile
              label="Passed"
              value={batch?.pass_count ?? 0}
              valueClass="text-green-600 dark:text-green-400"
            />
            <StatTile
              label="Failed"
              value={batch?.fail_count ?? 0}
              valueClass="text-red-600 dark:text-red-400"
            />
            <StatTile
              label="Errors"
              value={batch?.error_count ?? 0}
              valueClass="text-amber-600 dark:text-amber-400"
            />
            <StatTile label="Total" value={batch?.total_count ?? testRuns.length} />
          </>
        )}
      </div>

      {!showSkeleton && !TERMINAL_STATUSES.has(status) && (
        <div className="flex items-center gap-1.5 text-xs text-zinc-400 mb-4 -mt-2">
          <Loader2 className="animate-spin" size={12} />
          Running...
        </div>
      )}

      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        <table className="w-full text-sm border-collapse table-fixed">
          <colgroup>
            <col className="w-20" />
            <col />
            <col className="w-20" />
            <col className="w-36" />
            <col className="w-44" />
          </colgroup>
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 text-left text-xs uppercase tracking-wide text-zinc-500">
              <th className="py-2.5 pl-4 pr-3 font-medium">Status</th>
              <th className="py-2.5 px-3 font-medium">Test Case</th>
              <th className="py-2.5 px-3 font-medium">AI Grade</th>
              <th className="py-2.5 px-3 font-medium">AI Note</th>
              <th className="py-2.5 px-3 pr-4 font-medium">Result</th>
            </tr>
          </thead>
          <tbody>
            {showSkeleton ? (
              Array.from({ length: 8 }, (_, i) => <SkeletonRunRow key={i} />)
            ) : testRuns.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-10 text-zinc-500 text-sm">
                  No test runs yet.
                </td>
              </tr>
            ) : (
              testRuns.map((run) => {
                const runStatus = (run.status ?? "").toLowerCase();
                const runStatusClass =
                  RUN_STATUS_STYLES[runStatus] ??
                  "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
                return (
                  <tr
                    key={run.test_case_job_id}
                    onClick={() => setViewingRun(run)}
                    className="border-b border-zinc-100 dark:border-zinc-900 last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors cursor-pointer"
                  >
                    <td className="py-3 pl-4 pr-3">
                      <span
                        className={`inline-block text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full whitespace-nowrap ${runStatusClass}`}
                      >
                        {run.status ?? "unknown"}
                      </span>
                    </td>
                    <td className="py-3 px-3 min-w-0">
                      <span className="text-sm font-medium truncate block">
                        {run.test_case_definition_snapshot?.name ?? "Test case"}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      {run.ai_grade ? (
                        <Stars
                          value={run.ai_grade.score}
                          size={12}
                          filledClass="fill-purple-500 text-purple-500"
                          emptyClass="text-zinc-200 dark:text-zinc-700"
                        />
                      ) : TERMINAL_RUN_STATUSES.has(runStatus) ? (
                        <span className="text-[10px] text-zinc-400 flex items-center gap-1">
                          <Loader2 className="animate-spin" size={10} />
                          grading
                        </span>
                      ) : (
                        <span className="text-zinc-300 dark:text-zinc-700">—</span>
                      )}
                    </td>
                    <td className="py-3 px-3 min-w-0">
                      {run.ai_grade?.note && (
                        <span
                          title={run.ai_grade.note}
                          className="block truncate text-xs text-zinc-500"
                        >
                          {run.ai_grade.note}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 pr-4 min-w-0">
                      <span
                        title={run.result_explanation ?? ""}
                        className="block truncate text-xs text-zinc-500"
                      >
                        {run.result_explanation ?? ""}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {viewingRun && (
        <TestRunDetailModal run={viewingRun} onClose={() => setViewingRun(null)} />
      )}
    </div>
  );
}

export default function BatchTestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <ToastProvider>
      <BatchTestDetailContent id={id} />
    </ToastProvider>
  );
}
