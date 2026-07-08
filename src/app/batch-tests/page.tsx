"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FlaskConical, Plus } from "lucide-react";
import { ToastProvider, useToast } from "@/components/Toast";
import BatchRunRow, { type BatchRunSummary } from "@/components/BatchRunRow";
import Skeleton from "@/components/Skeleton";

function SkeletonRow() {
  return (
    <tr className="border-b border-zinc-100 dark:border-zinc-900 last:border-0">
      <td className="py-3 pl-4 pr-3 w-24">
        <Skeleton className="h-4 w-16" />
      </td>
      <td className="py-3 px-3">
        <Skeleton className="h-4 w-3/5 mb-1.5" />
        <Skeleton className="h-3 w-2/5" />
      </td>
      <td className="py-3 px-3 w-20">
        <Skeleton className="h-4 w-full" />
      </td>
      <td className="py-3 px-3 w-20">
        <Skeleton className="h-4 w-full" />
      </td>
      <td className="py-3 px-3 w-20">
        <Skeleton className="h-4 w-full" />
      </td>
      <td className="py-3 px-3 w-20">
        <Skeleton className="h-4 w-full" />
      </td>
      <td className="py-3 px-3 w-40">
        <Skeleton className="h-3 w-3/4" />
      </td>
      <td className="py-3 pl-3 pr-4 w-8" />
    </tr>
  );
}

function BatchTestsContent() {
  const [runs, setRuns] = useState<BatchRunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    fetch("/api/batch-tests")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch batch test runs");
        return res.json();
      })
      .then((data: BatchRunSummary[]) => setRuns(data))
      .catch((err) => toast(err.message, "error"))
      .finally(() => setLoading(false));
  }, [toast]);

  return (
    <div className="max-w-5xl mx-auto p-8">
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/"
          className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
        >
          <ArrowLeft size={18} />
        </Link>
        <h1 className="font-semibold text-lg flex items-center gap-2 flex-1">
          <FlaskConical size={18} />
          Batch Tests
        </h1>
        <Link
          href="/batch-tests/new"
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium text-sm transition-colors"
        >
          <Plus size={15} />
          New Run
        </Link>
      </div>

      {!loading && runs.length === 0 ? (
        <div className="text-center py-16 text-zinc-500 text-sm border border-dashed border-zinc-300 dark:border-zinc-700 rounded-xl">
          No batch test runs yet.
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 text-left text-xs uppercase tracking-wide text-zinc-500">
                <th className="py-2.5 pl-4 pr-3 font-medium">Status</th>
                <th className="py-2.5 px-3 font-medium">Run</th>
                <th className="py-2.5 px-3 font-medium text-right">Pass</th>
                <th className="py-2.5 px-3 font-medium text-right">Fail</th>
                <th className="py-2.5 px-3 font-medium text-right">Error</th>
                <th className="py-2.5 px-3 font-medium text-right">Total</th>
                <th className="py-2.5 px-3 font-medium">Created</th>
                <th className="py-2.5 pl-3 pr-4 font-medium" />
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 6 }, (_, i) => <SkeletonRow key={i} />)
                : runs.map((run) => <BatchRunRow key={run.id} run={run} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function BatchTestsPage() {
  return (
    <ToastProvider>
      <BatchTestsContent />
    </ToastProvider>
  );
}
