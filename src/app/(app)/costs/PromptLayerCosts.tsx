"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CalendarRange, Database, Info, Layers3 } from "lucide-react";
import SpendChart from "./SpendChart";
import {
  buildCostTrend,
  fmtDayRange,
  fmtInt,
  fmtUsd,
  type ChartSeries,
  type CostGranularity,
  type DayRange,
  type PromptLayerCostReport,
} from "@/lib/costs";

const CARD = "rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950";
const TH = "py-2.5 px-3 font-medium text-left whitespace-nowrap";
const TH_R = "py-2.5 px-3 font-medium text-right whitespace-nowrap";
const TD = "py-2.5 px-3";
const TD_R = "py-2.5 px-3 text-right tabular-nums whitespace-nowrap";
const PREVIEW = 10;

const SERIES: ChartSeries[] = [
  { key: "promptlayer-stage", label: "PromptLayer · Stage", color: "var(--series-1)" },
];

function fmtCompact(value: number): string {
  return value.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });
}

function fmtTinyUsd(cents: number | null): string {
  if (cents == null) return "—";
  const dollars = cents / 100;
  if (dollars === 0) return "$0.00";
  if (dollars < 0.01) return `$${dollars.toFixed(4)}`;
  return fmtUsd(cents, { precise: true });
}

interface Props {
  report: PromptLayerCostReport;
  range: DayRange;
  granularity: CostGranularity;
  onGranularity: (value: CostGranularity) => void;
  onShowRange: (range: DayRange) => void;
}

export default function PromptLayerCosts({ report, range, granularity, onGranularity, onShowRange }: Props) {
  const [promptLimit, setPromptLimit] = useState(PREVIEW);
  const [templateLimit, setTemplateLimit] = useState(PREVIEW);

  const trend = useMemo(
    () =>
      buildCostTrend(
        report.daily.map((row) => ({
          day: row.day,
          series: "promptlayer-stage",
          cents: row.cents,
          count: row.requests,
        })),
        range,
        granularity,
        ["promptlayer-stage"]
      ),
    [report.daily, range, granularity]
  );

  const observedTemplates = new Map(report.prompts.map((row) => [row.templateId, row]));
  const linkedRequests = report.prompts
    .filter((row) => row.templateId !== "none")
    .reduce((sum, row) => sum + row.requests, 0);
  const cachedShare = report.inputTokens ? Math.round((report.cachedTokens / report.inputTokens) * 100) : 0;

  return (
    <div className="space-y-5">
      <section className={`${CARD} overflow-hidden`} aria-labelledby="promptlayer-coverage-title">
        <div className="grid md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="p-5">
            <div className="flex items-center gap-2">
              <Database size={17} className="text-blue-600" />
              <h2 id="promptlayer-coverage-title" className="font-semibold">
                Observed stage activity
              </h2>
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                Partial coverage
              </span>
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              These dollars and tokens are exact for calls recorded by the stage PromptLayer workspace. Direct backend
              OpenAI calls are not automatically included, so this is an observed subtotal—not the organization invoice.
            </p>
          </div>
          <div className="border-t border-zinc-200 px-5 py-4 text-xs text-zinc-500 dark:border-zinc-800 md:border-l md:border-t-0 md:min-w-64">
            <div className="font-medium text-zinc-800 dark:text-zinc-200">Coverage window</div>
            <div className="mt-1 tabular-nums">
              {fmtDayRange({ from: report.observedFromDay, to: report.toDay })}
            </div>
            <div className="mt-1">{fmtInt(linkedRequests)} requests linked to a named prompt</div>
          </div>
        </div>
        {report.warning && (
          <div className="flex items-start gap-2 border-t border-amber-200 bg-amber-50 px-5 py-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>{report.warning}</span>
          </div>
        )}
      </section>

      {report.requests === 0 && report.history && (
        <section className={`${CARD} flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between`}>
          <div>
            <h2 className="font-semibold">No observed PromptLayer cost in this date range</h2>
            <p className="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              The available workspace history contains <strong>{fmtUsd(report.history.cents)}</strong> across{" "}
              <strong>{fmtInt(report.history.requests)} requests</strong> from{" "}
              {fmtDayRange({ from: report.history.fromDay, to: report.history.toDay })}.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onShowRange({ from: report.history!.fromDay, to: report.history!.toDay })}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-950"
          >
            <CalendarRange size={15} /> Show observed history
          </button>
        </section>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Kpi title="Observed spend" value={fmtUsd(report.cents)} sub="PromptLayer-calculated price" />
        <Kpi title="Logged requests" value={fmtCompact(report.requests)} sub={`${fmtInt(report.prompts.length)} prompt groups`} />
        <Kpi title="Input tokens" value={fmtCompact(report.inputTokens)} sub={`${cachedShare}% cached`} />
        <Kpi title="Output tokens" value={fmtCompact(report.outputTokens)} sub={`${fmtCompact(report.thinkingTokens)} thinking`} />
        <Kpi
          title="Cost / 1K requests"
          value={report.requests ? fmtUsd((report.cents / report.requests) * 1000, { precise: true }) : "—"}
          sub="Observed spend ÷ requests"
        />
      </div>

      <SpendChart
        points={trend}
        series={SERIES}
        granularity={granularity}
        onGranularity={onGranularity}
        countNoun="logged requests"
        note="PromptLayer analytics use UTC days. Zeroes outside the coverage window do not mean zero OpenAI usage."
      />

      <div className="grid gap-5 xl:grid-cols-5">
        <section className={`${CARD} overflow-hidden xl:col-span-3`} aria-labelledby="prompt-cost-title">
          <div className="p-4 pb-3">
            <h2 id="prompt-cost-title" className="text-base font-semibold">
              Observed by prompt
            </h2>
            <p className="mt-1 text-xs text-zinc-500">Exact PromptLayer totals within the selected window.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800">
                <tr>
                  <th className={TH}>Prompt</th>
                  <th className={TH_R}>Requests</th>
                  <th className={TH_R}>Avg tokens</th>
                  <th className={TH_R}>Avg / request</th>
                  <th className={TH_R}>Spend</th>
                </tr>
              </thead>
              <tbody>
                {report.prompts.slice(0, promptLimit).map((row) => (
                  <tr key={row.templateId} className="border-b border-zinc-100 dark:border-zinc-900">
                    <td className={TD}>
                      <div className="font-medium">{row.name}</div>
                      <div className="mt-0.5 font-mono text-[11px] text-zinc-500">
                        {row.templateId === "none" ? "Unlinked request" : `Template ${row.templateId}`}
                      </div>
                    </td>
                    <td className={TD_R}>{fmtInt(row.requests)}</td>
                    <td className={TD_R}>{row.requests ? fmtCompact(row.tokens / row.requests) : "—"}</td>
                    <td className={TD_R}>{row.requests ? fmtTinyUsd(row.cents / row.requests) : "—"}</td>
                    <td className={`${TD_R} font-medium`}>{fmtUsd(row.cents)}</td>
                  </tr>
                ))}
                {report.prompts.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-xs text-zinc-500">
                      No PromptLayer requests were observed in this range.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <ShowMore total={report.prompts.length} limit={promptLimit} onLimit={setPromptLimit} noun="prompts" />
        </section>

        <section className={`${CARD} overflow-hidden xl:col-span-2`} aria-labelledby="model-cost-title">
          <div className="p-4 pb-3">
            <h2 id="model-cost-title" className="text-base font-semibold">
              Observed by model
            </h2>
            <p className="mt-1 text-xs text-zinc-500">Exact logged usage, including model-level token totals.</p>
          </div>
          <div className="divide-y divide-zinc-100 border-t border-zinc-200 dark:divide-zinc-900 dark:border-zinc-800">
            {report.models.map((row) => {
              const share = report.cents ? (row.cents / report.cents) * 100 : 0;
              return (
                <div key={row.model} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <code className="truncate text-xs font-medium" title={row.model}>
                      {row.model}
                    </code>
                    <span className="tabular-nums text-sm font-medium">{fmtUsd(row.cents)}</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.max(share, 0.5)}%` }} />
                  </div>
                  <div className="mt-2 flex justify-between gap-3 text-[11px] text-zinc-500">
                    <span>{fmtInt(row.requests)} requests</span>
                    <span className="tabular-nums">
                      {fmtCompact(row.inputTokens)} in · {fmtCompact(row.outputTokens)} out
                    </span>
                  </div>
                </div>
              );
            })}
            {report.models.length === 0 && <div className="p-8 text-center text-xs text-zinc-500">No model usage observed.</div>}
          </div>
        </section>
      </div>

      <section className={`${CARD} overflow-hidden`} aria-labelledby="template-estimates-title">
        <div className="flex flex-wrap items-start justify-between gap-3 p-4">
          <div>
            <div className="flex items-center gap-2">
              <Layers3 size={16} className="text-blue-600" />
              <h2 id="template-estimates-title" className="text-base font-semibold">
                Backend prompt inventory
              </h2>
            </div>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-zinc-500">
              Static instructions fetched from PromptLayer and counted with the GPT-5 tokenizer. “Input floor” excludes
              lead records, transcripts, conversation history, tool schemas, and all output tokens. Dollar floors use
              the effective stage rates observed on Oct 8, 2026.
            </p>
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-100 px-2.5 py-1.5 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
            <Info size={13} /> {fmtInt(report.templates.length)} stage templates
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-y border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800">
              <tr>
                <th className={TH}>Prompt / backend feature</th>
                <th className={TH}>Backend model</th>
                <th className={TH_R}>Static tokens</th>
                <th className={TH_R}>Output cap</th>
                <th className={TH_R}>Input floor / run</th>
                <th className={TH_R}>Observed</th>
              </tr>
            </thead>
            <tbody>
              {report.templates.slice(0, templateLimit).map((row) => {
                const observed = observedTemplates.get(row.templateId);
                return (
                  <tr key={row.templateId} className="border-b border-zinc-100 dark:border-zinc-900">
                    <td className={TD}>
                      <div className="font-medium">{row.name}</div>
                      <div className="mt-0.5 text-[11px] text-zinc-500">
                        <span className="font-mono">{row.feature}</span>
                        {row.version != null ? ` · v${row.version}` : ""}
                      </div>
                      {row.error && <div className="mt-1 text-[11px] text-red-600 dark:text-red-400">{row.error}</div>}
                    </td>
                    <td className={`${TD} font-mono text-xs`}>{row.model}</td>
                    <td className={TD_R}>{row.error ? "—" : fmtInt(row.staticInputTokens)}</td>
                    <td className={TD_R}>{fmtInt(row.maxOutputTokens)}</td>
                    <td className={`${TD_R} font-medium`}>{fmtTinyUsd(row.lowerBoundCents)}</td>
                    <td className={TD_R}>
                      {observed ? (
                        <span title={`${fmtUsd(observed.cents)} observed spend`}>
                          {fmtInt(observed.requests)} calls
                        </span>
                      ) : (
                        <span className="text-zinc-400">Not linked</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {report.templates.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-xs text-zinc-500">
                    No template estimates are cached yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <ShowMore total={report.templates.length} limit={templateLimit} onLimit={setTemplateLimit} noun="templates" />
      </section>
    </div>
  );
}

function Kpi({ title, value, sub }: { title: string; value: string; sub: React.ReactNode }) {
  return (
    <div className={`${CARD} p-4`}>
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">{title}</div>
      <div className="mt-2 text-3xl font-semibold tabular-nums">{value}</div>
      <div className="mt-2 text-xs text-zinc-500">{sub}</div>
    </div>
  );
}

function ShowMore({
  total,
  limit,
  onLimit,
  noun,
}: {
  total: number;
  limit: number;
  onLimit: (value: number) => void;
  noun: string;
}) {
  if (total <= PREVIEW) return null;
  const expanded = limit > PREVIEW;
  return (
    <div className="p-3 text-center text-sm">
      <button
        onClick={() => onLimit(expanded ? PREVIEW : total)}
        className="rounded-md px-2 py-1 text-blue-600 underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        {expanded ? "Show less" : `Show all ${fmtInt(total)} ${noun}`}
      </button>
    </div>
  );
}
