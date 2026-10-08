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
  fmtInt,
  fmtUsd,
  type ChartSeries,
  type CostGranularity,
  type CostTrendPoint,
} from "@/lib/costs";

const TAB_ACTIVE = "bg-blue-600 text-white";
const TAB_IDLE = "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900";

interface Props {
  points: CostTrendPoint[];
  series: readonly ChartSeries[];
  granularity: CostGranularity;
  onGranularity: (g: CostGranularity) => void;
  countNoun?: string; // what CostTrendPoint.count counts, for the tooltip
  note?: string; // small caption under the legend
}

// Series values live under `s:<key>` so a series key can never collide with
// the label/total/count fields.
type Datum = { label: string; total: number; count: number } & Record<string, number | string>;
const field = (key: string) => `s:${key}`;

// Spend over time, stacked by series (workspaces, OpenAI projects…). Values
// are plotted in dollars; the tooltip lists each series plus the bucket total.
export default function SpendChart({ points, series, granularity, onGranularity, countNoun = "calls", note }: Props) {
  const data = useMemo<Datum[]>(
    () =>
      points.map((p) => {
        const d: Datum = { label: p.label, total: p.total / 100, count: p.count };
        for (const s of series) d[field(s.key)] = (p.bySeries[s.key] ?? 0) / 100;
        return d;
      }),
    [points, series]
  );
  const hasData = points.some((p) => p.total > 0);
  const stacked = series.length > 1;

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
          {series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      {note && <div className="px-4 pb-2 text-[11px] text-zinc-500">{note}</div>}
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
                  content={(props) => <TrendTooltip {...props} series={series} countNoun={countNoun} />}
                />
                {series.map((s, i) => (
                  <Bar
                    key={s.key}
                    dataKey={field(s.key)}
                    name={s.label}
                    stackId="spend"
                    fill={s.color}
                    stroke="var(--background)"
                    strokeWidth={stacked ? 1 : 0}
                    radius={i === series.length - 1 ? [4, 4, 0, 0] : 0}
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
  series,
  countNoun,
}: {
  active?: boolean;
  payload?: readonly { payload?: unknown }[];
  label?: string | number;
  series: readonly ChartSeries[];
  countNoun: string;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as Datum;
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-xs shadow-sm">
      <div className="font-medium mb-1">{label}</div>
      {series.length > 1 &&
        [...series].reverse().map((s) => (
          <div key={s.key} className="flex items-center justify-between gap-4">
            <span className="inline-flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
              <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />
              {s.label}
            </span>
            <span className="tabular-nums">{fmtUsd(Number(d[field(s.key)] ?? 0) * 100)}</span>
          </div>
        ))}
      <div className="flex items-center justify-between gap-4 mt-1 pt-1 border-t border-zinc-200 dark:border-zinc-700 font-medium">
        <span>Total</span>
        <span className="tabular-nums">{fmtUsd(d.total * 100)}</span>
      </div>
      <div className="text-zinc-500 mt-0.5">
        {fmtInt(d.count)} {countNoun}
      </div>
    </div>
  );
}
