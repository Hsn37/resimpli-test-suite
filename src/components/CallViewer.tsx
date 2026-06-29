"use client";

import { useEffect, useState } from "react";
import { X, Download, Loader2, Copy, Check, Pencil } from "lucide-react";
import { useToast } from "./Toast";
import { patchCallGrade } from "@/lib/callLog";
import CallDetailBody, {
  CALL_DETAIL_TABS,
  type CallDetailTab,
} from "./CallDetailBody";
import Stars from "./Stars";

interface Props {
  callId: string;
  onClose: () => void;
  onDownload: (callId: string) => void;
  /** Called after grade/note are saved, so parent lists can stay in sync. */
  onUpdated?: (callId: string, grade: number | null, note: string | null) => void;
}

export default function CallViewer({
  callId,
  onClose,
  onDownload,
  onUpdated,
}: Props) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<CallDetailTab>("transcript");
  const [copied, setCopied] = useState(false);
  const [grade, setGrade] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editGrade, setEditGrade] = useState(0);
  const [editNote, setEditNote] = useState("");
  const { toast } = useToast();

  // Lock background scroll while the modal is open so the page behind the
  // overlay can't scroll (incl. wheel chaining when the modal scroll bottoms out).
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  useEffect(() => {
    fetch(`/api/calls/${callId}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch call");
        return res.json();
      })
      .then((d) => {
        setData(d);
        setGrade((d.grade as number) ?? null);
        setNote((d.note as string) ?? null);
      })
      .catch((err) => toast(err.message, "error"))
      .finally(() => setLoading(false));
  }, [callId, toast]);

  function copyId() {
    navigator.clipboard.writeText(callId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function startEdit() {
    setEditGrade(grade ?? 0);
    setEditNote(note ?? "");
    setEditing(true);
  }

  function saveEdit() {
    const g = editGrade || undefined;
    const n = editNote.trim() || undefined;
    setGrade(g ?? null);
    setNote(n ?? null);
    setEditing(false);
    toast("Saved", "success");
    patchCallGrade(callId, g, n);
    onUpdated?.(callId, g ?? null, n ?? null);
  }

  const agentName = data?.agent_name as string | undefined;
  const userEmail = data?.user_email as string | null | undefined;

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
            {/* Who placed the call, rating, note — editable here */}
            <div className="px-5 pt-4 shrink-0 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {agentName && (
                    <div className="text-sm font-medium truncate">{agentName}</div>
                  )}
                  <div className="text-xs text-zinc-500">
                    Placed by{" "}
                    <span className="text-zinc-700 dark:text-zinc-300">
                      {userEmail || "Retell"}
                    </span>
                  </div>
                </div>
                {!editing && (
                  <button
                    onClick={startEdit}
                    className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 text-xs border border-zinc-300 dark:border-zinc-700 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
                  >
                    <Pencil size={12} />
                    Edit
                  </button>
                )}
              </div>

              {editing ? (
                <div className="space-y-2">
                  <Stars value={editGrade} size={18} onChange={setEditGrade} />
                  <textarea
                    value={editNote}
                    onChange={(e) => setEditNote(e.target.value)}
                    placeholder="Add a note about this call..."
                    rows={2}
                    className="w-full text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-zinc-400"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={saveEdit}
                      className="flex items-center gap-1 text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded-md transition-colors"
                    >
                      <Check size={12} /> Save
                    </button>
                    <button
                      onClick={() => setEditing(false)}
                      className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-600 px-2 py-1 rounded-md transition-colors"
                    >
                      <X size={12} /> Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {grade ? (
                    <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                      <Stars
                        value={grade}
                        size={12}
                        emptyClass="text-zinc-200 dark:text-zinc-700"
                      />
                      <span>{grade}/10</span>
                    </span>
                  ) : (
                    <span className="text-xs text-zinc-400">Not rated</span>
                  )}
                  {note && (
                    <div className="text-sm text-zinc-700 dark:text-zinc-300 italic bg-zinc-50 dark:bg-zinc-900 rounded-lg px-3 py-2">
                      {note}
                    </div>
                  )}
                </>
              )}
            </div>

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
            <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 min-h-0">
              <CallDetailBody data={data} tab={tab} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
