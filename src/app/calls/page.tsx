"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowDownLeft,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Download,
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
import { downloadJson, downloadRecording } from "@/lib/downloadRecording";

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
}

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
  const { toast } = useToast();

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
    const url = `${window.location.origin}/share/${call.call_id}`;
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
          {call.from_number || call.to_number ? (
            <>
              {call.from_number ?? "—"} <span className="text-zinc-400">&rarr;</span>{" "}
              {call.to_number ?? "—"}
            </>
          ) : (
            "—"
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
          <td colSpan={6} className="px-4 pb-3">
            <AudioPlayer src={call.recording_url} onEnded={onTogglePlay} />
          </td>
        </tr>
      )}
    </>
  );
}

const PAGE_SIZE = 50;

function CallsContent() {
  const [calls, setCalls] = useState<RetellCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasNext, setHasNext] = useState(false);
  const [page, setPage] = useState(1);
  // pageCursors[i] = pagination_key to fetch page i+2 (i.e. cursor at the end of page i+1)
  const [pageCursors, setPageCursors] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [playingCallId, setPlayingCallId] = useState<string | null>(null);
  const [viewingCallId, setViewingCallId] = useState<string | null>(null);
  const { toast } = useToast();

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

  useEffect(() => {
    // Reset list state when navigating to a new page, then fetch it.
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setLoading(true);
    setPlayingCallId(null);
    const cursor = page > 1 ? pageCursors[page - 2] : undefined;
    const url = cursor
      ? `/api/calls/list?limit=${PAGE_SIZE}&pagination_key=${encodeURIComponent(cursor)}`
      : `/api/calls/list?limit=${PAGE_SIZE}`;

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch calls");
        return res.json();
      })
      .then((data) => {
        const list: RetellCall[] = Array.isArray(data) ? data : data.calls ?? [];
        setCalls(list);
        setHasNext(list.length === PAGE_SIZE);
        if (list.length === PAGE_SIZE) {
          const lastCallId = list[list.length - 1].call_id;
          setPageCursors((prev) => {
            const next = [...prev];
            next[page - 1] = lastCallId;
            return next;
          });
        }
      })
      .catch((err) => toast(err.message, "error"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return calls;
    return calls.filter(
      (c) =>
        c.call_id.toLowerCase().includes(q) ||
        c.agent_id?.toLowerCase().includes(q) ||
        c.agent_name?.toLowerCase().includes(q) ||
        c.call_type?.toLowerCase().includes(q) ||
        c.from_number?.toLowerCase().includes(q) ||
        c.to_number?.toLowerCase().includes(q)
    );
  }, [calls, search]);

  return (
    <div className="max-w-6xl mx-auto p-8">
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
            {search
              ? `${filtered.length} of ${calls.length} on this page`
              : `Page ${page}`}
          </span>
        )}
      </div>

      <div className="relative mb-4 max-w-md">
        <Search
          size={15}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none"
        />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by call ID, agent, type, or number..."
          className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 pl-9 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-zinc-400"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
          >
            <X size={15} />
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="animate-spin text-zinc-400" size={28} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8 text-zinc-500 text-sm">
          {calls.length === 0 ? "No calls yet." : "No calls match your search."}
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
                <th className="py-2.5 px-3 font-medium">Numbers</th>
                <th className="py-2.5 pl-3 pr-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((call) => (
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

      {!loading && !search && (calls.length > 0 || page > 1) && (
        <div className="flex items-center justify-center gap-3 mt-4">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft size={15} />
            Previous
          </button>
          <span className="text-sm text-zinc-500">Page {page}</span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasNext}
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
