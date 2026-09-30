"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Download, Info, Loader2, Search } from "lucide-react";
import CostTrendChart from "./CostTrendChart";
import { BAD_TEXT, GOOD_TEXT, fmtSeconds } from "@/lib/dashboard";
import {
  COST_PRESETS,
  COST_WORKSPACES,
  DEFAULT_COST_PRESET,
  COST_TIMEZONE,
  COST_TIMEZONE_LABEL,
  PRODUCT_HINTS,
  WORKSPACE_COLOR_VAR,
  agentFilterKey,
  buildCostTrend,
  costDayStartMs,
  costToday,
  daysBetween,
  defaultGranularity,
  fmtDayRange,
  fmtInt,
  fmtMinutes,
  fmtPerMin,
  fmtUsd,
  parseAgentFilter,
  presetRange,
  productLabel,
  workspaceLabel,
  type CostAgentRow,
  type CostGranularity,
  type CostPreset,
  type CostReport,
} from "@/lib/costs";
import type { Workspace } from "@/lib/workspace";

// Shared class fragments (same theme as the dashboard).
const CARD = "rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950";
const FIELD_LABEL = "text-xs text-zinc-500 mb-1 block";
const CONTROL =
  "w-full text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500";
const TH = "py-2.5 px-3 font-medium text-left whitespace-nowrap";
const TH_R = "py-2.5 px-3 font-medium text-right whitespace-nowrap";
const TD = "py-2 px-3";
const TD_R = "py-2 px-3 text-right tabular-nums whitespace-nowrap";
const OVERLAY =
  "absolute inset-0 z-10 flex items-center justify-center bg-white/60 dark:bg-zinc-950/60 backdrop-blur-[1px] rounded-xl";

// The agent table opens on the top spenders only; "show more" pages through
// the rest. The Agent filter above is the way to jump to a specific one.
const AGENT_PREVIEW = 10;
const AGENT_PAGE = 25;

type WorkspaceFilter = "all" | Workspace;

interface Totals {
  calls: number;
  connected: number;
  billedSec: number;
  cents: number;
  connectedSec: number;
  agents: number;
}

function sumAgents(rows: CostAgentRow[]): Totals {
  const t: Totals = { calls: 0, connected: 0, billedSec: 0, cents: 0, connectedSec: 0, agents: rows.length };
  for (const r of rows) {
    t.calls += r.calls;
    t.connected += r.connected;
    t.billedSec += r.billedSec;
    t.cents += r.cents;
    t.connectedSec += r.connectedSec;
  }
  return t;
}

/** Display name for an agent: its name, else its ID (stored "" when Retell had none). */
function agentLabel(a: { agentName: string | null; agentId: string }): string {
  return a.agentName || a.agentId || "Unnamed agent";
}

function fmtCentralDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: COST_TIMEZONE,
  });
}

function fmtAgo(ms: number, now: number): string {
  const min = Math.round((now - ms) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export default function CostsPage() {
  // Today in the reporting timezone. Re-checked on focus and every minute, so
  // a tab left open overnight moves "Today" / "Last 7 days" forward.
  const [today, setToday] = useState(() => costToday());
  const [preset, setPreset] = useState<CostPreset>(DEFAULT_COST_PRESET);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [wsFilter, setWsFilter] = useState<WorkspaceFilter>("all");
  // "" = all agents, else "<workspace>:<agentId>" (agentFilterKey).
  const [agentKey, setAgentKey] = useState("");
  const [granularityPick, setGranularityPick] = useState<{ rangeKey: string; g: CostGranularity } | null>(null);
  const [result, setResult] = useState<{ key: string; report: CostReport; fetchedAt: number } | null>(null);
  // Keyed to the request that failed, so a later filter change shows its own
  // loading state instead of the stale error.
  const [error, setError] = useState<{ key: string; message: string } | null>(null);

  useEffect(() => {
    const refresh = () => setToday(costToday());
    const timer = setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  const customInvalid = preset === "custom" && !!customFrom && !!customTo && customTo < customFrom;
  const range = useMemo(
    () => presetRange(preset, today, { from: customFrom, to: customTo }),
    [preset, today, customFrom, customTo]
  );
  const rangeKey = `${range.from}-${range.to}`;
  const fetchKey = `${rangeKey}|${agentKey}`;
  const agentFilter = useMemo(() => parseAgentFilter(agentKey), [agentKey]);

  useEffect(() => {
    if (customInvalid) return;
    let cancelled = false;
    const key = `${range.from}-${range.to}|${agentKey}`;
    const agentParam = agentKey ? `&agent=${encodeURIComponent(agentKey)}` : "";
    fetch(`/api/costs?from=${range.from}&to=${range.to}${agentParam}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data?.error ?? "Failed to load costs");
        return data as CostReport;
      })
      .then((report) => {
        if (cancelled) return;
        setResult({ key, report, fetchedAt: Date.now() });
      })
      .catch((e) => {
        if (!cancelled) setError({ key, message: e instanceof Error ? e.message : "Failed to load costs" });
      });
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to, agentKey, customInvalid]);

  const report = result?.report ?? null;
  const errorMessage = error?.key === fetchKey ? error.message : null;
  const loading = !customInvalid && result?.key !== fetchKey && !errorMessage;
  const granularity = granularityPick?.rangeKey === rangeKey ? granularityPick.g : defaultGranularity(range);

  // An agent lives in exactly one workspace, so selecting one narrows the
  // chart/breakdowns to that workspace's single series.
  const shown = useMemo<readonly Workspace[]>(
    () => (agentFilter ? [agentFilter.workspace] : wsFilter === "all" ? COST_WORKSPACES : [wsFilter]),
    [wsFilter, agentFilter]
  );

  // Agent dropdown: grouped by workspace, alphabetical within a group. The
  // options come from the unfiltered list, so they survive a selection.
  const agentGroups = useMemo(() => {
    const opts = report?.agentOptions ?? [];
    const workspaces = wsFilter === "all" ? COST_WORKSPACES : [wsFilter];
    return workspaces
      .map((ws) => ({
        ws,
        agents: opts
          .filter((o) => o.workspace === ws)
          .sort((a, b) => agentLabel(a).localeCompare(agentLabel(b))),
      }))
      .filter((g) => g.agents.length > 0);
  }, [report, wsFilter]);
  const selectedMissing =
    !!agentFilter && !(report?.agentOptions ?? []).some((o) => agentFilterKey(o) === agentKey);

  const agents = useMemo(
    () => (report?.agents ?? []).filter((a) => shown.includes(a.workspace)),
    [report, shown]
  );
  const totals = useMemo(() => sumAgents(agents), [agents]);
  const prevCents = useMemo(
    () => (report?.previous ?? []).filter((p) => shown.includes(p.workspace)).reduce((s, p) => s + p.cents, 0),
    [report, shown]
  );
  const trend = useMemo(
    () =>
      report ? buildCostTrend(report.daily, { from: report.fromDay, to: report.toDay }, granularity, shown) : [],
    [report, granularity, shown]
  );
  const byWorkspace = useMemo(
    () =>
      COST_WORKSPACES.map((ws) => ({
        ws,
        ...sumAgents((report?.agents ?? []).filter((a) => a.workspace === ws)),
      })),
    [report]
  );
  const products = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of report?.products ?? []) {
      if (shown.includes(p.workspace)) m.set(p.product, (m.get(p.product) ?? 0) + p.cents);
    }
    return [...m.entries()]
      .map(([product, cents]) => ({ product, cents }))
      .filter((p) => p.cents > 0.5)
      .sort((a, b) => b.cents - a.cents);
  }, [report, shown]);

  // Coverage: part of the window (or the comparison window) predates what the
  // backfill has loaded, so its totals would read low.
  const coverage = useMemo(() => {
    if (!report) return null;
    const sync = report.sync.filter((s) => shown.includes(s.workspace));
    const covers = (startMs: number) => sync.every((s) => s.backfilledTo != null && s.backfilledTo <= startMs);
    const gaps = sync.filter((s) => s.backfilledTo == null || s.backfilledTo > costDayStartMs(report.fromDay));
    return {
      prevCovered: covers(costDayStartMs(report.prevFromDay)),
      gap: gaps.length
        ? {
            earliest: Math.max(...gaps.map((s) => s.backfilledTo ?? Date.parse(`${report.today}T00:00:00Z`))),
            inProgress: gaps.some((s) => !s.backfillComplete),
          }
        : null,
    };
  }, [report, shown]);
  const coverageGap = coverage?.gap ?? null;
  const lastSync = useMemo(() => {
    const ts = (report?.sync ?? []).filter((s) => shown.includes(s.workspace)).map((s) => s.lastSyncAt);
    if (!ts.length || ts.some((t) => t == null)) return null;
    return Math.min(...(ts as number[]));
  }, [report, shown]);

  const prevDays = report ? daysBetween(report.fromDay, report.toDay) : 0;
  const delta = coverage?.prevCovered && prevCents > 0 ? ((totals.cents - prevCents) / prevCents) * 100 : null;

  function onWorkspace(next: WorkspaceFilter) {
    setWsFilter(next);
    // Drop an agent selection that the new workspace would hide.
    if (agentFilter && next !== "all" && next !== agentFilter.workspace) setAgentKey("");
  }

  function onPreset(next: CostPreset) {
    if (next === "custom" && !customFrom) {
      setCustomFrom(range.from);
      setCustomTo(range.to);
    }
    setPreset(next);
  }

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Costs Dashboard</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Retell spend across every workspace.
          </p>
        </div>
        {report && (
          <div className="text-xs text-zinc-500 text-right">
            <div>
              {fmtDayRange({ from: report.fromDay, to: report.toDay })} · {COST_TIMEZONE_LABEL} time
            </div>
            <div>{lastSync ? `Synced ${fmtAgo(lastSync, result!.fetchedAt)}` : "Not synced yet"}</div>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className={`${CARD} grid grid-cols-2 gap-3 p-4 md:grid-cols-4 lg:grid-cols-5`}>
        <div>
          <label htmlFor="cost-timeline" className={FIELD_LABEL}>Timeline</label>
          <select id="cost-timeline" className={CONTROL} value={preset} onChange={(e) => onPreset(e.target.value as CostPreset)}>
            {COST_PRESETS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        {preset === "custom" && (
          <>
            <div>
              <label htmlFor="cost-from" className={FIELD_LABEL}>From</label>
              <input id="cost-from" type="date" max={today} className={CONTROL} value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            </div>
            <div>
              <label htmlFor="cost-to" className={FIELD_LABEL}>To</label>
              <input id="cost-to" type="date" max={today} className={CONTROL} value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            </div>
          </>
        )}
        <div>
          <label htmlFor="cost-workspace" className={FIELD_LABEL}>Workspace</label>
          <select id="cost-workspace" className={CONTROL} value={wsFilter} onChange={(e) => onWorkspace(e.target.value as WorkspaceFilter)}>
            <option value="all">All workspaces</option>
            {COST_WORKSPACES.map((ws) => (
              <option key={ws} value={ws}>
                {workspaceLabel(ws)}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <label htmlFor="cost-agent" className={FIELD_LABEL}>Agent</label>
          <select id="cost-agent" className={CONTROL} value={agentKey} onChange={(e) => setAgentKey(e.target.value)}>
            <option value="">All agents</option>
            {selectedMissing && <option value={agentKey}>Selected agent (no calls in this range)</option>}
            {agentGroups.map((g) => (
              <optgroup key={g.ws} label={`${workspaceLabel(g.ws)} (${g.agents.length})`}>
                {g.agents.map((a) => (
                  <option key={agentFilterKey(a)} value={agentFilterKey(a)}>
                    {agentLabel(a)} · {fmtUsd(a.cents)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        {customInvalid && (
          <div className={`col-span-full text-xs ${BAD_TEXT}`}>&ldquo;To&rdquo; must be on or after &ldquo;From&rdquo;.</div>
        )}
      </div>

      {errorMessage && (
        <div role="alert" className={`${CARD} p-4 text-sm flex items-center gap-2 ${BAD_TEXT}`}>
          <AlertTriangle size={16} /> {errorMessage}
        </div>
      )}
      {coverageGap && (
        <div className="rounded-xl border border-amber-300 dark:border-amber-800/60 bg-amber-50/60 dark:bg-amber-950/20 p-3 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
          <Info size={14} className="mt-0.5 shrink-0" />
          <span>
            {coverageGap.inProgress ? "History is still loading — " : "History is loaded from "}
            {coverageGap.inProgress ? "costs are complete from " : ""}
            <strong>{fmtCentralDate(coverageGap.earliest)}</strong>
            {" onward. Totals for earlier dates in this range will be low."}
          </span>
        </div>
      )}

      {!report && !errorMessage ? (
        <div className={`${CARD} h-64 flex items-center justify-center text-zinc-500`}>
          <Loader2 className="animate-spin" size={24} />
        </div>
      ) : report ? (
        <div className="relative space-y-5">
          {loading && (
            <div className={OVERLAY}>
              <Loader2 className="animate-spin text-zinc-400" size={28} />
            </div>
          )}

          {/* KPI tiles */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <Kpi
              title="Total spend"
              value={fmtUsd(totals.cents)}
              sub={
                !coverage?.prevCovered ? (
                  "Previous period not loaded"
                ) : delta == null ? (
                  "No spend in previous period"
                ) : (
                  // Spend going up is the "bad" direction.
                  <span
                    className={delta > 0 ? BAD_TEXT : GOOD_TEXT}
                    title={
                      report.prevPartial
                        ? "Today is compared with the same hours of the matching earlier day."
                        : undefined
                    }
                  >
                    {delta > 0 ? <ArrowUp size={11} className="inline" /> : <ArrowDown size={11} className="inline" />}{" "}
                    {Math.abs(delta).toFixed(0)}% vs previous {prevDays === 1 ? "day" : `${prevDays} days`} (
                    {fmtUsd(prevCents)})
                  </span>
                )
              }
            />
            <Kpi
              title="Calls"
              value={fmtInt(totals.calls)}
              sub={`${fmtInt(totals.connected)} connected${
                totals.calls ? ` (${Math.round((totals.connected / totals.calls) * 100)}%)` : ""
              }`}
            />
            <Kpi title="Billed minutes" value={fmtMinutes(totals.billedSec)} sub={`${fmtInt(totals.agents)} agents`} />
            <Kpi title="Cost / minute" value={fmtPerMin(totals.cents, totals.billedSec)} sub="Across billed minutes" />
            <Kpi
              title="Cost / connected call"
              value={totals.connected ? fmtUsd(totals.cents / totals.connected, { precise: true }) : "—"}
              sub={`Avg duration ${totals.connected ? fmtSeconds(totals.connectedSec / totals.connected) : "—"}`}
            />
          </div>

          <CostTrendChart
            points={trend}
            workspaces={shown}
            granularity={granularity}
            onGranularity={(g) => setGranularityPick({ rangeKey, g })}
          />

          <div className="grid gap-5 lg:grid-cols-5">
            {/* Per-workspace breakdown (meaningless for a single agent) */}
            {!agentFilter && (
            <div className={`${CARD} lg:col-span-3 overflow-hidden`}>
              <div className="p-4 pb-2 text-base font-semibold">By workspace</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                    <tr>
                      <th className={TH}>Workspace</th>
                      <th className={TH_R}>Agents</th>
                      <th className={TH_R}>Calls</th>
                      <th className={TH_R}>Minutes</th>
                      <th className={TH_R}>Avg dur</th>
                      <th className={TH_R}>$/min</th>
                      <th className={TH_R}>Spend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byWorkspace.map((w) => {
                      const all = byWorkspace.reduce((s, x) => s + x.cents, 0);
                      const active = wsFilter === "all" || wsFilter === w.ws;
                      return (
                        <tr
                          key={w.ws}
                          tabIndex={0}
                          aria-selected={wsFilter === w.ws}
                          onClick={() => onWorkspace(wsFilter === w.ws ? "all" : w.ws)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onWorkspace(wsFilter === w.ws ? "all" : w.ws);
                            }
                          }}
                          className={`border-b border-zinc-100 dark:border-zinc-900 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${
                            active ? "" : "opacity-40"
                          }`}
                          title={wsFilter === w.ws ? "Show all workspaces" : `Filter to ${workspaceLabel(w.ws)}`}
                        >
                          <td className={TD}>
                            <span className="inline-flex items-center gap-2 font-medium">
                              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: WORKSPACE_COLOR_VAR[w.ws] }} />
                              {workspaceLabel(w.ws)}
                            </span>
                          </td>
                          <td className={TD_R}>{fmtInt(w.agents)}</td>
                          <td className={TD_R}>
                            {fmtInt(w.calls)}
                            <div className="text-[11px] text-zinc-500">{fmtInt(w.connected)} conn.</div>
                          </td>
                          <td className={TD_R}>{fmtMinutes(w.billedSec)}</td>
                          <td className={TD_R}>{w.connected ? fmtSeconds(w.connectedSec / w.connected) : "—"}</td>
                          <td className={TD_R}>{fmtPerMin(w.cents, w.billedSec)}</td>
                          <td className={TD_R}>
                            <div className="font-medium">{fmtUsd(w.cents)}</div>
                            <div className="text-[11px] text-zinc-500">{all ? Math.round((w.cents / all) * 100) : 0}%</div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            )}

            {/* Product breakdown */}
            <div className={`${CARD} ${agentFilter ? "lg:col-span-5" : "lg:col-span-2"} p-4`}>
              <div className="text-base font-semibold mb-3">Where the money goes</div>
              {products.length === 0 ? (
                <div className="text-xs text-zinc-500">No spend in this range.</div>
              ) : (
                <ul className="space-y-3">
                  {products.map((p) => {
                    const pct = totals.cents ? (p.cents / totals.cents) * 100 : 0;
                    return (
                      <li key={p.product}>
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="truncate" title={p.product}>
                            {productLabel(p.product)}
                          </span>
                          <span className="tabular-nums whitespace-nowrap">
                            {fmtUsd(p.cents)} <span className="text-xs text-zinc-500">{pct.toFixed(0)}%</span>
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 mt-1 overflow-hidden">
                          <div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.max(pct, 0.5)}%` }} />
                        </div>
                        {PRODUCT_HINTS[p.product] && pct >= 10 && (
                          <div className="text-[11px] text-zinc-500 mt-1">{PRODUCT_HINTS[p.product]}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <AgentTable
            agents={agents}
            showWorkspace={wsFilter === "all" && !agentFilter}
            selectedKey={agentKey}
            onSelect={setAgentKey}
            rangeLabel={`${report.fromDay}_${report.toDay}`}
          />
        </div>
      ) : null}
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

// --- Agent table ---------------------------------------------------------------

type SortKey = "name" | "calls" | "connected" | "avgSec" | "minSec" | "maxSec" | "billedSec" | "cents" | "perMin" | "perCall";

const perMin = (a: CostAgentRow) => (a.billedSec ? a.cents / (a.billedSec / 60) : 0);
const perCall = (a: CostAgentRow) => (a.connected ? a.cents / a.connected : 0);

const SORTERS: Record<SortKey, (a: CostAgentRow) => number | string> = {
  name: (a) => agentLabel(a).toLowerCase(),
  calls: (a) => a.calls,
  connected: (a) => a.connected,
  avgSec: (a) => a.avgSec ?? -1,
  minSec: (a) => a.minSec ?? -1,
  maxSec: (a) => a.maxSec ?? -1,
  billedSec: (a) => a.billedSec,
  cents: (a) => a.cents,
  perMin,
  perCall,
};

const COLUMNS: { key: SortKey; label: string; title?: string }[] = [
  { key: "calls", label: "Calls" },
  { key: "connected", label: "Connected" },
  { key: "avgSec", label: "Avg", title: "Average duration of connected calls" },
  { key: "minSec", label: "Min", title: "Shortest connected call" },
  { key: "maxSec", label: "Max", title: "Longest connected call" },
  { key: "billedSec", label: "Minutes", title: "Billed minutes" },
  { key: "cents", label: "Spend" },
  { key: "perMin", label: "$/min" },
  { key: "perCall", label: "$/conn. call", title: "Spend per connected call" },
];

function csvCell(v: string | number | null): string {
  if (v == null) return "";
  let s = String(v);
  // Neutralise spreadsheet formulas: agent names are free text, and a cell
  // starting with = + - @ (or a tab/CR) would be evaluated by Excel/Sheets.
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv(rows: CostAgentRow[], rangeLabel: string) {
  const header = [
    "workspace", "agent_name", "agent_id", "calls", "connected_calls", "avg_duration_sec",
    "min_duration_sec", "max_duration_sec", "billed_minutes", "spend_usd", "usd_per_min", "usd_per_connected_call",
  ];
  const round = (v: number | null, d = 0) => (v == null ? null : Number(v.toFixed(d)));
  const lines = rows.map((a) =>
    [
      workspaceLabel(a.workspace), a.agentName, a.agentId, a.calls, a.connected,
      round(a.avgSec, 1), round(a.minSec, 1), round(a.maxSec, 1), round(a.billedSec / 60, 1),
      round(a.cents / 100, 2), round(perMin(a) / 100, 4), round(perCall(a) / 100, 4),
    ].map(csvCell).join(",")
  );
  const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `retell-costs-by-agent_${rangeLabel}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

const SORT_BUTTON = "inline-flex items-center gap-1 font-medium hover:text-zinc-700 dark:hover:text-zinc-300";

function ariaSort(sort: { key: SortKey; desc: boolean }, k: SortKey): "ascending" | "descending" | "none" {
  if (sort.key !== k) return "none";
  return sort.desc ? "descending" : "ascending";
}

function SortIcon({ sort, k }: { sort: { key: SortKey; desc: boolean }; k: SortKey }) {
  if (sort.key !== k) return null;
  return sort.desc ? <ArrowDown size={11} className="inline" /> : <ArrowUp size={11} className="inline" />;
}

function AgentTable({
  agents,
  showWorkspace,
  selectedKey,
  onSelect,
  rangeLabel,
}: {
  agents: CostAgentRow[];
  showWorkspace: boolean;
  selectedKey: string;
  onSelect: (agentKey: string) => void;
  rangeLabel: string;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "cents", desc: true });
  const [limit, setLimit] = useState(AGENT_PREVIEW);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? agents.filter((a) => `${a.agentName ?? ""} ${a.agentId}`.toLowerCase().includes(q))
      : agents;
    const get = SORTERS[sort.key];
    return [...filtered].sort((x, y) => {
      const a = get(x);
      const b = get(y);
      const cmp = a < b ? -1 : a > b ? 1 : 0;
      return sort.desc ? -cmp : cmp;
    });
  }, [agents, query, sort]);

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "name" }));
  }

  return (
    <div className={`${CARD} overflow-hidden`}>
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 pb-3">
        <div className="text-base font-semibold">
          By agent{" "}
          <span className="text-sm font-normal text-zinc-500">
            {rows.length > limit
              ? `top ${fmtInt(limit)} of ${fmtInt(rows.length)} by ${sort.key === "cents" && sort.desc ? "spend" : "current sort"}`
              : `(${fmtInt(rows.length)})`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(AGENT_PREVIEW);
              }}
              placeholder="Search agent name or ID"
              className={`${CONTROL} pl-8 w-56`}
            />
          </div>
          <button
            onClick={() => exportCsv(rows, rangeLabel)}
            disabled={rows.length === 0}
            className="inline-flex items-center gap-1.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-50"
          >
            <Download size={14} /> CSV
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-zinc-500 border-y border-zinc-200 dark:border-zinc-800">
            <tr>
              <th className={TH} aria-sort={ariaSort(sort, "name")}>
                <button type="button" className={SORT_BUTTON} onClick={() => toggleSort("name")}>
                  Agent <SortIcon sort={sort} k="name" />
                </button>
              </th>
              {showWorkspace && <th className={TH}>Workspace</th>}
              {COLUMNS.map((c) => (
                <th key={c.key} title={c.title} className={TH_R} aria-sort={ariaSort(sort, c.key)}>
                  <button type="button" className={SORT_BUTTON} onClick={() => toggleSort(c.key)}>
                    <SortIcon sort={sort} k={c.key} /> {c.label}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((a) => {
              const key = agentFilterKey(a);
              const selected = key === selectedKey;
              return (
              <tr
                key={key}
                tabIndex={0}
                aria-selected={selected}
                onClick={() => onSelect(selected ? "" : key)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(selected ? "" : key);
                  }
                }}
                title={selected ? "Clear agent filter" : "Filter the page to this agent"}
                className={`border-b border-zinc-100 dark:border-zinc-900 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${
                  selected ? "bg-blue-50 dark:bg-blue-950/30" : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
                }`}
              >
                <td className={TD}>
                  <div className="font-medium">{agentLabel(a)}</div>
                  <div className="text-[11px] text-zinc-500 font-mono">{a.agentId || "—"}</div>
                </td>
                {showWorkspace && (
                  <td className={`${TD} whitespace-nowrap`}>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-sm" style={{ background: WORKSPACE_COLOR_VAR[a.workspace] }} />
                      {workspaceLabel(a.workspace)}
                    </span>
                  </td>
                )}
                <td className={TD_R}>{fmtInt(a.calls)}</td>
                <td className={TD_R}>{fmtInt(a.connected)}</td>
                <td className={TD_R}>{fmtSeconds(a.avgSec)}</td>
                <td className={TD_R}>{fmtSeconds(a.minSec)}</td>
                <td className={TD_R}>{fmtSeconds(a.maxSec)}</td>
                <td className={TD_R}>{fmtMinutes(a.billedSec)}</td>
                <td className={`${TD_R} font-medium`}>{fmtUsd(a.cents, { precise: true })}</td>
                <td className={TD_R}>{fmtPerMin(a.cents, a.billedSec)}</td>
                <td className={TD_R}>{a.connected ? fmtUsd(perCall(a), { precise: true }) : "—"}</td>
              </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length + 2} className="p-6 text-center text-xs text-zinc-500">
                  No agents match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > AGENT_PREVIEW && (
        <div className="flex flex-wrap items-center justify-center gap-4 p-3 text-sm">
          <span className="text-xs text-zinc-500">
            Showing {fmtInt(Math.min(limit, rows.length))} of {fmtInt(rows.length)}
          </span>
          {rows.length > limit && (
            <>
              <button onClick={() => setLimit(limit + AGENT_PAGE)} className="text-blue-600 hover:underline">
                Show {fmtInt(Math.min(AGENT_PAGE, rows.length - limit))} more
              </button>
              <button onClick={() => setLimit(rows.length)} className="text-blue-600 hover:underline">
                Show all
              </button>
            </>
          )}
          {limit > AGENT_PREVIEW && (
            <button onClick={() => setLimit(AGENT_PREVIEW)} className="text-blue-600 hover:underline">
              Show less
            </button>
          )}
        </div>
      )}
    </div>
  );
}
