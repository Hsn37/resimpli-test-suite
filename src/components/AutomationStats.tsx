"use client";

import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { useWorkspace } from "@/components/WorkspaceProvider";

const STATS_ROUTE = "/api/dashboard/stats";
const CARD = "rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950";

interface Stats {
  automationEnabled: boolean;
  lastTickAt: number | null;
  ungradedCount: number;
}

// Human "3 min ago" style label for the last tick, plus the absolute time on
// hover via the title attribute. Returns "Never" when the cron hasn't run yet.
function formatLastTick(ms: number | null): { label: string; title: string } {
  if (!ms) return { label: "Never", title: "No tick recorded yet" };
  const diff = Date.now() - ms;
  const mins = Math.round(diff / 60000);
  let label: string;
  if (mins < 1) label = "Just now";
  else if (mins < 60) label = `${mins} min ago`;
  else if (mins < 1440) label = `${Math.round(mins / 60)} h ago`;
  else label = `${Math.round(mins / 1440)} d ago`;
  return { label, title: new Date(ms).toLocaleString() };
}

/**
 * Small admin-only automation status panel shown under the Retell backfill
 * section: automation on/off, when the cron tick last ran, and how many calls
 * are still pending a grade. Re-fetches when the workspace switches.
 */
export default function AutomationStats() {
  const { workspace } = useWorkspace();
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState(false);

  // AppShell remounts the whole page subtree on workspace switch (main is
  // keyed by workspace), so this runs fresh per workspace — no manual reset.
  useEffect(() => {
    let cancelled = false;
    fetch(STATS_ROUTE)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (!cancelled) setStats(d);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [workspace]);

  const tick = formatLastTick(stats?.lastTickAt ?? null);

  return (
    <div className={CARD}>
      <div className="flex items-center gap-2 p-4 pb-3 text-base font-semibold">
        <Activity size={16} className="text-zinc-500" />
        Stats
      </div>
      {error ? (
        <p className="px-4 pb-4 text-xs text-zinc-500">Couldn&apos;t load stats.</p>
      ) : (
        <div className="grid grid-cols-3 gap-3 px-4 pb-4">
          <Stat label="Automation">
            {stats == null ? (
              <Placeholder />
            ) : (
              <span className={stats.automationEnabled ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-500"}>
                {stats.automationEnabled ? "On" : "Off"}
              </span>
            )}
          </Stat>
          <Stat label="Last run">
            {stats == null ? <Placeholder /> : <span title={tick.title}>{tick.label}</span>}
          </Stat>
          <Stat label="Ungraded calls">
            {stats == null ? <Placeholder /> : <span>{stats.ungradedCount}</span>}
          </Stat>
        </div>
      )}
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-zinc-500 mb-1">{label}</div>
      <div className="text-sm font-medium">{children}</div>
    </div>
  );
}

function Placeholder() {
  return <span className="inline-block h-4 w-12 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />;
}
