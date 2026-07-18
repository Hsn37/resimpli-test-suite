"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Download,
  Loader2,
  Pause,
  Play,
  Share2,
  Check,
} from "lucide-react";
import { useToast } from "@/components/Toast";
import AudioPlayer from "@/components/AudioPlayer";
import Stars from "@/components/Stars";
import { gradeCall } from "@/lib/callLog";
import { gradeBand, gradeBandClasses, CALLOUT_TEXT } from "@/lib/dashboard";
import type { CallRowGrade } from "@/lib/callGrade";
import { downloadRecording } from "@/lib/downloadRecording";

// One row of the shared calls table. Both /calls (Retell list) and the
// dashboard (ingested `calls`) map their data into this shape so the two
// surfaces render identical columns.
export interface CallRowData {
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
  // Full 0-100 grade (from call_grades) — the meaningful headline score.
  rep_score?: number | null;
  grade100?: number | null;
  ai_callout?: boolean;
  ai_note?: string | null;
}

// Shared labeled-score chip: a compact banded pill (Rep/Grade + value + /100).
const SCORE_CHIP =
  "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums";

// Shared `/share/<id>` path builder so the row Share button and the CSV export
// produce identical links. Caller prefixes window.location.origin.
export const SHARE_PATH_PREFIX = "/share";
export function sharePath(callId: string): string {
  return `${SHARE_PATH_PREFIX}/${callId}`;
}

// Number of <td> columns in a CallRow (used by the expanded audio row's colSpan).
const TABLE_COLSPAN = 10;

const STATUS_STYLES: Record<string, string> = {
  ended: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  ongoing: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
  error: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  registered: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
};

/**
 * Truncates `text` to one line in a fixed-width table cell; click to expand
 * to full, wrapped text (growing the row on the y axis) instead of the
 * column stretching or the table scrolling on the x axis.
 */
function ExpandableText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  // A ResizeObserver measures after layout (a plain effect can run too
  // early) and again whenever the column width changes.
  useEffect(() => {
    if (expanded) return;
    const el = ref.current;
    if (!el) return;
    const check = () => setTruncated(el.scrollWidth > el.clientWidth + 1);
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, expanded]);

  if (expanded) {
    return (
      <div>
        <span className="block whitespace-pre-wrap break-words">{text}</span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(false);
          }}
          className="mt-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
        >
          Show less
        </button>
      </div>
    );
  }

  return (
    <div
      onClick={(e) => {
        if (!truncated) return;
        e.stopPropagation();
        setExpanded(true);
      }}
      className={`group relative min-w-0 ${truncated ? "cursor-pointer" : ""}`}
    >
      <span
        ref={ref}
        className={`block truncate ${truncated ? "group-hover:invisible" : ""}`}
      >
        {text}
      </span>
      {truncated && (
        <span className="absolute inset-0 hidden items-center text-xs font-medium text-blue-600 dark:text-blue-400 group-hover:flex">
          View full
        </span>
      )}
    </div>
  );
}

function CallRow({
  call,
  isPlaying,
  onTogglePlay,
  onViewDetails,
  onAiGraded,
}: {
  call: CallRowData;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onViewDetails: () => void;
  onAiGraded: (callId: string, grade: CallRowGrade) => void;
}) {
  const [shared, setShared] = useState(false);
  const [grading, setGrading] = useState(false);
  const { toast } = useToast();

  async function handleGradeCall(e: MouseEvent) {
    e.stopPropagation();
    setGrading(true);
    try {
      const rowGrade = await gradeCall(call.call_id);
      onAiGraded(call.call_id, rowGrade);
      toast("Call graded", "success");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to grade call";
      toast(message, "error");
    } finally {
      setGrading(false);
    }
  }

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
        <td className="py-3 px-3 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-medium truncate">{call.agent_name ?? call.call_type ?? "Call"}</span>
            {call.call_status && (
              <span
                className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full shrink-0 ${statusClass}`}
              >
                {call.call_status}
              </span>
            )}
          </div>
          <div className="text-xs text-zinc-500 mt-0.5 truncate">{call.call_type ?? "Call"}</div>
          <div className="text-[11px] text-zinc-400 font-mono truncate mt-0.5">
            {call.call_id}
          </div>
        </td>
        <td className="py-3 px-3 text-zinc-600 dark:text-zinc-400 break-words">
          {call.start_timestamp
            ? new Date(call.start_timestamp).toLocaleString()
            : "Unknown time"}
        </td>
        <td className="py-3 px-3 text-zinc-600 dark:text-zinc-400 truncate">
          {duration !== null
            ? `${Math.floor(duration / 60)}m ${duration % 60}s`
            : "—"}
        </td>
        <td className="py-3 px-3 text-zinc-600 dark:text-zinc-400 min-w-0 break-words">
          {call.user_email ? (
            call.user_email
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
        <td className="py-3 px-3 text-zinc-600 dark:text-zinc-400 min-w-0">
          {call.note ? (
            <ExpandableText text={call.note} />
          ) : (
            <span className="text-zinc-300 dark:text-zinc-600">—</span>
          )}
        </td>
        <td className="py-3 px-3 whitespace-nowrap">
          {call.rep_score != null || call.grade100 != null ? (
            // A call_grades row: show both 0-100 metrics as banded, labeled chips.
            <div className="flex flex-col items-start gap-1">
              {call.rep_score != null && (
                <span className={`${SCORE_CHIP} ${gradeBandClasses(gradeBand(call.rep_score))}`}>
                  <span className="opacity-70 mr-1">Rep</span>
                  {Math.round(call.rep_score)}
                  <span className="opacity-60 ml-0.5">/100</span>
                </span>
              )}
              {call.grade100 != null && (
                <span className={`${SCORE_CHIP} ${gradeBandClasses(gradeBand(call.grade100))}`}>
                  <span className="opacity-70 mr-1">Grade</span>
                  {Math.round(call.grade100)}
                  <span className="opacity-60 ml-0.5">/100</span>
                </span>
              )}
            </div>
          ) : grading ? (
            <Loader2 className="animate-spin text-zinc-400" size={14} />
          ) : (
            <button
              onClick={handleGradeCall}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
            >
              Grade call
            </button>
          )}
        </td>
        <td className="py-3 px-3 min-w-0 text-zinc-600 dark:text-zinc-400">
          {call.ai_note ? (
            <div className="flex items-start gap-1.5 min-w-0">
              {call.ai_callout && (
                <AlertTriangle size={13} className={`shrink-0 mt-0.5 ${CALLOUT_TEXT}`} />
              )}
              <ExpandableText text={call.ai_note} />
            </div>
          ) : null}
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

/**
 * The shared calls table (icon · Call · Time · Duration · User · Rating · Note ·
 * AI Scores · AI Note · Actions). Presentational — the caller owns loading,
 * empty state, filtering, pagination, and the detail modal. Rendered on both
 * /calls and the dashboard so the two views stay identical.
 */
export default function CallsTable({
  calls,
  playingCallId,
  onTogglePlay,
  onViewDetails,
  onAiGraded,
}: {
  calls: CallRowData[];
  playingCallId: string | null;
  onTogglePlay: (callId: string) => void;
  onViewDetails: (callId: string) => void;
  onAiGraded: (callId: string, grade: CallRowGrade) => void;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-x-auto">
      <table className="w-full min-w-[1024px] text-sm border-collapse table-fixed">
        <colgroup>
          <col className="w-10" />
          <col className="w-48" />
          <col className="w-32" />
          <col className="w-20" />
          <col className="w-28" />
          <col className="w-16" />
          <col className="w-40" />
          <col className="w-28" />
          <col className="w-40" />
          <col className="w-32" />
        </colgroup>
        <thead>
          <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 text-center text-xs uppercase tracking-wide text-zinc-500">
            <th className="py-2.5 pl-4 pr-3 font-medium"></th>
            <th className="py-2.5 px-3 font-medium">Call</th>
            <th className="py-2.5 px-3 font-medium">Time</th>
            <th className="py-2.5 px-3 font-medium">Duration</th>
            <th className="py-2.5 px-3 font-medium">User</th>
            <th className="py-2.5 px-3 font-medium">Rating</th>
            <th className="py-2.5 px-3 font-medium">Note</th>
            <th className="py-2.5 px-3 font-medium">AI Scores</th>
            <th className="py-2.5 px-3 font-medium">AI Note</th>
            <th className="py-2.5 pl-3 pr-4 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {calls.map((call) => (
            <CallRow
              key={call.call_id}
              call={call}
              isPlaying={playingCallId === call.call_id}
              onTogglePlay={() => onTogglePlay(call.call_id)}
              onViewDetails={() => onViewDetails(call.call_id)}
              onAiGraded={onAiGraded}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
