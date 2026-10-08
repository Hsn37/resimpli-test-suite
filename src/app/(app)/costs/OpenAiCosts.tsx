"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Info, KeyRound, Loader2 } from "lucide-react";
import SpendChart from "./SpendChart";
import PromptLayerCosts from "./PromptLayerCosts";
import { BAD_TEXT, GOOD_TEXT } from "@/lib/dashboard";
import {
  OPENAI_SERIES_SLOTS,
  OTHER_SERIES_COLOR,
  OTHER_SERIES_KEY,
  SERIES_COLOR_VARS,
  buildCostTrend,
  fmtInt,
  fmtUsd,
  openAiProjectLabel,
  splitLineItem,
  type ChartSeries,
  type CostGranularity,
  type DayRange,
  type OpenAiCostReport,
  type OpenAiProjectRow,
} from "@/lib/costs";

const CARD = "rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950";
const TH = "py-2.5 px-3 font-medium text-left whitespace-nowrap";
const TH_R = "py-2.5 px-3 font-medium text-right whitespace-nowrap";
const TD = "py-2 px-3";
const TD_R = "py-2 px-3 text-right tabular-nums whitespace-nowrap";
const OVERLAY =
  "absolute inset-0 z-10 flex items-center justify-center bg-white/60 dark:bg-zinc-950/60 backdrop-blur-[1px] rounded-xl";
const KEY_PREVIEW = 10;

/** Cost of one call: sub-cent amounts in cents ("0.16¢"), the rest in dollars. */
function fmtPerCall(cents: number): string {
  return cents < 1 ? `${cents.toFixed(cents < 0.1 ? 3 : 2)}¢` : fmtUsd(cents, { precise: true });
}

/** 1234567 → "1.2M" */
function fmtCompact(v: number): string {
  return v.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });
}

interface Props {
  report: OpenAiCostReport | null;
  loading: boolean;
  error: string | null;
  range: DayRange;
  project: string | null; // null = all projects
  onProject: (projectId: string | null) => void;
  granularity: CostGranularity;
  onGranularity: (g: CostGranularity) => void;
  onShowRange: (range: DayRange) => void;
}

// The OpenAI half of the Costs Dashboard: billed spend per project ("area")
// from the Costs API, plus requests/tokens per model and API key from the
// Usage API. OpenAI reports dollars per project only, so per-key rows show
// usage, not spend.
export default function OpenAiCosts({
  report,
  loading,
  error,
  range,
  project,
  onProject,
  granularity,
  onGranularity,
  onShowRange,
}: Props) {
  // Colour slots follow ALL-TIME spend, so a project keeps its colour as the
  // timeline changes; beyond the top slots everything folds into "Other".
  const ranked = useMemo(
    () => [...(report?.projects ?? [])].sort((a, b) => b.allTimeCents - a.allTimeCents || b.cents - a.cents),
    [report]
  );
  const slotOf = useMemo(() => {
    const m = new Map<string, number>();
    ranked.slice(0, OPENAI_SERIES_SLOTS).forEach((p, i) => m.set(p.projectId, i));
    return m;
  }, [ranked]);
  const series = useMemo<ChartSeries[]>(() => {
    if (project != null) {
      const p = ranked.find((x) => x.projectId === project);
      const slot = slotOf.get(project);
      return [
        {
          key: project,
          label: p ? openAiProjectLabel(p) : project,
          color: slot != null ? SERIES_COLOR_VARS[slot] : OTHER_SERIES_COLOR,
        },
      ];
    }
    const top = ranked.slice(0, OPENAI_SERIES_SLOTS).map((p, i) => ({
      key: p.projectId,
      label: openAiProjectLabel(p),
      color: SERIES_COLOR_VARS[i],
    }));
    return ranked.length > OPENAI_SERIES_SLOTS
      ? [
          ...top,
          {
            key: OTHER_SERIES_KEY,
            label: report?.source === "backend_audit" ? "Other features" : "Other projects",
            color: OTHER_SERIES_COLOR,
          },
        ]
      : top;
  }, [ranked, slotOf, project, report?.source]);

  const trend = useMemo(() => {
    if (!report) return [];
    const rows = report.daily
      .filter((r) => project == null || r.projectId === project)
      .map((r) => ({
        day: r.day,
        series: project != null || slotOf.has(r.projectId) ? r.projectId : OTHER_SERIES_KEY,
        cents: r.cents,
        count: r.requests,
      }));
    return buildCostTrend(rows, range, granularity, series.map((s) => s.key));
  }, [report, project, range, granularity, series, slotOf]);

  const inScope = (projectId: string) => project == null || projectId === project;
  const projects = useMemo(
    () => (report?.projects ?? []).filter((p) => p.cents > 0 || p.requests > 0).sort((a, b) => b.cents - a.cents),
    [report]
  );
  const shownProjects = projects.filter((p) => inScope(p.projectId));
  const totals = shownProjects.reduce(
    (t, p) => ({
      cents: t.cents + p.cents,
      requests: t.requests + p.requests,
      input: t.input + p.inputTokens,
      cached: t.cached + p.cachedTokens,
      output: t.output + p.outputTokens,
    }),
    { cents: 0, requests: 0, input: 0, cached: 0, output: 0 }
  );
  const comp = report?.comparison;
  const compRows = (comp?.byProject ?? []).filter((r) => inScope(r.projectId));
  const comparable = compRows.reduce((s, r) => s + r.comparable, 0);
  const previous = compRows.reduce((s, r) => s + r.previous, 0);
  const delta = comp && previous > 0 ? ((comparable - previous) / previous) * 100 : null;

  // Spend by model, split into the line items' charge kinds (input, output…).
  const models = useMemo(() => {
    const m = new Map<string, { model: string; cents: number; kinds: Map<string, number> }>();
    for (const li of report?.lineItems ?? []) {
      if (project != null && li.projectId !== project) continue;
      const { model, kind } = splitLineItem(li.lineItem);
      const e = m.get(model) ?? { model, cents: 0, kinds: new Map() };
      e.cents += li.cents;
      e.kinds.set(kind, (e.kinds.get(kind) ?? 0) + li.cents);
      m.set(model, e);
    }
    return [...m.values()].filter((e) => e.cents > 0.5).sort((a, b) => b.cents - a.cents);
  }, [report, project]);

  // Usage per API key (all models folded together).
  const keys = useMemo(() => {
    const m = new Map<string, { projectId: string; apiKeyId: string; name: string | null; models: Set<string>; requests: number; input: number; output: number }>();
    for (const k of report?.keys ?? []) {
      if (project != null && k.projectId !== project) continue;
      const id = `${k.projectId}|${k.apiKeyId}`;
      const e = m.get(id) ?? { projectId: k.projectId, apiKeyId: k.apiKeyId, name: k.apiKeyName, models: new Set(), requests: 0, input: 0, output: 0 };
      if (k.model) e.models.add(k.model);
      e.requests += k.requests;
      e.input += k.inputTokens;
      e.output += k.outputTokens;
      m.set(id, e);
    }
    return [...m.values()].sort((a, b) => b.requests - a.requests);
  }, [report, project]);
  const [keyLimit, setKeyLimit] = useState(KEY_PREVIEW);
  const projectName = (id: string) => {
    const p = report?.projects.find((x) => x.projectId === id);
    return p ? openAiProjectLabel(p) : id || "No project";
  };

  if (!report) {
    return error ? (
      <div role="alert" className={`${CARD} p-4 text-sm flex items-center gap-2 ${BAD_TEXT}`}>
        <AlertTriangle size={16} /> {error}
      </div>
    ) : (
      <div className={`${CARD} h-64 flex items-center justify-center text-zinc-500`}>
        <Loader2 className="animate-spin" size={24} />
      </div>
    );
  }

  if (!report.configured) {
    return (
      <div className={`${CARD} p-5 text-sm space-y-2`}>
        <div className="flex items-center gap-2 font-semibold">
          <KeyRound size={16} /> OpenAI usage isn&rsquo;t connected yet
        </div>
        <p className="text-zinc-600 dark:text-zinc-400">
          Set <code className="text-xs">OPENAI_API_ADMIN_KEY</code> for OpenAI&rsquo;s own billing,{" "}
          <code className="text-xs">AI_AUDIT_MONGO_URL</code> for estimates from the backend&rsquo;s per-call token log, or{" "}
          <code className="text-xs">PROMPTLAYER_API_KEY</code> for observed stage usage and prompt-size estimates.
        </p>
      </div>
    );
  }

  if (report.source === "promptlayer" && report.promptLayer) {
    return (
      <div className="relative">
        {loading && (
          <div className={OVERLAY}>
            <Loader2 className="animate-spin text-zinc-400" size={28} />
          </div>
        )}
        <PromptLayerCosts
          report={report.promptLayer}
          range={range}
          granularity={granularity}
          onGranularity={onGranularity}
          onShowRange={onShowRange}
        />
      </div>
    );
  }

  // backend_audit: features stand in for projects, dollars are estimates.
  const audit = report.source === "backend_audit" ? report.audit : null;
  const isStage = !!audit && /stage|staging|dev|test/i.test(audit.database);
  const unit = audit ? { one: "feature", many: "features", Title: "Feature" } : { one: "project", many: "projects", Title: "Project" };

  return (
    <div className="relative space-y-5">
      {loading && (
        <div className={OVERLAY}>
          <Loader2 className="animate-spin text-zinc-400" size={28} />
        </div>
      )}

      {audit && (
        <div
          className={`rounded-xl border p-3 text-xs flex items-start gap-2 ${
            isStage
              ? "border-amber-300 dark:border-amber-800/60 bg-amber-50/60 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300"
              : "border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400"
          }`}
        >
          <Info size={14} className="mt-0.5 shrink-0" />
          <span>
            <strong>Estimated</strong> from the backend&rsquo;s per-call AI token log (database{" "}
            <code>{audit.database}</code>
            {isStage ? " — stage data, not production" : ""}): tokens × model rates, not OpenAI&rsquo;s invoice. Cached-input
            discounts aren&rsquo;t applied, so it leans slightly high.
            {audit.unpricedModels.length > 0 &&
              ` No rate for ${audit.unpricedModels.join(", ")} — their tokens are shown but not priced.`}
          </span>
        </div>
      )}
      {report.lastError && (
        <div role="alert" className={`${CARD} p-3 text-xs flex items-start gap-2 ${BAD_TEXT}`}>
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>Last sync failed: {report.lastError}</span>
        </div>
      )}
      {!report.earliestDay && (
        <div className={`${CARD} p-4 text-sm text-zinc-500`}>
          Nothing synced yet — the first sync runs with the next cron tick.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Kpi
          title={audit ? "Estimated AI spend" : "OpenAI spend"}
          value={fmtUsd(totals.cents)}
          sub={
            delta == null ? (
              comp ? "No spend in previous period" : "No complete days to compare"
            ) : (
              <span
                className={delta > 0 ? BAD_TEXT : GOOD_TEXT}
                title="Compares complete days only — today's OpenAI bucket is still filling."
              >
                {delta > 0 ? <ArrowUp size={11} className="inline" /> : <ArrowDown size={11} className="inline" />}{" "}
                {Math.abs(delta).toFixed(0)}% vs previous {comp!.days === 1 ? "day" : `${comp!.days} days`}
              </span>
            )
          }
        />
        <Kpi
          title={audit ? "AI calls" : "Requests"}
          value={fmtCompact(totals.requests)}
          sub={`${fmtInt(shownProjects.length)} ${shownProjects.length === 1 ? unit.one : unit.many}`}
        />
        <Kpi
          title="Input tokens"
          value={fmtCompact(totals.input)}
          sub={totals.input ? `${Math.round((totals.cached / totals.input) * 100)}% cached` : "—"}
        />
        <Kpi title="Output tokens" value={fmtCompact(totals.output)} sub="Chat & Responses APIs" />
        <Kpi
          title="Cost / 1K requests"
          value={totals.requests ? fmtUsd((totals.cents / totals.requests) * 1000, { precise: true }) : "—"}
          sub="All billed spend ÷ requests"
        />
      </div>

      <SpendChart
        points={trend}
        series={series}
        granularity={granularity}
        onGranularity={onGranularity}
        countNoun="requests"
        note={audit ? "Days are US Central." : "OpenAI reports by UTC day."}
      />

      <div className="grid gap-5 lg:grid-cols-5">
        {/* By project ("area") */}
        <div className={`${CARD} lg:col-span-3 overflow-hidden`}>
          <div className="p-4 pb-2">
            <div className="text-base font-semibold">By {unit.one}</div>
            <div className="text-xs text-zinc-500">
              {audit
                ? "Each backend AI feature (its agentType in the audit log). Click one to focus on it."
                : "Each OpenAI project is an area of spend. Click one to focus on it."}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                <tr>
                  <th className={TH}>{unit.Title}</th>
                  <th className={TH_R}>{audit ? "Calls" : "Requests"}</th>
                  <th className={TH_R}>Tokens in / out</th>
                  {audit && <th className={TH_R}>Per call</th>}
                  <th className={TH_R}>Spend</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p: OpenAiProjectRow) => {
                  const all = projects.reduce((s, x) => s + x.cents, 0);
                  const selected = project === p.projectId;
                  const slot = slotOf.get(p.projectId);
                  const toggle = () => onProject(selected ? null : p.projectId);
                  return (
                    <tr
                      key={p.projectId || "none"}
                      tabIndex={0}
                      aria-selected={selected}
                      onClick={toggle}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggle();
                        }
                      }}
                      title={selected ? `Show all ${unit.many}` : `Focus on this ${unit.one}`}
                      className={`border-b border-zinc-100 dark:border-zinc-900 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${
                        selected ? "bg-blue-50 dark:bg-blue-950/30" : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
                      } ${project != null && !selected ? "opacity-40" : ""}`}
                    >
                      <td className={TD}>
                        <span className="inline-flex items-center gap-2 font-medium">
                          <span
                            className="h-2.5 w-2.5 rounded-sm shrink-0"
                            style={{ background: slot != null ? SERIES_COLOR_VARS[slot] : OTHER_SERIES_COLOR }}
                          />
                          {openAiProjectLabel(p)}
                          {p.archived && <span className="text-[10px] uppercase text-zinc-400">archived</span>}
                        </span>
                      </td>
                      <td className={TD_R}>{fmtCompact(p.requests)}</td>
                      <td className={TD_R}>
                        {fmtCompact(p.inputTokens)} / {fmtCompact(p.outputTokens)}
                      </td>
                      {audit && (
                        <td className={TD_R}>{p.requests ? fmtPerCall(p.cents / p.requests) : "—"}</td>
                      )}
                      <td className={TD_R}>
                        <div className="font-medium">{fmtUsd(p.cents)}</div>
                        <div className="text-[11px] text-zinc-500">{all ? Math.round((p.cents / all) * 100) : 0}%</div>
                      </td>
                    </tr>
                  );
                })}
                {projects.length === 0 && (
                  <tr>
                    <td colSpan={audit ? 5 : 4} className="p-6 text-center text-xs text-zinc-500">
                      No OpenAI spend in this range.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* By model */}
        <div className={`${CARD} lg:col-span-2 p-4`}>
          <div className="text-base font-semibold mb-3">By model</div>
          {models.length === 0 ? (
            <div className="text-xs text-zinc-500">No spend in this range.</div>
          ) : (
            <ul className="space-y-3">
              {models.map((m) => {
                const pct = totals.cents ? (m.cents / totals.cents) * 100 : 0;
                const kinds = [...m.kinds.entries()].filter(([, c]) => c > 0.5).sort((a, b) => b[1] - a[1]);
                return (
                  <li key={m.model}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="truncate font-mono text-xs" title={m.model}>
                        {m.model || "Other"}
                      </span>
                      <span className="tabular-nums whitespace-nowrap">
                        {fmtUsd(m.cents)} <span className="text-xs text-zinc-500">{pct.toFixed(0)}%</span>
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 mt-1 overflow-hidden">
                      <div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.max(pct, 0.5)}%` }} />
                    </div>
                    {kinds.length > 1 && (
                      <div className="text-[11px] text-zinc-500 mt-1">
                        {kinds.map(([k, c]) => `${k || "other"} ${fmtUsd(c)}`).join(" · ")}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* By API key (prompt type) — OpenAI billing only; the audit log has no keys */}
      {!audit && (
        <>
      <div className={`${CARD} overflow-hidden`}>
        <div className="p-4 pb-2">
          <div className="text-base font-semibold">
            By API key <span className="text-sm font-normal text-zinc-500">({fmtInt(keys.length)})</span>
          </div>
          <div className="text-xs text-zinc-500">
            Give each prompt type its own key to see it here. OpenAI bills per project, so this shows usage, not dollars.
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-zinc-500 border-y border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className={TH}>Key</th>
                <th className={TH}>Project</th>
                <th className={TH}>Models</th>
                <th className={TH_R}>Requests</th>
                <th className={TH_R}>Input tokens</th>
                <th className={TH_R}>Output tokens</th>
              </tr>
            </thead>
            <tbody>
              {keys.slice(0, keyLimit).map((k) => (
                <tr key={`${k.projectId}|${k.apiKeyId}`} className="border-b border-zinc-100 dark:border-zinc-900">
                  <td className={TD}>
                    <div className="font-medium">{k.name || (k.apiKeyId ? "Unnamed key" : "No key")}</div>
                    {k.apiKeyId && <div className="text-[11px] text-zinc-500 font-mono">{k.apiKeyId}</div>}
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>{projectName(k.projectId)}</td>
                  <td className={`${TD} text-xs font-mono text-zinc-600 dark:text-zinc-400`}>
                    {[...k.models].join(", ") || "—"}
                  </td>
                  <td className={TD_R}>{fmtInt(k.requests)}</td>
                  <td className={TD_R}>{fmtCompact(k.input)}</td>
                  <td className={TD_R}>{fmtCompact(k.output)}</td>
                </tr>
              ))}
              {keys.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-xs text-zinc-500">
                    No usage in this range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {keys.length > KEY_PREVIEW && (
          <div className="p-3 text-center text-sm">
            <button
              onClick={() => setKeyLimit(keyLimit > KEY_PREVIEW ? KEY_PREVIEW : keys.length)}
              className="text-blue-600 hover:underline"
            >
              {keyLimit > KEY_PREVIEW ? "Show less" : `Show all ${fmtInt(keys.length)} keys`}
            </button>
          </div>
        )}
      </div>
        </>
      )}
    </div>
  );
}

function Kpi({ title, value, sub }: { title: string; value: string; sub: React.ReactNode }) {
  return (
    <div className={`${CARD} p-4`}>
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">{title}</div>
      <div className="text-3xl font-semibold tabular-nums mt-2">{value}</div>
      <div className="text-xs text-zinc-500 mt-2">{sub}</div>
    </div>
  );
}
