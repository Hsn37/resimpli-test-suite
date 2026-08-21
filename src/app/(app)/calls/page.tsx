"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  FileDown,
  Loader2,
  Phone,
  Search,
  X,
} from "lucide-react";
import { ToastProvider, useToast } from "@/components/Toast";
import CallViewer from "@/components/CallViewer";
import CallsTable, { type CallRowData, sharePath } from "@/components/CallsTable";
import { useWorkspace } from "@/components/WorkspaceProvider";
import type { CallRowGrade } from "@/lib/callGrade";
import type { Workspace } from "@/lib/workspace";
import {
  downloadCsv,
  downloadJson,
} from "@/lib/downloadRecording";

type SortKey = "newest" | "rating-desc" | "rating-asc";

// CSV export config. Columns mirror the on-screen row plus the shareable link.
const EXPORT_FILENAME_PREFIX = "calls_export";
const CSV_COLUMNS = [
  "call_id",
  "agent_name",
  "call_type",
  "direction",
  "start_time",
  "duration_seconds",
  "user_email",
  "grade",
  "rep_score",
  "grade100",
  "note",
  "call_status",
  "from_number",
  "to_number",
  "recording_url",
  "share_link",
  "variables",
  "transcript",
] as const;

// Default export excludes calls that are ungraded OR have no recording. The
// "Include empty / ungraded calls" checkbox overrides this. A call counts as
// graded if it has EITHER the legacy star grade (tool-placed calls) or the
// 0-100 grade from call_grades (rep_score/grade100) — prod's migrated calls
// only have the latter, so keying off `grade` alone excluded all of them.
function isExportableByDefault(call: CallRowData): boolean {
  const isGraded =
    call.grade != null || call.rep_score != null || call.grade100 != null;
  return isGraded && !!call.recording_url;
}

function callDurationSeconds(call: CallRowData): number | null {
  return call.start_timestamp && call.end_timestamp
    ? Math.round((call.end_timestamp - call.start_timestamp) / 1000)
    : null;
}

// Preset duration buckets for the quick-pick chips (seconds; null = open-ended).
const DURATION_PRESETS: { label: string; min: number | null; max: number | null }[] = [
  { label: "<1 min", min: null, max: 59 },
  { label: "1-3 min", min: 60, max: 180 },
  { label: "3-5 min", min: 180, max: 300 },
  { label: "5+ min", min: 300, max: null },
];

// Inclusive date-range test over a call's start_timestamp. Calls without a
// start_timestamp are skipped only when a bound is set.
function inExportDateRange(
  ts: number | undefined,
  startMs: number | null,
  endMs: number | null
): boolean {
  if (startMs == null && endMs == null) return true;
  if (ts == null) return false;
  if (startMs != null && ts < startMs) return false;
  if (endMs != null && ts > endMs) return false;
  return true;
}

// Transcript + dynamic variables pulled from a call's full get-call detail.
interface ExportDetail {
  variables: string;
  transcript: string;
}

// Variables are serialized as JSON; transcript prefers the plain string and
// falls back to the structured transcript_object when it's absent.
function detailToExportFields(data: Record<string, unknown>): ExportDetail {
  const vars = data.retell_llm_dynamic_variables as
    | Record<string, unknown>
    | undefined;
  const variables =
    vars && Object.keys(vars).length > 0 ? JSON.stringify(vars) : "";

  let transcript = (data.transcript as string) || "";
  if (!transcript) {
    const obj = data.transcript_object as
      | Array<{ role: string; content: string }>
      | undefined;
    if (obj?.length) {
      transcript = obj.map((m) => `${m.role}: ${m.content}`).join("\n");
    }
  }
  return { variables, transcript };
}

// One CSV data row in CSV_COLUMNS order. Escaping is handled by downloadCsv.
function callToCsvRow(
  call: CallRowData,
  detail: ExportDetail,
  workspace: Workspace
): (string | number)[] {
  const duration =
    call.start_timestamp && call.end_timestamp
      ? Math.round((call.end_timestamp - call.start_timestamp) / 1000)
      : "";
  return [
    call.call_id,
    call.agent_name ?? "",
    call.call_type ?? "",
    call.direction ?? "",
    call.start_timestamp ? new Date(call.start_timestamp).toISOString() : "",
    duration,
    call.user_email ?? "",
    call.grade ?? "",
    call.rep_score ?? "",
    call.grade100 ?? "",
    call.note ?? "",
    call.call_status ?? "",
    call.from_number ?? "",
    call.to_number ?? "",
    call.recording_url ?? "",
    `${window.location.origin}${sharePath(call.call_id, workspace)}`,
    detail.variables,
    detail.transcript,
  ];
}

const PAGE_SIZE = 50;
// The calls page loads the LAST 1000 calls only, then filters/sorts/paginates
// over that window client-side. Retell's list-calls is ~5s per 1000-call page,
// so pulling more means multiple sequential pages that blow past the route's
// 30s budget (a 5000 fetch 500'd). 1000 = one page, fast. The date-range loader
// reuses this same cap over a from/to window.
const FETCH_LIMIT = 1000;

// Retell call IDs are `call_` followed by an alphanumeric token. Used to detect
// when a search query is an exact ID worth fetching straight from Retell.
const CALL_ID_RE = /^call_[a-zA-Z0-9]+$/;

// Shared fetch for the /api/calls/list endpoint (recent window, a date range,
// or a single call_id). Normalizes the array-or-{calls} response shape.
async function fetchCalls(query: string): Promise<CallRowData[]> {
  const res = await fetch(`/api/calls/list?${query}`);
  if (!res.ok) throw new Error("Failed to fetch calls");
  const data = await res.json();
  return Array.isArray(data) ? data : data.calls ?? [];
}

function CallsContent() {
  const [calls, setCalls] = useState<CallRowData[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  const [userFilter, setUserFilter] = useState<string>("all");
  const [playingCallId, setPlayingCallId] = useState<string | null>(null);
  const [viewingCallId, setViewingCallId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportStart, setExportStart] = useState("");
  const [exportEnd, setExportEnd] = useState("");
  const [includeEmpty, setIncludeEmpty] = useState(false);
  // Date-range loader (replaces the recent window with a Retell from/to fetch).
  const [rangeOpen, setRangeOpen] = useState(false);
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  // Duration filter (seconds). Empty string = no bound on that side. Presets
  // set a range (min/max differ); the exact minutes/seconds inputs set both
  // to the same target, so "duration === exact" falls out of the same
  // min <= dur <= max check as the range presets.
  const [durationOpen, setDurationOpen] = useState(false);
  const [durationMin, setDurationMin] = useState("");
  const [durationMax, setDurationMax] = useState("");
  const [exactMinutes, setExactMinutes] = useState("");
  const [exactSeconds, setExactSeconds] = useState("");
  // True while auto-fetching a searched call ID that isn't in the loaded window.
  const [lookupBusy, setLookupBusy] = useState(false);
  const { toast } = useToast();
  const { workspace } = useWorkspace();

  // Export the in-memory calls within the chosen date range to CSV. Excludes
  // ungraded/empty calls unless "Include empty / ungraded calls" is checked.
  // Variables + transcript come straight from the loaded list payload — Retell
  // list-calls already carries transcript_object + retell_llm_dynamic_variables
  // (the backfill path ingests off the same fields), so no per-call refetch.
  function handleExport() {
    const startMs = exportStart
      ? new Date(`${exportStart}T00:00:00`).getTime()
      : null;
    const endMs = exportEnd
      ? new Date(`${exportEnd}T23:59:59.999`).getTime()
      : null;

    const selected = calls.filter((c) => {
      if (!inExportDateRange(c.start_timestamp, startMs, endMs)) return false;
      if (!includeEmpty && !isExportableByDefault(c)) return false;
      return true;
    });

    if (selected.length === 0) {
      toast("No calls match the selected range", "info");
      return;
    }

    const filename = [EXPORT_FILENAME_PREFIX, exportStart, exportEnd]
      .filter(Boolean)
      .join("_");
    downloadCsv(
      [
        [...CSV_COLUMNS],
        ...selected.map((c) =>
          callToCsvRow(
            c,
            detailToExportFields(c as unknown as Record<string, unknown>),
            workspace
          )
        ),
      ],
      `${filename}.csv`
    );
    setExportOpen(false);
  }

  async function handleDownload(callId: string) {
    try {
      const res = await fetch(`/api/calls/${callId}`);
      if (!res.ok) throw new Error("Failed to fetch call data");
      const data = await res.json();
      downloadJson(data, `${callId}.json`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Download failed";
      toast(message, "error");
    }
  }

  // Reflect grade/note edits made in the call viewer without a refetch.
  function handleCallUpdated(
    callId: string,
    grade: number | null,
    note: string | null
  ) {
    setCalls((prev) =>
      prev.map((c) => (c.call_id === callId ? { ...c, grade, note } : c))
    );
  }

  // Reflect a manual "Grade call" result (from the row button or the viewer)
  // without a refetch — merges the full 0-100 grade fields into the row.
  function handleAiGraded(callId: string, grade: CallRowGrade) {
    setCalls((prev) =>
      prev.map((c) =>
        c.call_id === callId
          ? {
              ...c,
              rep_score: grade.rep_score,
              grade100: grade.grade100,
              ai_callout: grade.ai_callout,
              ai_note: grade.ai_note,
            }
          : c
      )
    );
  }

  useEffect(() => {
    // Load a window of recent calls once; the dropdown, search, sort, and
    // pagination all run over this full set so pagination happens after
    // filtering (not over Retell's unfiltered cursor stream).
    let cancelled = false;
    fetchCalls(`limit=${FETCH_LIMIT}`)
      .then((list) => {
        if (!cancelled) setCalls(list);
      })
      .catch((err) => {
        if (!cancelled) toast(err.message, "error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [toast]);

  // When the search text is a Retell call ID that isn't in the loaded window,
  // fetch that single call straight from Retell and inject it — so IDs from
  // outside the recent/range window are still findable. Debounced so we don't
  // fire while an ID is mid-paste/edit.
  useEffect(() => {
    const q = search.trim();
    if (!CALL_ID_RE.test(q) || calls.some((c) => c.call_id === q)) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setLookupBusy(true);
      fetchCalls(`call_id=${encodeURIComponent(q)}`)
        .then((list) => {
          if (cancelled || list.length === 0) return;
          setCalls((prev) =>
            prev.some((c) => c.call_id === list[0].call_id)
              ? prev
              : [list[0], ...prev]
          );
        })
        // Silent: the empty state already explains that no call was found.
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setLookupBusy(false);
        });
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setLookupBusy(false);
    };
  }, [search, calls]);

  // Load a from/to window from Retell, replacing the recent window (range mode).
  async function loadRange() {
    if (!rangeStart || !rangeEnd) return;
    const fromMs = new Date(`${rangeStart}T00:00:00`).getTime();
    const toMs = new Date(`${rangeEnd}T23:59:59.999`).getTime();
    setRangeOpen(false);
    setLoading(true);
    try {
      const list = await fetchCalls(`from=${fromMs}&to=${toMs}&limit=${FETCH_LIMIT}`);
      setCalls(list);
      setRange({ from: rangeStart, to: rangeEnd });
      setPage(1);
      setPlayingCallId(null);
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Failed to load range", "error");
    } finally {
      setLoading(false);
    }
  }

  function clearDuration() {
    setDurationMin("");
    setDurationMax("");
    setExactMinutes("");
    setExactSeconds("");
    setPage(1);
  }

  // Recomputes the exact target duration from the minutes/seconds fields
  // whenever either changes, setting min === max so the range filter matches
  // only that exact length.
  function applyExactDuration(minutesStr: string, secondsStr: string) {
    setExactMinutes(minutesStr);
    setExactSeconds(secondsStr);
    if (!minutesStr.trim() && !secondsStr.trim()) {
      setDurationMin("");
      setDurationMax("");
    } else {
      const total = (Number(minutesStr) || 0) * 60 + (Number(secondsStr) || 0);
      setDurationMin(String(total));
      setDurationMax(String(total));
    }
    setPage(1);
  }

  function formatDuration(totalSeconds: number): string {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    if (mins === 0) return `${secs}s`;
    if (secs === 0) return `${mins}m`;
    return `${mins}m ${secs}s`;
  }

  // Drop range mode and reload the default recent window.
  async function clearRange() {
    setLoading(true);
    try {
      const list = await fetchCalls(`limit=${FETCH_LIMIT}`);
      setCalls(list);
      setRange(null);
      setPage(1);
      setPlayingCallId(null);
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Failed to load calls", "error");
    } finally {
      setLoading(false);
    }
  }

  // Distinct users across the loaded window (calls placed from this tool).
  const users = useMemo(() => {
    const set = new Set<string>();
    for (const c of calls) if (c.user_email) set.add(c.user_email);
    return Array.from(set).sort();
  }, [calls]);

  // The calendar span actually present in the loaded window, so the export
  // date picker can only offer dates that have data behind them.
  const exportDateBounds = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const c of calls) {
      const ts = c.start_timestamp;
      if (ts == null) continue;
      if (ts < min) min = ts;
      if (ts > max) max = ts;
    }
    if (min === Infinity) return { min: "", max: "" };
    const toDay = (ms: number) => {
      const d = new Date(ms);
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${d.getFullYear()}-${m}-${day}`;
    };
    return { min: toDay(min), max: toDay(max) };
  }, [calls]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const minSec = durationMin.trim() ? Number(durationMin) : null;
    const maxSec = durationMax.trim() ? Number(durationMax) : null;
    // Phone numbers come back from Retell unformatted (e.g. "+17402810699"),
    // but people search using however they have the number saved — with
    // parens/dashes/spaces, with or without the country code. Compare
    // digits-only on both sides so punctuation never breaks the match.
    const qDigits = q.replace(/\D/g, "");
    let result = calls.filter((c) => {
      if (userFilter !== "all" && c.user_email !== userFilter) return false;
      if (minSec !== null || maxSec !== null) {
        const dur = callDurationSeconds(c);
        if (dur === null) return false;
        if (minSec !== null && dur < minSec) return false;
        if (maxSec !== null && dur > maxSec) return false;
      }
      if (!q) return true;
      return (
        c.call_id.toLowerCase().includes(q) ||
        c.agent_id?.toLowerCase().includes(q) ||
        c.agent_name?.toLowerCase().includes(q) ||
        c.call_type?.toLowerCase().includes(q) ||
        (qDigits.length > 0 && c.from_number?.replace(/\D/g, "").includes(qDigits)) ||
        (qDigits.length > 0 && c.to_number?.replace(/\D/g, "").includes(qDigits)) ||
        c.user_email?.toLowerCase().includes(q) ||
        c.note?.toLowerCase().includes(q)
      );
    });

    if (sort !== "newest") {
      // Ungraded calls sort to the bottom in both rating directions.
      const dir = sort === "rating-desc" ? -1 : 1;
      result = [...result].sort((a, b) => {
        const ga = a.grade ?? null;
        const gb = b.grade ?? null;
        if (ga === null && gb === null) return 0;
        if (ga === null) return 1;
        if (gb === null) return -1;
        return (ga - gb) * dir;
      });
    }

    return result;
  }, [calls, search, userFilter, sort, durationMin, durationMax]);

  const isFiltering =
    search.trim() !== "" ||
    userFilter !== "all" ||
    sort !== "newest" ||
    durationMin.trim() !== "" ||
    durationMax.trim() !== "";
  const isCallIdQuery = CALL_ID_RE.test(search.trim());

  // Paginate the filtered/sorted set, so pages reflect the active filters.
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="w-full p-6 lg:p-8">
      <div className="flex items-center gap-3 mb-6">
        <h1 className="font-semibold text-lg flex items-center gap-2">
          <Phone size={18} />
          Calls
        </h1>
        {!loading && (
          <span className="text-xs text-zinc-400">
            {isFiltering
              ? `${filtered.length} of ${calls.length}`
              : `${calls.length} call${calls.length === 1 ? "" : "s"}`}
          </span>
        )}
        {range && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 dark:bg-blue-950/40 px-2.5 py-1 text-xs font-medium text-blue-700 dark:text-blue-300">
            <Calendar size={12} />
            {range.from} → {range.to}
            <button
              onClick={clearRange}
              aria-label="Clear date range"
              className="hover:text-blue-900 dark:hover:text-blue-100"
            >
              <X size={13} />
            </button>
          </span>
        )}
        {(durationMin.trim() || durationMax.trim()) && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 dark:bg-blue-950/40 px-2.5 py-1 text-xs font-medium text-blue-700 dark:text-blue-300">
            <Clock size={12} />
            {durationMin === durationMax
              ? formatDuration(Number(durationMin))
              : `${durationMin.trim() ? formatDuration(Number(durationMin)) : "0s"} – ${
                  durationMax.trim() ? formatDuration(Number(durationMax)) : "∞"
                }`}
            <button
              onClick={clearDuration}
              aria-label="Clear duration filter"
              className="hover:text-blue-900 dark:hover:text-blue-100"
            >
              <X size={13} />
            </button>
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search by call ID, agent, type, number, or note..."
            className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 pl-9 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-zinc-400"
          />
          {lookupBusy ? (
            <Loader2
              size={15}
              className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-zinc-400"
            />
          ) : (
            search && (
              <button
                onClick={() => {
                  setSearch("");
                  setPage(1);
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
              >
                <X size={15} />
              </button>
            )
          )}
        </div>

        <label className="flex items-center gap-2 text-sm">
          <span className="text-zinc-500">User</span>
          <select
            value={userFilter}
            onChange={(e) => {
              setUserFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 max-w-[200px]"
          >
            <option value="all">All users</option>
            {users.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm">
          <span className="text-zinc-500">Sort</span>
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as SortKey);
              setPage(1);
            }}
            className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="newest">Newest first</option>
            <option value="rating-desc">Rating: high to low</option>
            <option value="rating-asc">Rating: low to high</option>
          </select>
        </label>

        <div className="relative">
          <button
            onClick={() => setDurationOpen((o) => !o)}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
              durationMin.trim() || durationMax.trim()
                ? "border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30"
                : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800"
            }`}
          >
            <Clock size={15} />
            Duration
          </button>
          {durationOpen && (
            <>
              <button
                type="button"
                aria-label="Close duration filter"
                onClick={() => setDurationOpen(false)}
                className="fixed inset-0 z-10 cursor-default"
              />
              <div className="absolute right-0 z-20 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-lg space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  {DURATION_PRESETS.map((preset) => {
                    const active =
                      durationMin === (preset.min?.toString() ?? "") &&
                      durationMax === (preset.max?.toString() ?? "");
                    return (
                      <button
                        key={preset.label}
                        onClick={() => {
                          setDurationMin(preset.min?.toString() ?? "");
                          setDurationMax(preset.max?.toString() ?? "");
                          setExactMinutes("");
                          setExactSeconds("");
                          setPage(1);
                        }}
                        className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                          active
                            ? "bg-blue-600 text-white"
                            : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-500">Exact duration</label>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex flex-1 items-center gap-1.5">
                      <input
                        type="number"
                        min={0}
                        value={exactMinutes}
                        onChange={(e) => applyExactDuration(e.target.value, exactSeconds)}
                        placeholder="0"
                        aria-label="Minutes"
                        className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-zinc-400"
                      />
                      <span className="text-xs text-zinc-400 shrink-0">min</span>
                    </div>
                    <div className="flex flex-1 items-center gap-1.5">
                      <input
                        type="number"
                        min={0}
                        max={59}
                        value={exactSeconds}
                        onChange={(e) => applyExactDuration(exactMinutes, e.target.value)}
                        placeholder="0"
                        aria-label="Seconds"
                        className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-zinc-400"
                      />
                      <span className="text-xs text-zinc-400 shrink-0">sec</span>
                    </div>
                  </div>
                </div>
                {(durationMin.trim() || durationMax.trim()) && (
                  <button
                    onClick={clearDuration}
                    className="w-full flex items-center justify-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                  >
                    <X size={15} />
                    Clear
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <div className="relative">
          <button
            onClick={() => setRangeOpen((o) => !o)}
            className="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
          >
            <Calendar size={15} />
            Date range
          </button>
          {rangeOpen && (
            <>
              <button
                type="button"
                aria-label="Close date range"
                onClick={() => setRangeOpen(false)}
                className="fixed inset-0 z-10 cursor-default"
              />
              <div className="absolute right-0 z-20 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-lg space-y-3">
                <p className="text-xs text-zinc-500">
                  Load calls from Retell in a date range (newest {FETCH_LIMIT}),
                  even ones outside the recent window.
                </p>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-zinc-500">Start date</label>
                  <input
                    type="date"
                    value={rangeStart}
                    max={rangeEnd || undefined}
                    onChange={(e) => setRangeStart(e.target.value)}
                    className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-zinc-500">End date</label>
                  <input
                    type="date"
                    value={rangeEnd}
                    min={rangeStart || undefined}
                    onChange={(e) => setRangeEnd(e.target.value)}
                    className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <button
                  onClick={loadRange}
                  disabled={!rangeStart || !rangeEnd}
                  className="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Calendar size={15} />
                  Load range
                </button>
              </div>
            </>
          )}
        </div>

        <div className="relative">
          <button
            onClick={() => setExportOpen((o) => !o)}
            className="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
          >
            <FileDown size={15} />
            Export
          </button>
          {exportOpen && (
            <>
              <button
                type="button"
                aria-label="Close export"
                onClick={() => setExportOpen(false)}
                className="fixed inset-0 z-10 cursor-default"
              />
              <div className="absolute right-0 z-20 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-lg space-y-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-zinc-500">Start date</label>
                  <input
                    type="date"
                    value={exportStart}
                    min={exportDateBounds.min}
                    max={exportEnd || exportDateBounds.max}
                    onChange={(e) => setExportStart(e.target.value)}
                    className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-zinc-500">End date</label>
                  <input
                    type="date"
                    value={exportEnd}
                    min={exportStart || exportDateBounds.min}
                    max={exportDateBounds.max}
                    onChange={(e) => setExportEnd(e.target.value)}
                    className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                  <input
                    type="checkbox"
                    checked={includeEmpty}
                    onChange={(e) => setIncludeEmpty(e.target.checked)}
                    className="rounded border-zinc-300 dark:border-zinc-600 text-blue-600 focus:ring-blue-500"
                  />
                  Include empty / ungraded calls
                </label>
                <button
                  onClick={handleExport}
                  className="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
                >
                  <Download size={15} />
                  Export CSV
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="animate-spin text-zinc-400" size={28} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8 text-zinc-500 text-sm">
          {isCallIdQuery && lookupBusy
            ? `Searching Retell for ${search.trim()}…`
            : isCallIdQuery
            ? `No call found for ${search.trim()}.`
            : calls.length === 0
            ? "No calls yet."
            : "No calls match your filters."}
        </div>
      ) : (
        <CallsTable
          calls={paged}
          playingCallId={playingCallId}
          onTogglePlay={(id) =>
            setPlayingCallId((prev) => (prev === id ? null : id))
          }
          onViewDetails={(id) => setViewingCallId(id)}
          onAiGraded={handleAiGraded}
        />
      )}

      {!loading && filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-3 mt-4">
          <button
            onClick={() => {
              setPage((p) => Math.max(1, p - 1));
              setPlayingCallId(null);
            }}
            disabled={page === 1}
            className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft size={15} />
            Previous
          </button>
          <span className="text-sm text-zinc-500">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => {
              setPage((p) => Math.min(totalPages, p + 1));
              setPlayingCallId(null);
            }}
            disabled={page >= totalPages}
            className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next
            <ChevronRight size={15} />
          </button>
        </div>
      )}

      {viewingCallId && (
        <CallViewer
          callId={viewingCallId}
          onClose={() => setViewingCallId(null)}
          onDownload={handleDownload}
          onUpdated={handleCallUpdated}
          onAiGraded={handleAiGraded}
        />
      )}
    </div>
  );
}

export default function CallsPage() {
  return (
    <ToastProvider>
      <CallsContent />
    </ToastProvider>
  );
}
