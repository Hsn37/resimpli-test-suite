"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowDownLeft,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Download,
  FileDown,
  Loader2,
  Pause,
  Phone,
  Play,
  Search,
  Share2,
  Check,
  X,
} from "lucide-react";
import { ToastProvider, useToast } from "@/components/Toast";
import AudioPlayer from "@/components/AudioPlayer";
import CallViewer from "@/components/CallViewer";
import Stars from "@/components/Stars";
import {
  downloadCsv,
  downloadJson,
  downloadRecording,
} from "@/lib/downloadRecording";

interface RetellCall {
  call_id: string;
  agent_id?: string;
  agent_name?: string | null;
  call_type?: string;
  direction?: string;
  start_timestamp?: number;
  end_timestamp?: number;
  recording_url?: string;
  call_status?: string;
  from_number?: string;
  to_number?: string;
  grade?: number | null;
  note?: string | null;
  user_email?: string | null;
  ai_grade?: { score: number; note: string } | null;
}

type SortKey = "newest" | "rating-desc" | "rating-asc";

// Shared `/share/<id>` path builder so the row Share button and the CSV export
// produce identical links. Caller prefixes window.location.origin.
const SHARE_PATH_PREFIX = "/share";
function sharePath(callId: string): string {
  return `${SHARE_PATH_PREFIX}/${callId}`;
}

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
  "note",
  "call_status",
  "from_number",
  "to_number",
  "recording_url",
  "share_link",
  "variables",
  "transcript",
] as const;

// Transcript + variables aren't in the list payload, so the export fetches each
// call's full detail. How many of those /api/calls/[id] fetches run at once.
const EXPORT_FETCH_CONCURRENCY = 6;

// Default export excludes calls that are ungraded OR have no recording. The
// "Include empty / ungraded calls" checkbox overrides this.
function isExportableByDefault(call: RetellCall): boolean {
  return call.grade != null && !!call.recording_url;
}

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

const EMPTY_EXPORT_DETAIL: ExportDetail = { variables: "", transcript: "" };

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

// Fetch one call's full detail for export. Failure-tolerant so a single bad
// call never aborts the whole CSV — it just exports blank variables/transcript.
async function fetchExportDetail(callId: string): Promise<ExportDetail> {
  try {
    const res = await fetch(`/api/calls/${callId}`);
    if (!res.ok) throw new Error("Failed to fetch call detail");
    return detailToExportFields(await res.json());
  } catch {
    return EMPTY_EXPORT_DETAIL;
  }
}

// One CSV data row in CSV_COLUMNS order. Escaping is handled by downloadCsv.
function callToCsvRow(
  call: RetellCall,
  detail: ExportDetail
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
    call.note ?? "",
    call.call_status ?? "",
    call.from_number ?? "",
    call.to_number ?? "",
    call.recording_url ?? "",
    `${window.location.origin}${sharePath(call.call_id)}`,
    detail.variables,
    detail.transcript,
  ];
}

// Number of <td> columns in a CallRow (used by the expanded audio row's colSpan).
const TABLE_COLSPAN = 9;

const STATUS_STYLES: Record<string, string> = {
  ended: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  ongoing: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
  error: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  registered: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
};

function CallRow({
  call,
  isPlaying,
  onTogglePlay,
  onViewDetails,
}: {
  call: RetellCall;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onViewDetails: () => void;
}) {
  const [shared, setShared] = useState(false);
  const [noteExpanded, setNoteExpanded] = useState(false);
  const [noteTruncated, setNoteTruncated] = useState(false);
  const noteRef = useRef<HTMLSpanElement>(null);
  const { toast } = useToast();

  // Detect whether the collapsed note actually overflows, so we only offer
  // "View full note" when there's something hidden. A ResizeObserver measures
  // after the table has laid out (a plain effect can run too early) and again
  // whenever the column width changes.
  useEffect(() => {
    if (noteExpanded) return;
    const el = noteRef.current;
    if (!el) return;
    const check = () => setNoteTruncated(el.scrollWidth > el.clientWidth + 1);
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [call.note, noteExpanded]);

  const duration =
    call.start_timestamp && call.end_timestamp
      ? Math.round((call.end_timestamp - call.start_timestamp) / 1000)
      : null;

  function handlePlay() {
    if (!call.recording_url) {
      toast("No recording available for this call", "info");
      return;
    }
    onTogglePlay();
  }

  function handleShare() {
    const url = `${window.location.origin}${sharePath(call.call_id)}`;
    navigator.clipboard.writeText(url);
    setShared(true);
    toast("Share link copied to clipboard", "success");
    setTimeout(() => setShared(false), 2000);
  }

  function handleDownload() {
    if (!call.recording_url) {
      toast("No recording available for this call", "info");
      return;
    }
    downloadRecording(call.recording_url, call.call_id);
  }

  const statusClass =
    STATUS_STYLES[call.call_status ?? ""] ??
    "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";

  const DirectionIcon =
    call.direction === "outbound" ? ArrowUpRight : ArrowDownLeft;

  return (
    <>
      <tr
        onClick={onViewDetails}
        className={`border-b border-zinc-100 dark:border-zinc-900 transition-colors cursor-pointer ${
          isPlaying
            ? "bg-blue-50/60 dark:bg-blue-950/20"
            : "hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
        }`}
      >
        <td className="py-3 pl-4 pr-3 w-10">
          <div className="w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-500">
            <DirectionIcon size={15} />
          </div>
        </td>
        <td className="py-3 px-3">
          <div className="flex items-center gap-2">
            <span className="font-medium">{call.agent_name ?? call.call_type ?? "Call"}</span>
            {call.call_status && (
              <span
                className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full shrink-0 ${statusClass}`}
              >
                {call.call_status}
              </span>
            )}
          </div>
          <div className="text-xs text-zinc-500 mt-0.5">{call.call_type ?? "Call"}</div>
          <div className="text-[11px] text-zinc-400 font-mono truncate mt-0.5 max-w-[220px]">
            {call.call_id}
          </div>
        </td>
        <td className="py-3 px-3 text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
          {call.start_timestamp
            ? new Date(call.start_timestamp).toLocaleString()
            : "Unknown time"}
        </td>
        <td className="py-3 px-3 text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
          {duration !== null
            ? `${Math.floor(duration / 60)}m ${duration % 60}s`
            : "—"}
        </td>
        <td className="py-3 px-3 text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
          {call.user_email ? (
            <span className="truncate inline-block max-w-[160px] align-bottom" title={call.user_email}>
              {call.user_email}
            </span>
          ) : (
            // No app user — call originated inside Retell, not from our tool.
            <span className="text-zinc-400 dark:text-zinc-500">Retell</span>
          )}
        </td>
        <td className="py-3 px-3 whitespace-nowrap">
          {call.grade ? (
            <Stars value={call.grade} size={13} emptyClass="text-zinc-200 dark:text-zinc-700" />
          ) : (
            <span className="text-zinc-300 dark:text-zinc-600">—</span>
          )}
        </td>
        <td className="py-3 px-3 whitespace-nowrap" title={call.ai_grade?.note}>
          {call.ai_grade ? (
            <Stars
              value={call.ai_grade.score}
              size={13}
              filledClass="fill-purple-500 text-purple-500"
              emptyClass="text-zinc-200 dark:text-zinc-700"
            />
          ) : (
            <span className="text-zinc-300 dark:text-zinc-600">—</span>
          )}
        </td>
        <td className="py-3 px-3 text-zinc-600 dark:text-zinc-400">
          {call.note ? (
            noteExpanded ? (
              <div className="w-[200px]">
                <span className="block italic whitespace-pre-wrap break-words">
                  {call.note}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setNoteExpanded(false);
                  }}
                  className="mt-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Show less
                </button>
              </div>
            ) : (
              <div
                onClick={(e) => {
                  if (!noteTruncated) return;
                  e.stopPropagation();
                  setNoteExpanded(true);
                }}
                className={`group relative max-w-[200px] ${
                  noteTruncated ? "cursor-pointer" : ""
                }`}
              >
                <span
                  ref={noteRef}
                  className={`block truncate italic ${
                    noteTruncated ? "group-hover:invisible" : ""
                  }`}
                >
                  {call.note}
                </span>
                {noteTruncated && (
                  <span className="absolute inset-0 hidden items-center text-xs not-italic font-medium text-blue-600 dark:text-blue-400 group-hover:flex">
                    View full note
                  </span>
                )}
              </div>
            )
          ) : (
            <span className="text-zinc-300 dark:text-zinc-600">—</span>
          )}
        </td>
        <td
          className="py-3 pl-3 pr-4 text-right whitespace-nowrap"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-end gap-1">
            <button
              onClick={handlePlay}
              className={`w-8 h-8 flex items-center justify-center rounded-full transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                isPlaying
                  ? "bg-blue-600 text-white hover:bg-blue-700"
                  : "text-zinc-400 hover:text-blue-600 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
              title={call.recording_url ? "Play recording" : "No recording available"}
              disabled={!call.recording_url}
            >
              {isPlaying ? <Pause size={15} /> : <Play size={15} />}
            </button>
            <button
              onClick={handleShare}
              className="w-8 h-8 flex items-center justify-center rounded-full text-zinc-400 hover:text-blue-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              title="Copy share link"
            >
              {shared ? <Check size={15} /> : <Share2 size={15} />}
            </button>
            <button
              onClick={handleDownload}
              className="w-8 h-8 flex items-center justify-center rounded-full text-zinc-400 hover:text-blue-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title={call.recording_url ? "Download recording" : "No recording available"}
              disabled={!call.recording_url}
            >
              <Download size={15} />
            </button>
          </div>
        </td>
      </tr>
      {isPlaying && call.recording_url && (
        <tr
          className="bg-blue-50/60 dark:bg-blue-950/20"
          onClick={(e) => e.stopPropagation()}
        >
          <td colSpan={TABLE_COLSPAN} className="px-4 pb-3">
            <AudioPlayer src={call.recording_url} onEnded={onTogglePlay} />
          </td>
        </tr>
      )}
    </>
  );
}

const PAGE_SIZE = 50;
// How many recent calls to load up front. The page filters, sorts, and
// paginates over this whole window client-side (Retell owns the calls; our DB
// owns user/grade/note, so cross-field filtering can't be a single query).
const FETCH_LIMIT = 1000;

function CallsContent() {
  const [calls, setCalls] = useState<RetellCall[]>([]);
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
  const [exporting, setExporting] = useState(false);
  const { toast } = useToast();

  // Export the in-memory calls within the chosen date range to CSV. Excludes
  // ungraded/empty calls unless "Include empty / ungraded calls" is checked.
  // Each call's variables + transcript are fetched from its full detail
  // (bounded concurrency), since the list payload doesn't carry them.
  async function handleExport() {
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

    setExporting(true);
    try {
      const details: ExportDetail[] = new Array(selected.length);
      for (let i = 0; i < selected.length; i += EXPORT_FETCH_CONCURRENCY) {
        const batch = selected.slice(i, i + EXPORT_FETCH_CONCURRENCY);
        const resolved = await Promise.all(
          batch.map((c) => fetchExportDetail(c.call_id))
        );
        resolved.forEach((d, j) => (details[i + j] = d));
      }

      const filename = [EXPORT_FILENAME_PREFIX, exportStart, exportEnd]
        .filter(Boolean)
        .join("_");
      downloadCsv(
        [[...CSV_COLUMNS], ...selected.map((c, i) => callToCsvRow(c, details[i]))],
        `${filename}.csv`
      );
      setExportOpen(false);
    } finally {
      setExporting(false);
    }
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

  useEffect(() => {
    // Load a window of recent calls once; the dropdown, search, sort, and
    // pagination all run over this full set so pagination happens after
    // filtering (not over Retell's unfiltered cursor stream).
    let cancelled = false;
    fetch(`/api/calls/list?limit=${FETCH_LIMIT}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch calls");
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        const list: RetellCall[] = Array.isArray(data) ? data : data.calls ?? [];
        setCalls(list);
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

  // Distinct users across the loaded window (calls placed from this tool).
  const users = useMemo(() => {
    const set = new Set<string>();
    for (const c of calls) if (c.user_email) set.add(c.user_email);
    return Array.from(set).sort();
  }, [calls]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let result = calls.filter((c) => {
      if (userFilter !== "all" && c.user_email !== userFilter) return false;
      if (!q) return true;
      return (
        c.call_id.toLowerCase().includes(q) ||
        c.agent_id?.toLowerCase().includes(q) ||
        c.agent_name?.toLowerCase().includes(q) ||
        c.call_type?.toLowerCase().includes(q) ||
        c.from_number?.toLowerCase().includes(q) ||
        c.to_number?.toLowerCase().includes(q) ||
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
  }, [calls, search, userFilter, sort]);

  const isFiltering = search.trim() !== "" || userFilter !== "all" || sort !== "newest";

  // Paginate the filtered/sorted set, so pages reflect the active filters.
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="max-w-7xl mx-auto p-8">
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/"
          className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
        >
          <ArrowLeft size={18} />
        </Link>
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
          {search && (
            <button
              onClick={() => {
                setSearch("");
                setPage(1);
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            >
              <X size={15} />
            </button>
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
                    onChange={(e) => setExportStart(e.target.value)}
                    className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-zinc-500">End date</label>
                  <input
                    type="date"
                    value={exportEnd}
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
                  disabled={exporting}
                  className="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {exporting ? (
                    <>
                      <Loader2 size={15} className="animate-spin" />
                      Exporting…
                    </>
                  ) : (
                    <>
                      <Download size={15} />
                      Export CSV
                    </>
                  )}
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
          {calls.length === 0 ? "No calls yet." : "No calls match your filters."}
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 text-left text-xs uppercase tracking-wide text-zinc-500">
                <th className="py-2.5 pl-4 pr-3 font-medium"></th>
                <th className="py-2.5 px-3 font-medium">Call</th>
                <th className="py-2.5 px-3 font-medium">Time</th>
                <th className="py-2.5 px-3 font-medium">Duration</th>
                <th className="py-2.5 px-3 font-medium">User</th>
                <th className="py-2.5 px-3 font-medium">Rating</th>
                <th className="py-2.5 px-3 font-medium">AI Grade</th>
                <th className="py-2.5 px-3 font-medium">Note</th>
                <th className="py-2.5 pl-3 pr-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((call) => (
                <CallRow
                  key={call.call_id}
                  call={call}
                  isPlaying={playingCallId === call.call_id}
                  onTogglePlay={() =>
                    setPlayingCallId((prev) =>
                      prev === call.call_id ? null : call.call_id
                    )
                  }
                  onViewDetails={() => setViewingCallId(call.call_id)}
                />
              ))}
            </tbody>
          </table>
        </div>
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
