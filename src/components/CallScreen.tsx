"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Phone,
  PhoneOff,
  Mic,
  MicOff,
  Download,
  Copy,
  Check,
  ArrowLeft,
  Eye,
} from "lucide-react";
import { RetellWebClient } from "retell-client-js-sdk";
import { CALL_MODES, type CallMode, type TestPreset } from "@/lib/presets";
import { logCall, patchCallGrade } from "@/lib/callLog";
import { startRinging, stopRinging } from "@/lib/ringTone";
import { useToast } from "./Toast";
import CallTimer from "./CallTimer";
import CallViewer from "./CallViewer";
import Stars from "./Stars";
import TestDetailsPanel from "./TestDetailsPanel";

type CallPhase = "mic-check" | "ringing" | "connected" | "ended";

// Matches the direction accent colors used in CallSetup's mode picker, so
// the reference panel's headings stay visually consistent between screens.
const MODE_TEXT_COLORS: Record<CallMode, string> = {
  inbound: "text-blue-600",
  outbound_followup: "text-orange-600",
  speed_to_lead: "text-green-600",
};

interface Props {
  agentId: string;
  agentName: string;
  version?: number;
  mode: CallMode;
  variables: Record<string, string>;
  testCase?: TestPreset | null;
  userEmail: string;
  onBack: () => void;
}

export default function CallScreen({
  agentId,
  agentName,
  version,
  mode,
  variables,
  testCase,
  userEmail,
  onBack,
}: Props) {
  const [phase, setPhase] = useState<CallPhase>("mic-check");
  const [callId, setCallId] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [duration, setDuration] = useState(0);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [showViewer, setShowViewer] = useState(false);
  const [grade, setGrade] = useState<number>(0);
  const [note, setNote] = useState("");

  const clientRef = useRef<RetellWebClient | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const connectingRef = useRef(false);
  const callIdRef = useRef<string | null>(null);
  const endedRef = useRef(false);
  const syncedGradeRef = useRef(false);
  const { toast } = useToast();

  const modeConfig = CALL_MODES[mode];
  const isOutbound = mode !== "inbound";

  const endCall = useCallback(() => {
    if (endedRef.current) return;
    endedRef.current = true;
    if (clientRef.current) {
      clientRef.current.stopCall();
    }
    stopRinging();
    const st = startTimeRef.current;
    const dur = st ? Math.floor((Date.now() - st) / 1000) : 0;
    setDuration(dur);
    if (callIdRef.current) {
      const now = Date.now();
      // Log the call as soon as it ends so capture never depends on the
      // user clicking "New Call". Grade/note are added later via PATCH.
      logCall({
        callId: callIdRef.current,
        agentId,
        agentName,
        version,
        direction: modeConfig.label,
        variables,
        user: userEmail,
        timestamp: now,
        duration: dur,
      });
    }
    setPhase("ended");
  }, [agentId, agentName, version, variables, userEmail, modeConfig.label]);

  const startCall = useCallback(async () => {
    if (connectingRef.current) return;
    connectingRef.current = true;
    setConnecting(true);
    try {
      const res = await fetch("/api/calls/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: agentId,
          version,
          dynamic_variables: variables,
          metadata: { mode, agent_name: agentName, user: userEmail },
          first_speaker: modeConfig.firstSpeaker,
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || "Failed to create call");
      }

      const data = await res.json();
      setCallId(data.call_id);
      callIdRef.current = data.call_id;

      const client = new RetellWebClient();
      clientRef.current = client;

      client.on("call_started", () => {
        stopRinging();
        const now = Date.now();
        startTimeRef.current = now;
        setPhase("connected");
        setStartTime(now);
      });

      client.on("call_ended", () => {
        endCall();
      });

      client.on("agent_start_talking", () => setAgentSpeaking(true));
      client.on("agent_stop_talking", () => setAgentSpeaking(false));
      client.on("audio", (audio: { level: number }) => {
        setAudioLevel(audio.level ?? 0);
      });
      client.on("error", (error: Error) => {
        const msg = error?.message || "";
        const isDisconnect =
          msg.includes("DataChannel") ||
          msg.includes("lossy") ||
          msg.includes("closed");
        if (!isDisconnect) {
          toast(`Call error: ${msg}`, "error");
        }
        endCall();
      });

      await client.startCall({ accessToken: data.access_token });
    } catch (err: unknown) {
      connectingRef.current = false;
      setConnecting(false);
      const message = err instanceof Error ? err.message : "Failed to start call";
      toast(message, "error");
      setPhase("ended");
    }
  }, [agentId, agentName, version, variables, mode, modeConfig.label, userEmail, toast, endCall, startTime]);

  // Mic check phase
  useEffect(() => {
    if (phase !== "mic-check") return;

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        stream.getTracks().forEach((t) => t.stop());
        setPhase("ringing");
      })
      .catch(() => {
        toast("Microphone access is required for calls", "error");
      });
  }, [phase, toast]);

  // Ringing phase
  useEffect(() => {
    if (phase !== "ringing") return;

    startRinging();

    if (!isOutbound) {
      // Inbound: auto-connect after ~3 seconds
      const timer = setTimeout(() => {
        stopRinging();
        startCall();
      }, 3000);
      return () => {
        clearTimeout(timer);
        stopRinging();
      };
    }
    // Outbound: ring until pickup
    return () => stopRinging();
  }, [phase, isOutbound, startCall]);

  function handleBack() {
    // Flush any pending grade/note to the DB before leaving, in case the
    // debounced sync (below) hasn't fired yet.
    if (callIdRef.current && (grade || note.trim())) {
      patchCallGrade(callIdRef.current, grade || undefined, note.trim() || undefined);
    }
    onBack();
  }

  function handlePickup() {
    stopRinging();
    startCall();
  }

  function toggleMute() {
    if (!clientRef.current) return;
    if (muted) {
      clientRef.current.unmute();
    } else {
      clientRef.current.mute();
    }
    setMuted(!muted);
  }

  function copyCallId() {
    if (!callId) return;
    navigator.clipboard.writeText(callId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Auto-save grade/note to the DB whenever they change after the call ends.
  // The write is debounced so typing a note doesn't fire a request per keystroke.
  useEffect(() => {
    if (phase !== "ended" || !callIdRef.current) return;
    const id = callIdRef.current;
    const g = grade || undefined;
    const n = note.trim() || undefined;
    // Skip the no-op write on the initial transition (nothing entered yet),
    // but once anything has been synced keep syncing — including clears.
    if (!g && !n && !syncedGradeRef.current) return;
    syncedGradeRef.current = true;
    const t = setTimeout(() => patchCallGrade(id, g, n), 1000);
    return () => clearTimeout(t);
  }, [grade, note, phase]);

  async function downloadMetadata() {
    if (!callId) return;
    setDownloading(true);
    try {
      const res = await fetch(`/api/calls/${callId}`);
      if (!res.ok) throw new Error("Failed to fetch call data");
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${callId}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast("Call data downloaded", "success");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Download failed";
      toast(message, "error");
    } finally {
      setDownloading(false);
    }
  }

  // Wraps phase content with the always-visible test-details reference panel,
  // when a test case was selected for this call, so the tester can keep
  // referring to what-to-say/expected-behavior throughout the whole call.
  // Bounded to the same viewport budget as CallSetup's layout so only the
  // test-details column scrolls internally — the page itself never does.
  function withTestPanel(content: React.ReactNode) {
    if (!testCase && Object.keys(variables).length === 0) return content;
    return (
      <div className="flex flex-col lg:flex-row lg:justify-center gap-6 lg:h-[calc(100vh-8rem)] lg:min-h-0 max-w-5xl mx-auto">
        {/* Fixed-width, matching the test panel's column (384px = the widest
            thing in the call UI, the max-w-sm rate-call card) instead of
            flex-1 — a flex-1 column centers its content within extra space
            on BOTH sides, but only the left side reads as a visible gap
            since the right side just blends into the gap-6 before the next
            column. Fixed + matched widths + centering the pair as a unit
            keeps both columns flush to their own content on all sides. */}
        <div className="lg:w-96 lg:shrink-0 flex items-center justify-center">{content}</div>
        <div className="lg:w-96 lg:shrink-0 flex flex-col lg:min-h-0">
          <TestDetailsPanel
            testCase={testCase ?? null}
            variables={variables}
            accentClass={MODE_TEXT_COLORS[mode]}
          />
        </div>
      </div>
    );
  }

  // Ringing screen
  if (phase === "mic-check" || phase === "ringing") {
    return withTestPanel(
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
        {/* Ringing animation */}
        <div className="relative">
          <div className="w-24 h-24 rounded-full bg-green-500/20 flex items-center justify-center animate-pulse-ring">
            <div className="w-16 h-16 rounded-full bg-green-500/40 flex items-center justify-center">
              <Phone size={28} className="text-green-600 animate-wiggle" />
            </div>
          </div>
        </div>

        <div className="text-center">
          <p className="text-lg font-medium">
            {isOutbound ? "Incoming call..." : "Connecting to agent..."}
          </p>
          <p className="text-sm text-zinc-500 mt-1">
            {agentName} &middot; {modeConfig.label}
          </p>
        </div>

        {isOutbound && phase === "ringing" && (
          <button
            onClick={handlePickup}
            disabled={connecting}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-8 py-3 rounded-full font-medium shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed animate-bounce-slow"
          >
            <Phone size={20} />
            {connecting ? "Connecting..." : "Pick Up"}
          </button>
        )}
      </div>
    );
  }

  // Connected / ended screen
  return withTestPanel(
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
      {/* Audio visualizer */}
      <div className="relative">
        <div
          className={`w-32 h-32 rounded-full flex items-center justify-center transition-all duration-150 ${
            phase === "connected"
              ? agentSpeaking
                ? "bg-blue-500/30"
                : "bg-zinc-200 dark:bg-zinc-800"
              : "bg-zinc-200 dark:bg-zinc-800"
          }`}
          style={
            phase === "connected" && agentSpeaking
              ? { transform: `scale(${1 + audioLevel * 0.3})` }
              : undefined
          }
        >
          <div
            className={`w-20 h-20 rounded-full flex items-center justify-center ${
              phase === "connected"
                ? agentSpeaking
                  ? "bg-blue-500/50"
                  : "bg-zinc-300 dark:bg-zinc-700"
                : "bg-zinc-300 dark:bg-zinc-700"
            }`}
          >
            {phase === "connected" ? (
              <Phone size={28} className="text-green-600" />
            ) : (
              <PhoneOff size={28} className="text-zinc-400" />
            )}
          </div>
        </div>
      </div>

      {/* Status */}
      <div className="text-center">
        <p className="text-lg font-medium">
          {phase === "connected" ? "Call in progress" : "Call ended"}
        </p>
        <p className="text-sm text-zinc-500 mt-1">
          {agentName} &middot; {modeConfig.label}
        </p>
        <CallTimer running={phase === "connected"} startTime={startTime} />
      </div>

      {/* Call ID badge */}
      {callId && (
        <button
          onClick={copyCallId}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs font-mono text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {callId}
        </button>
      )}

      {/* Controls */}
      {phase === "connected" && (
        <div className="flex items-center gap-4">
          <button
            onClick={toggleMute}
            className={`w-14 h-14 rounded-full flex items-center justify-center shadow-sm hover:shadow-md transition-all ${
              muted
                ? "bg-red-100 dark:bg-red-900/30 text-red-600"
                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
            }`}
          >
            {muted ? <MicOff size={22} /> : <Mic size={22} />}
          </button>
          <button
            onClick={endCall}
            className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center text-white shadow-sm hover:shadow-md transition-all"
          >
            <PhoneOff size={22} />
          </button>
        </div>
      )}

      {/* Post-call grade + note */}
      {phase === "ended" && callId && (
        <div className="w-full max-w-sm bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-sm p-5 space-y-3">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">
            Rate this call{grade ? ` · ${grade}/10` : ""}
          </p>
          <Stars value={grade} size={22} onChange={setGrade} />
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a note about this call..."
            rows={2}
            className="w-full text-sm rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3.5 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-zinc-400"
          />
        </div>
      )}

      {/* Post-call actions */}
      {phase === "ended" && (
        <div className="flex items-center gap-3">
          <button
            onClick={handleBack}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-zinc-300 dark:border-zinc-700 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900 hover:shadow-sm transition-all"
          >
            <ArrowLeft size={16} />
            New Call
          </button>
          {callId && (
            <>
              <button
                onClick={() => setShowViewer(true)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm shadow-sm hover:shadow-md transition-all"
              >
                <Eye size={16} />
                View Details
              </button>
              <button
                onClick={downloadMetadata}
                disabled={downloading}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-zinc-300 dark:border-zinc-700 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900 hover:shadow-sm transition-all disabled:opacity-50"
              >
                <Download size={16} />
                {downloading ? "Downloading..." : "Download"}
              </button>
            </>
          )}
        </div>
      )}

      {phase === "ended" && duration > 0 && (
        <p className="text-sm text-zinc-500">
          Duration: {Math.floor(duration / 60)}m {duration % 60}s
        </p>
      )}

      {showViewer && callId && (
        <CallViewer
          callId={callId}
          onClose={() => setShowViewer(false)}
          onDownload={downloadMetadata}
        />
      )}
    </div>
  );
}
