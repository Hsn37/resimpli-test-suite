"use client";

import { useState, useEffect } from "react";
import { Clock, Download, Trash2 } from "lucide-react";
import { getCallHistory, clearCallHistory, type CallRecord } from "@/lib/callHistory";
import { useToast } from "./Toast";

interface Props {
  onDownload: (callId: string) => void;
}

export default function CallHistory({ onDownload }: Props) {
  const [history, setHistory] = useState<CallRecord[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    setHistory(getCallHistory());
  }, []);

  function handleClear() {
    clearCallHistory();
    setHistory([]);
    toast("Call history cleared", "info");
  }

  if (history.length === 0) {
    return (
      <div className="text-center py-8 text-zinc-500 text-sm">
        No calls yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide">
          Call History
        </h3>
        <button
          onClick={handleClear}
          className="text-xs text-zinc-400 hover:text-red-500 flex items-center gap-1 transition-colors"
        >
          <Trash2 size={12} />
          Clear
        </button>
      </div>
      {history.map((record) => (
        <div
          key={record.callId}
          className="flex items-center gap-3 p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 text-sm"
        >
          <Clock size={14} className="shrink-0 text-zinc-400" />
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate">{record.agentName}</div>
            <div className="text-xs text-zinc-500">
              {record.mode} &middot;{" "}
              {new Date(record.timestamp).toLocaleString()} &middot;{" "}
              {Math.floor(record.duration / 60)}m {record.duration % 60}s
            </div>
            <div className="text-xs text-zinc-400 font-mono truncate">
              {record.callId}
            </div>
          </div>
          <button
            onClick={() => onDownload(record.callId)}
            className="shrink-0 text-zinc-400 hover:text-blue-500 transition-colors"
          >
            <Download size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
