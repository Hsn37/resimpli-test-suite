"use client";

import { useEffect, useState, use } from "react";
import { Loader2, Phone, Copy, Check, Download, Shield } from "lucide-react";
import { ToastProvider, useToast } from "@/components/Toast";
import AudioPlayer from "@/components/AudioPlayer";
import Stars from "@/components/Stars";
import CallDetailBody, {
  CALL_DETAIL_TABS,
  type CallDetailTab,
} from "@/components/CallDetailBody";
import { downloadJson, downloadRecording } from "@/lib/downloadRecording";

interface Props {
  params: Promise<{ id: string }>;
}

function ShareContent({ callId }: { callId: string }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [tab, setTab] = useState<CallDetailTab>("transcript");
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetch(`/api/calls/${callId}`)
      .then((res) => {
        if (!res.ok) {
          setErrorStatus(res.status);
          throw new Error("Failed to fetch call");
        }
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

  function handleDownload() {
    if (!data) return;
    downloadJson(data, `${callId}.json`);
  }

  const recordingUrl = data?.recording_url as string | undefined;
  const agentName = data?.agent_name as string | null | undefined;
  const userEmail = data?.user_email as string | null | undefined;
  const grade = data?.grade as number | null | undefined;
  const note = data?.note as string | null | undefined;
  const startTimestamp = data?.start_timestamp as number | undefined;
  const endTimestamp = data?.end_timestamp as number | undefined;
  const duration =
    startTimestamp && endTimestamp
      ? Math.round((endTimestamp - startTimestamp) / 1000)
      : null;

  return (
    <div className="w-full max-w-3xl mx-auto p-8">
      <div className="flex items-center gap-2 mb-1">
        <Phone size={18} />
        <h1 className="font-semibold text-lg">{agentName ?? "Call Recording"}</h1>
      </div>
      <button
        onClick={copyId}
        className="flex items-center gap-1 text-xs font-mono text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors mb-6"
      >
        {copied ? <Check size={10} /> : <Copy size={10} />}
        {callId}
      </button>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="animate-spin text-zinc-400" size={28} />
        </div>
      ) : !data ? (
        errorStatus === 403 ? (
          <div className="text-center py-20">
            <Shield size={48} className="mx-auto text-zinc-300 mb-4" />
            <p className="text-zinc-500">
              You don&apos;t have access to the workspace this call belongs to.
            </p>
          </div>
        ) : (
          <div className="text-center py-20 text-zinc-500 text-sm">
            Failed to load call data. The link may be invalid or expired.
          </div>
        )
      ) : (
        <>
          {startTimestamp && (
            <div className="text-sm text-zinc-500 mb-4">
              {new Date(startTimestamp).toLocaleString()}
              {duration !== null && (
                <>
                  {" "}
                  &middot; {Math.floor(duration / 60)}m {duration % 60}s
                </>
              )}
            </div>
          )}

          {/* Who placed the call, rating, note */}
          <div className="mb-6 space-y-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-500">
              <span>
                Placed by{" "}
                <span className="text-zinc-700 dark:text-zinc-300 font-medium">
                  {userEmail || "Retell"}
                </span>
              </span>
              {grade ? (
                <span className="flex items-center gap-1.5">
                  <Stars
                    value={grade}
                    size={13}
                    emptyClass="text-zinc-200 dark:text-zinc-700"
                  />
                  <span className="text-zinc-700 dark:text-zinc-300">
                    {grade}/10
                  </span>
                </span>
              ) : null}
            </div>
            {note && (
              <div className="text-sm text-zinc-700 dark:text-zinc-300 italic bg-zinc-50 dark:bg-zinc-900 rounded-lg px-3 py-2">
                {note}
              </div>
            )}
          </div>

          {recordingUrl && (
            <div className="mb-6 flex items-center gap-2">
              <div className="flex-1">
                <AudioPlayer src={recordingUrl} />
              </div>
              <button
                onClick={() => downloadRecording(recordingUrl, callId)}
                className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full text-zinc-400 hover:text-blue-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                title="Download recording"
              >
                <Download size={16} />
              </button>
            </div>
          )}

          <div className="flex items-center justify-between mb-3">
            <div className="flex gap-1 flex-wrap">
              {CALL_DETAIL_TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                    tab === t.key
                      ? "bg-zinc-100 dark:bg-zinc-900 font-medium text-zinc-900 dark:text-zinc-100"
                      : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-zinc-300 dark:border-zinc-700 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors shrink-0"
            >
              <Download size={14} />
              Download
            </button>
          </div>

          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
            <CallDetailBody data={data} tab={tab} />
          </div>
        </>
      )}
    </div>
  );
}

export default function SharePage({ params }: Props) {
  const { id } = use(params);
  return (
    <ToastProvider>
      <ShareContent callId={id} />
    </ToastProvider>
  );
}
