"use client";

import { useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  CartesianGrid,
} from "recharts";
import {
  buildTrendPoints,
  fmtSeconds,
  GRANULARITIES,
  GRADE_TARGET,
  CHART_PRIMARY,
  CHART_CALLOUT,
  CHART_GRID,
  CHART_AXIS,
  CHART_REF,
  type Granularity,
  type TrendGradeRow,
  type TrendDurationRow,
  type TrendPoint,
} from "@/lib/dashboard";

interface Props {
  gradeRows: TrendGradeRow[];
  durationRows: TrendDurationRow[];
  anchor: Date;
  loading: boolean;
}

interface ChartCfg {
  key: keyof TrendPoint;
  title: string;
  target?: number;
  color: string;
  fmt: (v: number) => string;
  domain: [number, number] | ["auto", "auto"];
  caption?: string;
}

const CHARTS: ChartCfg[] = [
  { key: "avgGrade", title: "Avg grade", target: GRADE_TARGET, color: CHART_PRIMARY, fmt: (v) => v.toFixed(1), domain: [0, 100] },
  { key: "pctAtTarget", title: "% ≥ 80", target: GRADE_TARGET, color: CHART_PRIMARY, fmt: (v) => `${v.toFixed(0)}%`, domain: [0, 100] },
  { key: "avgRepScore", title: "Avg rep score", target: GRADE_TARGET, color: CHART_PRIMARY, fmt: (v) => v.toFixed(1), domain: [0, 100] },
  { key: "pctAiCallout", title: "AI callout rate", color: CHART_CALLOUT, fmt: (v) => `${v.toFixed(1)}%`, domain: [0, 100] },
  {
    key: "avgDuration",
    title: "Avg call duration",
    color: CHART_PRIMARY,
    fmt: (v) => fmtSeconds(v),
    domain: ["auto", "auto"],
    caption: "Longer is generally better — seller staying on the phone.",
  },
];

const TAB_ACTIVE = "bg-blue-600 text-white";
const TAB_IDLE = "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900";

export default function TrendsChart({ gradeRows, durationRows, anchor, loading }: Props) {
  const [granularity, setGranularity] = useState<Granularity>("week");

  const points = useMemo(
    () => buildTrendPoints(gradeRows, durationRows, anchor, granularity),
    [gradeRows, durationRows, anchor, granularity]
  );

  const hasData = points.some((p) => p.avgGrade != null || p.pctAiCallout != null || p.avgDuration != null);

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
      <div className="flex flex-row items-center justify-between gap-2 p-4 pb-3">
        <h2 className="text-base font-semibold">Trends</h2>
        <div className="flex items-center gap-1 flex-wrap">
          {GRANULARITIES.map((g) => (
            <button
              key={g}
              onClick={() => setGranularity(g)}
              className={`text-xs font-medium px-2.5 py-1 rounded-lg transition-colors capitalize ${
                granularity === g ? TAB_ACTIVE : TAB_IDLE
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      </div>
      <div className="p-4 pt-0 space-y-4">
        {loading && <div className="text-xs text-zinc-500">Loading…</div>}
        {!loading && !hasData && <div className="text-xs text-zinc-500">No graded calls yet.</div>}
        {!loading &&
          hasData &&
          CHARTS.map((cfg) => (
            <div key={cfg.key as string}>
              <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 mb-1">
                {cfg.title}
              </div>
              <div className="h-32 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={points} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 10, fill: CHART_AXIS }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      domain={cfg.domain}
                      tick={{ fontSize: 10, fill: CHART_AXIS }}
                      width={40}
                      tickFormatter={cfg.key === "avgDuration" ? (v: number) => fmtSeconds(v) : undefined}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--background)",
                        border: `1px solid ${CHART_GRID}`,
                        borderRadius: 8,
                        fontSize: 12,
                        color: "var(--foreground)",
                      }}
                      formatter={(v) => cfg.fmt(Number(v))}
                    />
                    {cfg.target != null && (
                      <ReferenceLine
                        y={cfg.target}
                        stroke={CHART_REF}
                        strokeDasharray="4 4"
                        label={{
                          value: `Target ${cfg.target}`,
                          position: "insideTopRight",
                          fontSize: 10,
                          fill: CHART_AXIS,
                        }}
                      />
                    )}
                    <Line
                      type="monotone"
                      dataKey={cfg.key as string}
                      stroke={cfg.color}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {cfg.caption && <div className="text-[11px] text-zinc-500 mt-1">{cfg.caption}</div>}
            </div>
          ))}
      </div>
    </div>
  );
}
