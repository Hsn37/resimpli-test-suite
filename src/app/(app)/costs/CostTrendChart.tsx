"use client";

import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { CHART_AXIS, CHART_GRID } from "@/lib/dashboard";
import {
  COST_GRANULARITIES,
  WORKSPACE_COLOR_VAR,
  fmtInt,
  fmtUsd,
  workspaceLabel,
  type CostGranularity,
  type CostTrendPoint,
} from "@/lib/costs";
import type { Workspace } from "@/lib/workspace";

const TAB_ACTIVE = "bg-blue-600 text-white";
const TAB_IDLE = "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900";

interface Props {
  points: CostTrendPoint[];
  workspaces: readonly Workspace[];
  granularity: CostGranularity;
  onGranularity: (g: CostGranularity) => void;
}

type Datum = { label: string; total: number; calls: number } & Partial<Record<Workspace, number>>;

// Spend over time, stacked by workspace. Values are plotted in dollars; the
// tooltip lists each workspace's share plus the bucket total and call count.
export default function CostTrendChart({ points, workspaces, granularity, onGranularity }: Props) {
  const data = useMemo<Datum[]>(
    () =>
      points.map((p) => {
        const d: Datum = { label: p.label, total: p.total / 100, calls: p.calls };
        for (const ws of workspaces) d[ws] = (p.byWorkspace[ws] ?? 0) / 100;
        return d;
      }),
    [points, workspaces]
  );
  const hasData = points.some((p) => p.total > 0);
  const stacked = workspaces.length > 1;

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
      <div className="flex flex-wrap items-center justify-between gap-2 p-4 pb-2">
        <h2 className="text-base font-semibold">Spend over time</h2>
        <div className="flex items-center gap-1">
          {COST_GRANULARITIES.map((g) => (
            <button
              key={g}
              onClick={() => onGranularity(g)}
              aria-pressed={granularity === g}
              className={`text-xs font-medium px-2.5 py-1 rounded-lg transition-colors capitalize ${
                granularity === g ? TAB_ACTIVE : TAB_IDLE
              }`}
            >
              {g === "day" ? "Daily" : g === "week" ? "Weekly" : "Monthly"}
            </button>
          ))}
        </div>
      </div>
      {stacked && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 pb-2 text-xs text-zinc-600 dark:text-zinc-400">
          {workspaces.map((ws) => (
            <span key={ws} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: WORKSPACE_COLOR_VAR[ws] }} />
              {workspaceLabel(ws)}
            </span>
          ))}
        </div>
      )}
      <div className="px-2 pb-4">
        {!hasData ? (
          <div className="h-64 flex items-center justify-center text-xs text-zinc-500">No spend in this range.</div>
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: CHART_AXIS }}
                  tickLine={false}
                  interval="preserveStartEnd"
                  minTickGap={12}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: CHART_AXIS }}
                  tickLine={false}
                  axisLine={false}
                  width={52}
                  tickFormatter={(v: number) => fmtUsd(v * 100)}
                />
                <Tooltip
                  cursor={{ fill: "rgba(161,161,170,0.15)" }}
                  content={(props) => <TrendTooltip {...props} workspaces={workspaces} />}
                />
                {workspaces.map((ws, i) => (
                  <Bar
                    key={ws}
                    dataKey={ws}
                    stackId="spend"
                    fill={WORKSPACE_COLOR_VAR[ws]}
                    stroke="var(--background)"
                    strokeWidth={stacked ? 1 : 0}
                    radius={i === workspaces.length - 1 ? [4, 4, 0, 0] : 0}
                    maxBarSize={48}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

function TrendTooltip({
  active,
  payload,
  label,
  workspaces,
}: {
  active?: boolean;
  payload?: readonly { payload?: unknown }[];
  label?: string | number;
  workspaces: readonly Workspace[];
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as Datum;
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-xs shadow-sm">
      <div className="font-medium mb-1">{label}</div>
      {workspaces.length > 1 &&
        [...workspaces].reverse().map((ws) => (
          <div key={ws} className="flex items-center justify-between gap-4">
            <span className="inline-flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
              <span className="h-2 w-2 rounded-sm" style={{ background: WORKSPACE_COLOR_VAR[ws] }} />
              {workspaceLabel(ws)}
            </span>
            <span className="tabular-nums">{fmtUsd((d[ws] ?? 0) * 100)}</span>
          </div>
        ))}
      <div className="flex items-center justify-between gap-4 mt-1 pt-1 border-t border-zinc-200 dark:border-zinc-700 font-medium">
        <span>Total</span>
        <span className="tabular-nums">{fmtUsd(d.total * 100)}</span>
      </div>
      <div className="text-zinc-500 mt-0.5">{fmtInt(d.calls)} calls</div>
    </div>
  );
}
