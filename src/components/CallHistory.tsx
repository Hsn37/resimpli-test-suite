"use client";

import { useState, useEffect } from "react";
import { Clock, Download, Trash2, Eye, Pencil, Check, X } from "lucide-react";
import { getCallHistory, clearCallHistory, updateCallRecord, type CallRecord } from "@/lib/callHistory";
import { patchCallGrade } from "@/lib/sheet";
import { useToast } from "./Toast";
import CallViewer from "./CallViewer";
import Stars from "./Stars";

interface Props {
  onDownload: (callId: string) => void;
}

export default function CallHistory({ onDownload }: Props) {
  const [history, setHistory] = useState<CallRecord[]>([]);
  const [viewingCallId, setViewingCallId] = useState<string | null>(null);
  const [editingCallId, setEditingCallId] = useState<string | null>(null);
  const [editGrade, setEditGrade] = useState(0);
  const [editNote, setEditNote] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    setHistory(getCallHistory());
  }, []);

  function handleClear() {
    clearCallHistory();
    setHistory([]);
    toast("Call history cleared", "info");
  }

  function startEdit(record: CallRecord) {
    setEditingCallId(record.callId);
    setEditGrade(record.grade ?? 0);
    setEditNote(record.note ?? "");
  }

  function cancelEdit() {
    setEditingCallId(null);
  }

  function saveEdit(callId: string) {
    const grade = editGrade || undefined;
    const note = editNote.trim() || undefined;

    updateCallRecord(callId, { grade, note });
    setHistory(getCallHistory());
    setEditingCallId(null);
    toast("Saved", "success");

    patchCallGrade(callId, grade, note);
  }

  if (history.length === 0) {
    return (
      <div className="text-center py-8 text-zinc-500 text-sm">
        No calls yet.
      </div>
    );
  }

  return (
    <>
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
            className="rounded-lg border border-zinc-200 dark:border-zinc-800 text-sm transition-colors"
          >
            {/* Main row */}
            <div
              onClick={() =>
                editingCallId !== record.callId &&
                setViewingCallId(record.callId)
              }
              className="flex items-center gap-3 p-3 cursor-pointer hover:border-zinc-400 dark:hover:border-zinc-600"
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
                {/* Grade + note preview */}
                {(record.grade || record.note) && editingCallId !== record.callId && (
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
                    startEdit(record);
                  }}
                  className="text-zinc-400 hover:text-yellow-500 transition-colors"
                  title="Grade / note"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setViewingCallId(record.callId);
                  }}
                  className="text-zinc-400 hover:text-blue-500 transition-colors"
                >
                  <Eye size={15} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDownload(record.callId);
                  }}
                  className="text-zinc-400 hover:text-blue-500 transition-colors"
                >
                  <Download size={15} />
                </button>
              </div>
            </div>

            {/* Inline edit form */}
            {editingCallId === record.callId && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="border-t border-zinc-200 dark:border-zinc-800 px-3 pb-3 pt-2 space-y-2"
              >
                <Stars value={editGrade} size={14} onChange={setEditGrade} />
                <textarea
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  placeholder="Add a note..."
                  rows={2}
                  className="w-full text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-zinc-400"
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => saveEdit(record.callId)}
                    className="flex items-center gap-1 text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded-md transition-colors"
                  >
                    <Check size={12} /> Save
                  </button>
                  <button
                    onClick={cancelEdit}
                    className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-600 px-2 py-1 rounded-md transition-colors"
                  >
                    <X size={12} /> Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {viewingCallId && (
        <CallViewer
          callId={viewingCallId}
          onClose={() => setViewingCallId(null)}
          onDownload={onDownload}
        />
      )}
    </>
  );
}
