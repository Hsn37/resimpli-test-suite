"use client";

import { useEffect, useState } from "react";
import { X, Download, Loader2, Copy, Check } from "lucide-react";
import { useToast } from "./Toast";
import CallDetailBody, {
  CALL_DETAIL_TABS,
  type CallDetailTab,
} from "./CallDetailBody";

interface Props {
  callId: string;
  onClose: () => void;
  onDownload: (callId: string) => void;
}

export default function CallViewer({ callId, onClose, onDownload }: Props) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<CallDetailTab>("transcript");
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetch(`/api/calls/${callId}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch call");
        return res.json();
      })
      .then(setData)
      .catch((err) => toast(err.message, "error"))
      .finally(() => setLoading(false));
  }, [callId, toast]);

  function copyId() {
    navigator.clipboard.writeText(callId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-white dark:bg-zinc-950 rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col m-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
          <div className="min-w-0">
            <h2 className="font-semibold text-lg">Call Details</h2>
            <button
              onClick={copyId}
              className="flex items-center gap-1 text-xs font-mono text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            >
              {copied ? <Check size={10} /> : <Copy size={10} />}
              {callId}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onDownload(callId)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-zinc-300 dark:border-zinc-700 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
            >
              <Download size={14} />
              Download
            </button>
            <button
              onClick={onClose}
              className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center py-20">
            <Loader2 className="animate-spin text-zinc-400" size={28} />
          </div>
        ) : !data ? (
          <div className="flex-1 flex items-center justify-center py-20 text-zinc-500 text-sm">
            Failed to load call data.
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div className="flex gap-1 px-5 pt-3 shrink-0">
              {CALL_DETAIL_TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`px-3 py-1.5 text-sm rounded-t-lg transition-colors ${
                    tab === t.key
                      ? "bg-zinc-100 dark:bg-zinc-900 font-medium text-zinc-900 dark:text-zinc-100"
                      : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0">
              <CallDetailBody data={data} tab={tab} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
