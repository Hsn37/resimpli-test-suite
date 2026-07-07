"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";

export interface BatchRunSummary {
  id: string;
  set_name: string | null;
  agent_name: string | null;
  version: number | null;
  status: string | null;
  pass_count: number | null;
  fail_count: number | null;
  error_count: number | null;
  total_count: number | null;
  user_email: string | null;
  created_at: number | null;
}

const STATUS_STYLES: Record<string, string> = {
  complete: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
  completed: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
  in_progress: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
  pending: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  error: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  failed: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
};

export default function BatchRunRow({ run }: { run: BatchRunSummary }) {
  const statusClass =
    STATUS_STYLES[run.status ?? ""] ??
    "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";

  return (
    <tr className="border-b border-zinc-100 dark:border-zinc-900 last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors">
      <td className="py-3 pl-4 pr-3 w-24">
        <span
          className={`inline-block text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full whitespace-nowrap ${statusClass}`}
        >
          {run.status ?? "unknown"}
        </span>
      </td>
      <td className="py-3 px-3 min-w-0">
        <Link
          href={`/batch-tests/${run.id}`}
          className="font-medium text-sm truncate block hover:underline"
        >
          {run.agent_name ?? "Agent"}
          {run.version !== null && <span className="text-zinc-400 font-normal"> · v{run.version}</span>}
        </Link>
        <div className="text-xs text-zinc-500 mt-0.5 truncate">
          {run.set_name ?? "Test set"}
          {run.user_email && <span> · {run.user_email}</span>}
        </div>
      </td>
      <td className="py-3 px-3 w-20 text-right tabular-nums text-sm text-green-600 dark:text-green-400 font-medium">
        {run.pass_count ?? 0}
      </td>
      <td className="py-3 px-3 w-20 text-right tabular-nums text-sm text-red-600 dark:text-red-400 font-medium">
        {run.fail_count ?? 0}
      </td>
      <td className="py-3 px-3 w-20 text-right tabular-nums text-sm text-amber-600 dark:text-amber-400 font-medium">
        {run.error_count ?? 0}
      </td>
      <td className="py-3 px-3 w-20 text-right tabular-nums text-sm text-zinc-400">
        / {run.total_count ?? 0}
      </td>
      <td className="py-3 px-3 w-40 text-xs text-zinc-400 whitespace-nowrap">
        {run.created_at ? new Date(run.created_at).toLocaleString() : ""}
      </td>
      <td className="py-3 pl-3 pr-4 w-8">
        <Link href={`/batch-tests/${run.id}`}>
          <ChevronRight size={15} className="text-zinc-300" />
        </Link>
      </td>
    </tr>
  );
}
