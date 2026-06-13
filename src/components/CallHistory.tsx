"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Clock, Download, Eye, ArrowRight, Loader2 } from "lucide-react";
import CallViewer from "./CallViewer";
import Stars from "./Stars";

interface RecentCall {
  callId: string;
  agentId: string | null;
  agentName: string;
  mode: string | null;
  timestamp: number | null;
  duration: number | null;
  grade: number | null;
  note: string | null;
}

interface Props {
  onDownload: (callId: string) => void;
}

export default function CallHistory({ onDownload }: Props) {
  const [history, setHistory] = useState<RecentCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewingCallId, setViewingCallId] = useState<string | null>(null);

  useEffect(() => {
    // Load this user's recent calls from the DB on mount. Remounting via the
    // parent's `key` (after each call) re-runs this and refreshes the list.
    fetch("/api/calls/recent")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load recent calls");
        return res.json();
      })
      .then((data) => setHistory(Array.isArray(data) ? data : []))
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  }, []);

  // Reflect grade/note edits made in the call viewer without a refetch.
  function handleUpdated(
    callId: string,
    grade: number | null,
    note: string | null
  ) {
    setHistory((prev) =>
      prev.map((r) => (r.callId === callId ? { ...r, grade, note } : r))
    );
  }

  return (
    <>
      <div className="space-y-2">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide">
            Recent Calls
          </h3>
        </div>
        <Link
          href="/calls"
          className="mb-3 flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 transition-colors"
        >
          View all calls
          <ArrowRight size={12} />
        </Link>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="animate-spin text-zinc-400" size={20} />
          </div>
        ) : history.length === 0 ? (
          <div className="text-center py-8 text-zinc-500 text-sm">
            No calls yet.
          </div>
        ) : (
          history.map((record) => (
            <div
              key={record.callId}
              className="rounded-lg border border-zinc-200 dark:border-zinc-800 text-sm transition-colors"
            >
              <div
                onClick={() => setViewingCallId(record.callId)}
                className="flex items-center gap-3 p-3 cursor-pointer hover:border-zinc-400 dark:hover:border-zinc-600"
              >
                <Clock size={14} className="shrink-0 text-zinc-400" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{record.agentName}</div>
                  <div className="text-xs text-zinc-500">
                    {record.mode ?? "Call"}
                    {record.timestamp != null && (
                      <> &middot; {new Date(record.timestamp).toLocaleString()}</>
                    )}
                    {record.duration != null && (
                      <>
                        {" "}
                        &middot; {Math.floor(record.duration / 60)}m{" "}
                        {record.duration % 60}s
                      </>
                    )}
                  </div>
                  <div className="text-xs text-zinc-400 font-mono truncate">
                    {record.callId}
                  </div>
                  {/* Grade + note preview */}
                  {(record.grade || record.note) && (
                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                      {record.grade && (
                        <Stars
                          value={record.grade}
                          size={12}
                          emptyClass="text-zinc-200 dark:text-zinc-700"
                        />
                      )}
                      {record.note && (
                        <span className="text-xs text-zinc-500 italic truncate max-w-[200px]">
                          {record.note}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setViewingCallId(record.callId);
                    }}
                    className="text-zinc-400 hover:text-blue-500 transition-colors"
                    title="View details"
                  >
                    <Eye size={15} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDownload(record.callId);
                    }}
                    className="text-zinc-400 hover:text-blue-500 transition-colors"
                    title="Download"
                  >
                    <Download size={15} />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {viewingCallId && (
        <CallViewer
          callId={viewingCallId}
          onClose={() => setViewingCallId(null)}
          onDownload={onDownload}
          onUpdated={handleUpdated}
        />
      )}
    </>
  );
}
