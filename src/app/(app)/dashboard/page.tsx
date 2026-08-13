"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, Construction, Database, Download, Loader2 } from "lucide-react";
import { ToastProvider, useToast } from "@/components/Toast";
import { useWorkspace } from "@/components/WorkspaceProvider";
import Skeleton from "@/components/Skeleton";
import TrendsChart from "./TrendsChart";
import CallsTable, { type CallRowData } from "@/components/CallsTable";
import CallViewer from "@/components/CallViewer";
import IngestionTriggers from "@/components/IngestionTriggers";
import AutomationStats from "@/components/AutomationStats";
import CallOfWeekPanel from "@/components/CallOfWeekPanel";
import { WORKSPACE_META } from "@/lib/workspace";
import { humanAiNote, isViolated, type CallRowGrade } from "@/lib/callGrade";
import { downloadJson } from "@/lib/downloadRecording";
import {
  computeStats,
  deltaOf,
  currentCycle,
  cycleByIndex,
  parseTrackingStart,
  fmtSeconds,
  gradeBand,
  GRADE_TARGET,
  SHORT_CALL_SECONDS,
  GOOD_TEXT,
  BAD_TEXT,
  CALLOUT_TEXT,
  CALLOUT_CARD,
  FALLBACK_CYCLE_ANCHOR,
  type Preset,
  type Stats,
  type DashCall,
  type DashCallGrade,
  type TrendGradeRow,
  type TrendDurationRow,
} from "@/lib/dashboard";

// Shared class fragments (keep the JSX lean, DRY, and theme-consistent).
const CARD = "rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950";
const FIELD_LABEL = "text-xs text-zinc-500 mb-1 block";
const CONTROL =
  "w-full text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500";
const TH = "py-2.5 px-3 font-medium text-left";
const TH_R = "py-2.5 px-3 font-medium text-right";
const TD = "py-2 px-3";
const TD_R = "py-2 px-3 text-right tabular-nums";
// Loading overlay for range-driven content (KPI cards / tables) while a range
// refetch is in flight — one obvious "refreshing" signal over stale numbers.
const OVERLAY =
  "absolute inset-0 z-10 flex items-center justify-center bg-white/60 dark:bg-zinc-950/60 backdrop-blur-[1px] rounded-xl";
const DIMMED = "opacity-60 pointer-events-none";

function LoadingOverlay() {
  return (
    <div className={OVERLAY}>
      <div className="flex flex-col items-center gap-2 text-zinc-500">
        <Loader2 className="animate-spin text-zinc-400" size={28} />
        <span className="text-xs">Loading…</span>
      </div>
    </div>
  );
}

type FailureClass = { key: string; name: string; sort_order: number };

interface RubricData {
  failureClasses: FailureClass[];
  repDimensions: { key: string; name: string }[];
  trackingStartDate: string | null;
}

function useDashboardData() {
  const [rubric, setRubric] = useState<RubricData | null>(null);
  const [rubricLoaded, setRubricLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/dashboard/rubric")
      .then((r) => (r.ok ? r.json() : { failureClasses: [], repDimensions: [], trackingStartDate: null }))
      .then((d) => {
        if (!cancelled) setRubric(d);
      })
      .catch(() => {
        if (!cancelled) setRubric({ failureClasses: [], repDimensions: [], trackingStartDate: null });
      })
      .finally(() => {
        if (!cancelled) setRubricLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { rubric, rubricLoaded };
}

async function fetchCalls(fromMs: number, toMs: number): Promise<DashCall[]> {
  const res = await fetch(`/api/dashboard/calls?from=${fromMs}&to=${toMs}`);
  if (!res.ok) throw new Error("Failed to load calls");
  const data = await res.json();
  return Array.isArray(data.calls) ? data.calls : [];
}

// Map an ingested dashboard call into the shared calls-table row shape so the
// dashboard renders the exact same columns + detail modal as /calls. Prod calls
// have no app user / human rating / note, so those columns show "Retell" / "—".
function dashCallToRow(c: DashCall, classNames: Map<string, string>): CallRowData {
  const g = c.call_grades;
  const start = c.timestamp ?? undefined;
  const end =
    start != null && c.duration_seconds != null
      ? start + c.duration_seconds * 1000
      : undefined;
  return {
    call_id: c.retell_call_id,
    agent_name: c.agent_name ?? (c.agent_version ? `Agent v${c.agent_version}` : null),
    call_type: c.agent_version ? `v${c.agent_version}` : undefined,
    direction: "inbound",
    start_timestamp: start,
    end_timestamp: end,
    recording_url: c.recording_url ?? undefined,
    from_number: c.phone_number ?? undefined,
    rep_score: g?.rep_score ?? null,
    grade100: g?.grade ?? null,
    ai_callout: g?.ai_callout ?? false,
    ai_note: g ? humanAiNote({ ...g, ai_callout_quote: null }, classNames) : null,
  };
}

function DashboardContent() {
  const { toast } = useToast();
  const { rubric, rubricLoaded } = useDashboardData();
  // Memoized so the `[]` fallback keeps a stable reference across renders
  // (otherwise the leaderboard useMemo would recompute every render).
  const failureClasses = useMemo(() => rubric?.failureClasses ?? [], [rubric?.failureClasses]);

  const anchor = useMemo(
    () => (rubricLoaded ? parseTrackingStart(rubric?.trackingStartDate) : FALLBACK_CYCLE_ANCHOR),
    [rubricLoaded, rubric?.trackingStartDate]
  );
  const cycle = useMemo(() => currentCycle(anchor), [anchor]);
  const prev = useMemo(() => cycleByIndex(Math.max(0, cycle.index - 1), anchor), [cycle.index, anchor]);

  // Filters
  const [preset, setPreset] = useState<Preset>("this_cycle");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [agentVersion, setAgentVersion] = useState("all");
  const [voice, setVoice] = useState("all");
  const [gradeBandFilter, setGradeBandFilter] = useState("all");
  const [failedClass, setFailedClass] = useState("all");
  const [aiCalloutFilter, setAiCalloutFilter] = useState("all");
  const [repBandFilter, setRepBandFilter] = useState("all");
  const [hideShort, setHideShort] = useState(true);
  const [search, setSearch] = useState("");

  // Shared calls-table interaction state (inline audio + detail modal).
  const [playingCallId, setPlayingCallId] = useState<string | null>(null);
  const [viewingCallId, setViewingCallId] = useState<string | null>(null);

  // Admin-only Retell backfill section (collapsed by default). A 200 from the
  // admin config route means the current user is an admin; the ingestion routes
  // are admin-gated regardless.
  const [isAdmin, setIsAdmin] = useState(false);
  const [backfillOpen, setBackfillOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/config")
      .then((r) => {
        if (!cancelled) setIsAdmin(r.ok);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const range = useMemo(() => {
    if (preset === "this_cycle") return { from: cycle.start, to: cycle.end };
    if (preset === "last_cycle") return { from: prev.start, to: prev.end };
    if (preset === "today") {
      const s = new Date();
      s.setHours(0, 0, 0, 0);
      const e = new Date(s);
      e.setDate(e.getDate() + 1);
      return { from: s, to: e };
    }
    const f = customFrom ? new Date(customFrom) : cycle.start;
    const t = customTo ? new Date(customTo) : cycle.end;
    return { from: f, to: t };
  }, [preset, customFrom, customTo, cycle.start, cycle.end, prev.start, prev.end]);

  // Data windows: current range (for the table/leaderboard/voice), and both
  // cycles (for cycle-over-cycle deltas on the KPI cards).
  const [rangeCalls, setRangeCalls] = useState<DashCall[]>([]);
  const [rangeLoading, setRangeLoading] = useState(true);
  const [thisCycleCalls, setThisCycleCalls] = useState<DashCall[]>([]);
  const [prevCycleCalls, setPrevCycleCalls] = useState<DashCall[]>([]);

  // Trends
  const [gradeRows, setGradeRows] = useState<TrendGradeRow[]>([]);
  const [durationRows, setDurationRows] = useState<TrendDurationRow[]>([]);
  const [trendsLoading, setTrendsLoading] = useState(true);

  useEffect(() => {
    if (!rubricLoaded) return;
    let cancelled = false;
    // Defer the loading flag out of the synchronous effect body (matches the
    // admin loaders' pattern) to avoid react-hooks/set-state-in-effect.
    Promise.resolve().then(() => {
      if (!cancelled) setRangeLoading(true);
    });
    fetchCalls(range.from.getTime(), range.to.getTime())
      .then((c) => {
        if (!cancelled) setRangeCalls(c);
      })
      .catch((e: Error) => {
        if (!cancelled) toast(e.message, "error");
      })
      .finally(() => {
        if (!cancelled) setRangeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rubricLoaded, range.from, range.to, toast]);

  useEffect(() => {
    if (!rubricLoaded) return;
    let cancelled = false;
    Promise.all([
      fetchCalls(cycle.start.getTime(), cycle.end.getTime()),
      fetchCalls(prev.start.getTime(), prev.end.getTime()),
    ])
      .then(([tc, pc]) => {
        if (cancelled) return;
        setThisCycleCalls(tc);
        setPrevCycleCalls(pc);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [rubricLoaded, cycle.index, prev.index, cycle.start, cycle.end, prev.start, prev.end]);

  useEffect(() => {
    if (!rubricLoaded) return;
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) setTrendsLoading(true);
    });
    fetch(`/api/dashboard/trends?since=${anchor.getTime()}`)
      .then((r) => (r.ok ? r.json() : { gradeRows: [], durationRows: [] }))
      .then((d) => {
        if (cancelled) return;
        setGradeRows(Array.isArray(d.gradeRows) ? d.gradeRows : []);
        setDurationRows(Array.isArray(d.durationRows) ? d.durationRows : []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setTrendsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rubricLoaded, anchor]);

  const versionOptions = useMemo(() => {
    const set = new Set<string>();
    for (const list of [thisCycleCalls, prevCycleCalls, rangeCalls])
      for (const c of list) if (c.agent_version) set.add(c.agent_version);
    return Array.from(set).sort();
  }, [thisCycleCalls, prevCycleCalls, rangeCalls]);

  const voiceOptions = useMemo(() => {
    const set = new Set<string>();
    for (const list of [thisCycleCalls, prevCycleCalls, rangeCalls])
      for (const c of list) if (c.voice_name) set.add(c.voice_name);
    return Array.from(set).sort();
  }, [thisCycleCalls, prevCycleCalls, rangeCalls]);

  const filtered = useMemo(() => {
    return rangeCalls.filter((c) => {
      if (hideShort && (c.duration_seconds ?? 0) < SHORT_CALL_SECONDS) return false;
      if (agentVersion !== "all" && (c.agent_version ?? "") !== agentVersion) return false;
      if (voice !== "all" && (c.voice_name ?? "Unknown") !== voice) return false;
      const g = c.call_grades?.grade;
      if (gradeBandFilter !== "all") {
        const band = gradeBand(g);
        if (band === "none") return false;
        if (gradeBandFilter !== band) return false;
      }
      if (failedClass !== "all") {
        if (!isViolated(c.call_grades?.results?.[failedClass])) return false;
      }
      if (aiCalloutFilter === "yes" && !c.call_grades?.ai_callout) return false;
      if (aiCalloutFilter === "no" && c.call_grades?.ai_callout) return false;
      if (repBandFilter !== "all") {
        const rs = c.call_grades?.rep_score;
        if (rs == null) return false;
        if (repBandFilter === "good" && rs < GRADE_TARGET) return false;
        if (repBandFilter === "warn" && (rs < 50 || rs >= GRADE_TARGET)) return false;
        if (repBandFilter === "bad" && rs >= 50) return false;
      }
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const hay = `${c.retell_call_id} ${c.phone_number ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rangeCalls, hideShort, agentVersion, voice, gradeBandFilter, failedClass, aiCalloutFilter, repBandFilter, search]);

  const stats = useMemo(() => computeStats(filtered), [filtered]);
  const thisStats = useMemo(() => computeStats(thisCycleCalls), [thisCycleCalls]);
  const prevStats = useMemo(() => computeStats(prevCycleCalls), [prevCycleCalls]);

  // Failure-class key→name map + the filtered calls projected into the shared
  // calls-table row shape (identical columns/modal to /calls).
  const classNames = useMemo(
    () => new Map(failureClasses.map((c) => [c.key, c.name])),
    [failureClasses]
  );
  const callRows = useMemo(
    () => filtered.map((c) => dashCallToRow(c, classNames)),
    [filtered, classNames]
  );

  // Reflect a manual "Grade call" (row button or modal) without a refetch.
  function handleAiGraded(callId: string, grade: CallRowGrade) {
    setRangeCalls((prev) =>
      prev.map((c) =>
        c.retell_call_id === callId
          ? { ...c, call_grades: grade.call_grades as unknown as DashCallGrade }
          : c
      )
    );
  }

  async function handleCallDownload(callId: string) {
    try {
      const res = await fetch(`/api/calls/${callId}`);
      if (!res.ok) throw new Error("Failed to fetch call data");
      downloadJson(await res.json(), `${callId}.json`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Download failed", "error");
    }
  }

  const leaderboard = useMemo(() => {
    return failureClasses
      .map((cls) => {
        let applicable = 0,
          failed = 0;
        for (const c of filtered) {
          const r = c.call_grades?.results?.[cls.key];
          if (r?.applicable) {
            applicable += 1;
            if (isViolated(r)) failed += 1;
          }
        }
        return { ...cls, applicable, failed, failRate: applicable ? failed / applicable : 0 };
      })
      .sort((a, b) => b.failRate - a.failRate || b.failed - a.failed);
  }, [failureClasses, filtered]);

  async function handleExport() {
    if (filtered.length === 0) return;
    try {
      toast(`Exporting ${filtered.length} calls…`, "info");
      const ids = filtered.map((c) => c.id);
      const res = await fetch("/api/dashboard/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error("Export request failed");
      const { calls } = await res.json();
      const payload = {
        export: {
          generated_at: new Date().toISOString(),
          total_calls: calls.length,
          average_grade: stats.avgGrade,
          pct_at_target_80: stats.pctAtTarget,
          average_rep_score: stats.avgRepScore,
          rep_pct_at_target_80: stats.repPctAtTarget,
          pct_ai_callout: stats.pctAiCallout,
          cycle: {
            index: cycle.index,
            label: cycle.label,
            start: cycle.start.toISOString(),
            end: cycle.end.toISOString(),
          },
          window: { from: range.from.toISOString(), to: range.to.toISOString(), preset },
          filters: {
            agent_version: agentVersion,
            voice,
            grade_band: gradeBandFilter,
            failed_class: failedClass,
            ai_callout: aiCalloutFilter,
            rep_band: repBandFilter,
            hide_short_lt_30s: hideShort,
            search: search.trim() || null,
          },
        },
        calls,
      };
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `resimpli_calls_${stamp}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(`Exported ${calls.length} calls`, "success");
    } catch (e) {
      toast(`Export failed: ${e instanceof Error ? e.message : "unknown"}`, "error");
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-wide text-zinc-500">Current cycle</div>
          <h1 className="text-2xl font-semibold tracking-tight">{cycle.label}</h1>
        </div>
        <div className="text-xs text-zinc-500">Previous cycle: {prev.label}</div>
      </div>

      {/* Retell backfill (admin-only, collapsible) — moved here from the admin
          panel so ingestion is triggered where the data lands. */}
      {isAdmin && (
        <div className={CARD}>
          <button
            onClick={() => setBackfillOpen((o) => !o)}
            className="w-full flex items-center justify-between p-4 text-left"
            aria-expanded={backfillOpen}
          >
            <span className="flex items-center gap-2 text-base font-semibold">
              <Database size={16} className="text-zinc-500" />
              Retell backfill
            </span>
            <ChevronDown
              size={18}
              className={`text-zinc-400 transition-transform ${backfillOpen ? "rotate-180" : ""}`}
            />
          </button>
          {backfillOpen && (
            <div className="px-4 pb-4 pt-4 border-t border-zinc-200 dark:border-zinc-800">
              <IngestionTriggers />
            </div>
          )}
        </div>
      )}

      {/* Automation stats (admin-only) — sits right under the backfill section. */}
      {isAdmin && <AutomationStats />}

      <CallOfWeekPanel
        from={cycle.start}
        to={cycle.end}
        onViewDetails={(callId) => setViewingCallId(callId)}
      />

      {/* Filters */}
      <div className={CARD}>
        <div className="p-4 pb-3 text-base font-semibold">Filters</div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6 px-4 pb-4">
          <div>
            <label className={FIELD_LABEL}>Date range</label>
            <select className={CONTROL} value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
              <option value="today">Today</option>
              <option value="this_cycle">This cycle</option>
              <option value="last_cycle">Last cycle</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          {preset === "custom" && (
            <>
              <div>
                <label className={FIELD_LABEL}>From</label>
                <input type="date" className={CONTROL} value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
              </div>
              <div>
                <label className={FIELD_LABEL}>To</label>
                <input type="date" className={CONTROL} value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
              </div>
            </>
          )}
          <div>
            <label className={FIELD_LABEL}>Agent version</label>
            <select className={CONTROL} value={agentVersion} onChange={(e) => setAgentVersion(e.target.value)}>
              <option value="all">All versions</option>
              {versionOptions.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={FIELD_LABEL}>Voice</label>
            <select className={CONTROL} value={voice} onChange={(e) => setVoice(e.target.value)}>
              <option value="all">All voices</option>
              {voiceOptions.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={FIELD_LABEL}>Grade band</label>
            <select className={CONTROL} value={gradeBandFilter} onChange={(e) => setGradeBandFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="good">≥ 80</option>
              <option value="warn">50 – 79</option>
              <option value="bad">&lt; 50</option>
            </select>
          </div>
          <div>
            <label className={FIELD_LABEL}>Failed class</label>
            <select className={CONTROL} value={failedClass} onChange={(e) => setFailedClass(e.target.value)}>
              <option value="all">All</option>
              {failureClasses.map((c) => (
                <option key={c.key} value={c.key}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={FIELD_LABEL}>AI callout</label>
            <select className={CONTROL} value={aiCalloutFilter} onChange={(e) => setAiCalloutFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="yes">Detected</option>
              <option value="no">Not detected</option>
            </select>
          </div>
          <div>
            <label className={FIELD_LABEL}>Rep score band</label>
            <select className={CONTROL} value={repBandFilter} onChange={(e) => setRepBandFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="good">≥ 80</option>
              <option value="warn">50 – 79</option>
              <option value="bad">&lt; 50</option>
            </select>
          </div>
          <div className="lg:col-span-2">
            <label className={FIELD_LABEL}>Search (phone or call ID)</label>
            <input className={CONTROL} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="+15551234567 or call_..." />
          </div>
          <div className="flex items-end">
            <button
              onClick={() => setHideShort((v) => !v)}
              className={`w-full text-sm rounded-lg px-3 py-1.5 font-medium transition-colors ${
                hideShort
                  ? "bg-blue-600 text-white hover:bg-blue-700"
                  : "border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-900"
              }`}
            >
              {hideShort ? "Hiding <30s" : "Showing all"}
            </button>
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div className="relative">
        {rangeLoading && <LoadingOverlay />}
        <div className={`grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5 ${rangeLoading ? DIMMED : ""}`}>
        <KpiCard
          title="Avg grade"
          value={stats.avgGrade}
          format={(v) => (v == null ? "—" : v.toFixed(1))}
          suffix="/100"
          target={GRADE_TARGET}
          delta={deltaOf(thisStats.avgGrade, prevStats.avgGrade)}
          count={stats.gradedCount}
        />
        <KpiCard
          title="% ≥ 80"
          value={stats.pctAtTarget}
          format={(v) => (v == null ? "—" : `${v.toFixed(0)}%`)}
          target={GRADE_TARGET}
          targetSuffix="%"
          delta={deltaOf(thisStats.pctAtTarget, prevStats.pctAtTarget)}
          count={stats.gradedCount}
        />
        <KpiCard
          title="Avg rep score"
          value={stats.avgRepScore}
          format={(v) => (v == null ? "—" : v.toFixed(1))}
          suffix="/100"
          target={GRADE_TARGET}
          delta={deltaOf(thisStats.avgRepScore, prevStats.avgRepScore)}
          count={stats.repGradedCount}
        />
        <DurationCard
          value={stats.avgDuration}
          delta={deltaOf(thisStats.avgDuration, prevStats.avgDuration)}
          count={stats.durationCount}
        />
        <CalloutCard
          value={stats.pctAiCallout}
          delta={deltaOf(thisStats.pctAiCallout, prevStats.pctAiCallout)}
          count={stats.total}
        />
        </div>
      </div>

      <TrendsChart gradeRows={gradeRows} durationRows={durationRows} anchor={anchor} loading={trendsLoading} />

      {/* Range-driven tables: leaderboard + voices + calls (overlaid while refetching) */}
      <div className="relative">
        {rangeLoading && <LoadingOverlay />}
        <div className={`space-y-6 ${rangeLoading ? DIMMED : ""}`}>
      {/* Failure class leaderboard */}
      <div className={CARD}>
        <div className="p-4 pb-3 text-base font-semibold">Failure classes — worst first</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 text-xs uppercase tracking-wide text-zinc-500">
                <th className={TH}>Class</th>
                <th className={TH_R}>Applicable</th>
                <th className={TH_R}>Failed</th>
                <th className={`${TH_R} w-44`}>Fail rate</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((r) => (
                <tr key={r.key} className="border-b border-zinc-100 dark:border-zinc-900">
                  <td className={`${TD} font-medium`}>{r.name}</td>
                  <td className={TD_R}>{r.applicable}</td>
                  <td className={TD_R}>{r.failed}</td>
                  <td className={TD_R}>
                    <div className="flex items-center justify-end gap-2">
                      <div className="h-1.5 w-24 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                        <div className="h-full bg-red-500" style={{ width: `${Math.round(r.failRate * 100)}%` }} />
                      </div>
                      <span className="w-10 text-right">{r.applicable ? `${Math.round(r.failRate * 100)}%` : "—"}</span>
                    </div>
                  </td>
                </tr>
              ))}
              {leaderboard.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center text-sm text-zinc-500 py-6">
                    No graded calls in range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Voice breakdown */}
      <VoiceBreakdown calls={filtered} />

      {/* Calls table */}
      <div className={CARD}>
        <div className="p-4 pb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-base font-semibold">Calls ({filtered.length})</div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleExport}
              disabled={filtered.length === 0}
              className="flex items-center gap-1.5 text-sm border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download size={14} /> Export JSON
            </button>
          </div>
        </div>
        <div className="px-4 pb-4">
          {rangeLoading && filtered.length === 0 ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-sm text-zinc-500 py-8">
              No calls match these filters.
            </div>
          ) : (
            <CallsTable
              calls={callRows}
              playingCallId={playingCallId}
              onTogglePlay={(id) => setPlayingCallId((prev) => (prev === id ? null : id))}
              onViewDetails={(id) => setViewingCallId(id)}
              onAiGraded={handleAiGraded}
            />
          )}
        </div>
      </div>
        </div>
      </div>

      {viewingCallId && (
        <CallViewer
          callId={viewingCallId}
          onClose={() => setViewingCallId(null)}
          onDownload={handleCallDownload}
          onAiGraded={handleAiGraded}
        />
      )}
    </div>
  );
}

// --- KPI cards ---------------------------------------------------------------

function KpiCard({
  title,
  value,
  format,
  suffix,
  target,
  targetSuffix,
  delta,
  count,
}: {
  title: string;
  value: number | null;
  format: (v: number | null) => string;
  suffix?: string;
  target: number;
  targetSuffix?: string;
  delta: number | null;
  count: number;
}) {
  const meets = value != null && value >= target;
  return (
    <div className={`${CARD} p-4`}>
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">{title}</div>
      <div className="flex items-baseline gap-2 mt-2">
        <span className="text-4xl font-semibold tabular-nums">{format(value)}</span>
        {suffix && <span className="text-sm text-zinc-500">{suffix}</span>}
      </div>
      <div className="flex items-center justify-between text-xs mt-2">
        <span className={meets ? GOOD_TEXT : "text-zinc-500"}>
          Target {target}
          {targetSuffix ?? ""}
        </span>
        {delta != null && (
          <span className={delta >= 0 ? GOOD_TEXT : BAD_TEXT}>
            {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)} vs prev
          </span>
        )}
      </div>
      <div className="relative h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden mt-2">
        <div className="absolute inset-y-0 left-0 bg-blue-600" style={{ width: `${Math.min(100, value ?? 0)}%` }} />
        <div
          className="absolute top-[-3px] bottom-[-3px] w-px bg-zinc-500"
          style={{ left: `${target}%` }}
          title={`Target ${target}${targetSuffix ?? ""}`}
        />
      </div>
      <div className="text-xs text-zinc-500 mt-2">{count} graded calls</div>
    </div>
  );
}

function DurationCard({ value, delta, count }: { value: number | null; delta: number | null; count: number }) {
  return (
    <div className={`${CARD} p-4`}>
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Avg duration</div>
      <div className="flex items-baseline gap-2 mt-2">
        <span className="text-4xl font-semibold tabular-nums">{value == null ? "—" : fmtSeconds(value)}</span>
        <span className="text-sm text-zinc-500">mm:ss</span>
      </div>
      <div className="flex items-center justify-between text-xs mt-2">
        <span className="text-zinc-500">Longer = seller staying on</span>
        {delta != null && (
          <span className={delta >= 0 ? GOOD_TEXT : BAD_TEXT}>
            {delta >= 0 ? "▲" : "▼"} {fmtSeconds(Math.abs(delta))} vs prev
          </span>
        )}
      </div>
      <div className="text-xs text-zinc-500 mt-2">{count} eligible calls</div>
    </div>
  );
}

function CalloutCard({ value, delta, count }: { value: number | null; delta: number | null; count: number }) {
  return (
    <div className={`${CARD} ${CALLOUT_CARD} p-4`}>
      <div className={`text-xs font-medium uppercase tracking-wide flex items-center gap-1.5 ${CALLOUT_TEXT}`}>
        <AlertTriangle size={14} /> AI callout rate
      </div>
      <div className="flex items-baseline gap-2 mt-2">
        <span className="text-4xl font-semibold tabular-nums">{value == null ? "—" : `${value.toFixed(1)}%`}</span>
      </div>
      <div className="flex items-center justify-between text-xs mt-2">
        <span className="text-zinc-500">Callers who suspected AI</span>
        {delta != null && (
          <span className={delta <= 0 ? GOOD_TEXT : BAD_TEXT}>
            {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}pp vs prev
          </span>
        )}
      </div>
      <div className="text-xs text-zinc-500 mt-2">{count} calls</div>
    </div>
  );
}

// --- Voice breakdown ---------------------------------------------------------

function VoiceBreakdown({ calls }: { calls: DashCall[] }) {
  const rows = useMemo(() => {
    const buckets = new Map<string, DashCall[]>();
    for (const c of calls) {
      const key = c.voice_name ?? "Unknown";
      const arr = buckets.get(key) ?? [];
      arr.push(c);
      buckets.set(key, arr);
    }
    return Array.from(buckets.entries())
      .map(([v, list]) => {
        const s: Stats = computeStats(list);
        return { voice: v, count: list.length, ...s };
      })
      .sort((a, b) => b.count - a.count);
  }, [calls]);

  return (
    <div className={CARD}>
      <div className="p-4 pb-3 text-base font-semibold">Voices — which sound most human</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 text-xs uppercase tracking-wide text-zinc-500">
              <th className={TH}>Voice</th>
              <th className={TH_R}>Calls</th>
              <th className={TH_R}>Avg grade</th>
              <th className={TH_R}>% ≥ 80</th>
              <th className={TH_R}>Avg rep</th>
              <th className={TH_R}>AI callout</th>
              <th className={TH_R}>Avg duration</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.voice} className="border-b border-zinc-100 dark:border-zinc-900">
                <td className={`${TD} font-medium`}>{r.voice}</td>
                <td className={TD_R}>{r.count}</td>
                <td className={TD_R}>{r.avgGrade == null ? "—" : r.avgGrade.toFixed(1)}</td>
                <td className={TD_R}>{r.pctAtTarget == null ? "—" : `${r.pctAtTarget.toFixed(0)}%`}</td>
                <td className={TD_R}>{r.avgRepScore == null ? "—" : r.avgRepScore.toFixed(1)}</td>
                <td className={TD_R}>{r.pctAiCallout == null ? "—" : `${r.pctAiCallout.toFixed(1)}%`}</td>
                <td className={TD_R}>{r.avgDuration == null ? "—" : fmtSeconds(r.avgDuration)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-sm text-zinc-500 py-6">
                  No calls in range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Outbound / Speed to Lead run in the same app but have no call-grader
// dashboard wired up yet — say so instead of rendering empty charts.
function DashboardNotSetUp({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-24">
      <Construction size={40} className="text-zinc-300 dark:text-zinc-700 mb-4" />
      <h1 className="text-lg font-semibold">{label} dashboard not set up yet</h1>
      <p className="text-sm text-zinc-500 mt-1 max-w-sm">
        This workspace has no dashboard yet. Test Call, Calls, Batch Tests and
        Admin work as usual.
      </p>
    </div>
  );
}

export default function DashboardPage() {
  const { workspace } = useWorkspace();
  const meta = WORKSPACE_META[workspace];
  return (
    <ToastProvider>
      <div className="p-6 md:p-8">
        {meta.hasDashboard ? <DashboardContent /> : <DashboardNotSetUp label={meta.label} />}
      </div>
    </ToastProvider>
  );
}
