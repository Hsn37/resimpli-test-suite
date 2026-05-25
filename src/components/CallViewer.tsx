"use client";

import { useEffect, useState } from "react";
import { X, Download, Loader2, Copy, Check } from "lucide-react";
import { useToast } from "./Toast";

interface Props {
  callId: string;
  onClose: () => void;
  onDownload: (callId: string) => void;
}

export default function CallViewer({ callId, onClose, onDownload }: Props) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"transcript" | "tools" | "analysis" | "raw">("transcript");
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

  const transcript = (data?.transcript as string) || "";
  const transcriptObj = data?.transcript_object as Array<{ role: string; content: string }> | undefined;
  const toolCalls = (data?.tool_calls ?? data?.tool_call_result) as Array<Record<string, unknown>> | undefined;
  const analysis = data?.call_analysis as Record<string, unknown> | undefined;

  const tabs = [
    { key: "transcript" as const, label: "Transcript" },
    { key: "tools" as const, label: "Tool Calls" },
    { key: "analysis" as const, label: "Analysis" },
    { key: "raw" as const, label: "Raw JSON" },
  ];

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
              {tabs.map((t) => (
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
              {tab === "transcript" && (
                <div className="space-y-3">
                  {transcriptObj && transcriptObj.length > 0 ? (
                    transcriptObj.map((msg, i) => (
                      <div
                        key={i}
                        className={`flex ${msg.role === "agent" ? "justify-start" : "justify-end"}`}
                      >
                        <div
                          className={`max-w-[80%] px-3 py-2 rounded-lg text-sm ${
                            msg.role === "agent"
                              ? "bg-zinc-100 dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200"
                              : "bg-blue-600 text-white"
                          }`}
                        >
                          <div className="text-[10px] font-semibold uppercase mb-0.5 opacity-60">
                            {msg.role}
                          </div>
                          {msg.content}
                        </div>
                      </div>
                    ))
                  ) : transcript ? (
                    <pre className="text-sm whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
                      {transcript}
                    </pre>
                  ) : (
                    <p className="text-sm text-zinc-500">No transcript available.</p>
                  )}
                </div>
              )}

              {tab === "tools" && (
                <div className="space-y-3">
                  {toolCalls && toolCalls.length > 0 ? (
                    toolCalls.map((tc, i) => (
                      <div
                        key={i}
                        className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-3"
                      >
                        <pre className="text-xs font-mono whitespace-pre-wrap text-zinc-700 dark:text-zinc-300 overflow-x-auto">
                          {JSON.stringify(tc, null, 2)}
                        </pre>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-zinc-500">No tool calls recorded.</p>
                  )}
                </div>
              )}

              {tab === "analysis" && (
                <div>
                  {analysis && Object.keys(analysis).length > 0 ? (
                    <div className="space-y-2">
                      {Object.entries(analysis).map(([key, value]) => (
                        <div
                          key={key}
                          className="flex gap-3 py-1.5 border-b border-zinc-100 dark:border-zinc-900 last:border-0"
                        >
                          <span className="text-xs font-mono font-semibold text-zinc-600 dark:text-zinc-400 w-[180px] shrink-0 break-all">
                            {key}
                          </span>
                          <span className="text-sm text-zinc-800 dark:text-zinc-200 min-w-0">
                            {typeof value === "string" ? value : JSON.stringify(value)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-zinc-500">No analysis available.</p>
                  )}
                </div>
              )}

              {tab === "raw" && (
                <pre className="text-xs font-mono whitespace-pre-wrap text-zinc-700 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-900 rounded-lg p-4 overflow-x-auto">
                  {JSON.stringify(data, null, 2)}
                </pre>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
