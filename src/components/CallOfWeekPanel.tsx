"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Download,
  Eye,
  Loader2,
  Play,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Trophy,
} from "lucide-react";
import AudioPlayer from "./AudioPlayer";
import { useToast } from "./Toast";
import { fmtDuration, fmtDate, fmtDateTime } from "@/lib/dashboard";
import type { CallOfWeekCandidate } from "@/lib/callOfWeek";
import type { CallOfWeekRecommendation } from "@/lib/callOfWeekJudge";
import { downloadRecording } from "@/lib/downloadRecording";

const CARD = "rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950";

interface ReviewPayload {
  recommendation: CallOfWeekRecommendation;
  model: string | null;
  generated_at: number;
}

interface PanelData {
  total_calls: number;
  reported_booked_calls: number;
  legacy_unverified_calls: number;
  eligible_calls: number;
  shortlist: CallOfWeekCandidate[];
  review: ReviewPayload | null;
}

export default function CallOfWeekPanel({
  from,
  to,
  isAdmin,
  onViewDetails,
}: {
  from: Date;
  to: Date;
  // Ranking is admin-only server-side; this only hides the trigger. Everyone
  // can still read an already-generated recommendation.
  isAdmin: boolean;
  onViewDetails: (callId: string) => void;
}) {
  const [data, setData] = useState<PanelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [ranking, setRanking] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const { toast } = useToast();
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const endpoint = useMemo(
    () => `/api/dashboard/call-of-week?from=${fromMs}&to=${toMs}`,
    [fromMs, toMs]
  );

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) setLoading(true);
    });
    fetch(endpoint)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Failed to load weekly candidates");
        return body as PanelData;
      })
      .then((body) => {
        if (!cancelled) setData(body);
      })
      .catch((error: Error) => {
        if (!cancelled) toast(error.message, "error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [endpoint, toast]);

  async function runRanking(force: boolean) {
    setRanking(true);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Weekly ranking failed");
      setData(body as PanelData);
      toast("Weekly finalists are ready", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Weekly ranking failed", "error");
    } finally {
      setRanking(false);
    }
  }

  const candidatesById = useMemo(
    () => new Map((data?.shortlist ?? []).map((candidate) => [candidate.retell_call_id, candidate])),
    [data?.shortlist]
  );
  const finalists = data?.review?.recommendation.finalists ?? [];
  const winnerId = data?.review?.recommendation.winner_call_id;
  const weekEndInclusive = new Date(toMs - 1);

  return (
    <section className={`${CARD} overflow-hidden`}>
      <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 bg-gradient-to-r from-amber-50 to-white dark:from-amber-950/25 dark:to-zinc-950">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Trophy size={19} className="text-amber-600 dark:text-amber-400" />
              <h2 className="text-base font-semibold">Call of the Week</h2>
            </div>
            <p className="text-xs text-zinc-500 mt-1">
              {fmtDate(from)} – {fmtDate(weekEndInclusive)} · Booked appointments with strong QA scores
            </p>
          </div>
          {data?.review && isAdmin ? (
            <button
              onClick={() => runRanking(true)}
              disabled={ranking}
              className="flex items-center gap-1.5 text-sm border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 rounded-lg hover:bg-white dark:hover:bg-zinc-900 disabled:opacity-50"
            >
              {ranking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Rerun ranking
            </button>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-500">
          <Loader2 size={18} className="animate-spin" /> Loading weekly candidates…
        </div>
      ) : !data ? (
        <div className="py-10 text-center text-sm text-zinc-500">Weekly candidates could not be loaded.</div>
      ) : (
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Stat label="Calls" value={data.total_calls} />
            <Stat label="Confirmed by Retell" value={data.reported_booked_calls} />
            <Stat label="Legacy to verify" value={data.legacy_unverified_calls} />
            <Stat label="Passed all gates" value={data.eligible_calls} />
            <Stat label="LLM shortlist" value={data.shortlist.length} />
          </div>

          <div className="text-xs text-zinc-500">
            Gates: Retell-confirmed or historical booking pending transcript verification · recording present · grade null or ≥50 · rep score ≥70 · no AI suspicion · at least 3 minutes · no critical QA failure
          </div>

          {data.shortlist.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-6 text-center">
              <div className="text-sm font-medium">No qualified calls yet</div>
              <p className="text-xs text-zinc-500 mt-1">
                Explicit false flags are excluded. Older calls with a missing flag can enter the quality pool, but the transcript judge must verify a newly booked appointment before they can become finalists.
              </p>
            </div>
          ) : !data.review ? (
            <div className="rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50/60 dark:bg-blue-950/20 p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">{data.shortlist.length} qualified calls are ready</div>
                <p className="text-xs text-zinc-500 mt-1">
                  {isAdmin
                    ? "The LLM will compare marketing value and return up to five finalists."
                    : "An admin can run the ranking to pick this week's finalists."}
                </p>
              </div>
              {isAdmin && (
                <button
                  onClick={() => runRanking(false)}
                  disabled={ranking}
                  className="flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 text-sm font-medium disabled:opacity-50"
                >
                  {ranking ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                  {ranking ? "Ranking calls…" : "Pick the finalists"}
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="rounded-lg bg-zinc-50 dark:bg-zinc-900/60 p-3">
                <div className="text-sm font-medium">Recommendation</div>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                  {data.review.recommendation.summary || "Finalists ranked by marketing value."}
                </p>
                <div className="text-[11px] text-zinc-400 mt-2">
                  Generated {fmtDateTime(data.review.generated_at)}
                  {data.review.model ? ` · ${data.review.model}` : ""}
                </div>
              </div>

              {finalists.length === 0 ? (
                <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-6 text-center">
                  <div className="text-sm font-medium">No publishable finalist found</div>
                  <p className="text-xs text-zinc-500 mt-1">
                    The judge did not find a call with both a verified appointment and enough marketing value. Historical calls without a confirmed booking were excluded.
                  </p>
                </div>
              ) : (
              <div className="space-y-3">
                {finalists.map((finalist, index) => {
                  const candidate = candidatesById.get(finalist.call_id);
                  if (!candidate) return null;
                  const isWinner = finalist.call_id === winnerId;
                  const isLegacyBooking = candidate.booking_source === "legacy_unverified";
                  const clip =
                    finalist.clip_start_seconds != null && finalist.clip_end_seconds != null
                      ? `${fmtDuration(Math.round(finalist.clip_start_seconds))}–${fmtDuration(Math.round(finalist.clip_end_seconds))}`
                      : null;
                  return (
                    <article
                      key={finalist.call_id}
                      className={`rounded-xl border p-4 ${
                        isWinner
                          ? "border-amber-300 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/15"
                          : "border-zinc-200 dark:border-zinc-800"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs text-zinc-400">#{index + 1}</span>
                            {isWinner && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500 text-white px-2 py-0.5 text-xs font-semibold">
                                <Trophy size={11} /> Recommended winner
                              </span>
                            )}
                            <span className="text-sm font-semibold">{candidate.agent_name ?? "Inbound call"}</span>
                          </div>
                          <div className="text-xs text-zinc-500 mt-1">
                            Marketing {finalist.marketing_score}/100 · QA {candidate.grade == null ? "n/a" : Math.round(candidate.grade)} · Rep {Math.round(candidate.rep_score)} · {fmtDuration(candidate.duration_seconds)}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setPlayingId((current) => (current === finalist.call_id ? null : finalist.call_id))}
                            className="w-8 h-8 flex items-center justify-center rounded-full text-zinc-500 hover:text-blue-600 hover:bg-white dark:hover:bg-zinc-900"
                            title="Listen to recording"
                          >
                            <Play size={15} />
                          </button>
                          <button
                            onClick={() => onViewDetails(finalist.call_id)}
                            className="w-8 h-8 flex items-center justify-center rounded-full text-zinc-500 hover:text-blue-600 hover:bg-white dark:hover:bg-zinc-900"
                            title="Review full call"
                          >
                            <Eye size={15} />
                          </button>
                          <button
                            onClick={() => downloadRecording(candidate.recording_url, finalist.call_id)}
                            className="w-8 h-8 flex items-center justify-center rounded-full text-zinc-500 hover:text-blue-600 hover:bg-white dark:hover:bg-zinc-900"
                            title="Download recording"
                          >
                            <Download size={15} />
                          </button>
                        </div>
                      </div>

                      <p className="text-sm text-zinc-700 dark:text-zinc-300 mt-3">{finalist.reason}</p>
                      {finalist.strongest_moment && (
                        <p className="text-xs text-zinc-500 mt-2">
                          <span className="font-medium text-zinc-600 dark:text-zinc-400">Strongest moment:</span>{" "}
                          {finalist.strongest_moment}{clip ? ` · ${clip}` : ""}
                        </p>
                      )}
                      {finalist.privacy_risks.length > 0 && (
                        <div className="flex items-start gap-1.5 mt-2 text-xs text-amber-700 dark:text-amber-400">
                          <ShieldAlert size={13} className="shrink-0 mt-0.5" />
                          Review/redact: {finalist.privacy_risks.join("; ")}
                        </div>
                      )}
                      <div className={`flex items-start gap-1.5 mt-2 text-xs ${isLegacyBooking ? "text-amber-700 dark:text-amber-400" : "text-zinc-500"}`}>
                        {isLegacyBooking ? (
                          <ShieldAlert size={13} className="shrink-0 mt-0.5" />
                        ) : (
                          <CheckCircle2 size={13} className="shrink-0 mt-0.5 text-green-600 dark:text-green-400" />
                        )}
                        <span>
                          {isLegacyBooking
                            ? `Historical booking verified from the transcript (${Math.round(finalist.booking_confidence * 100)}% confidence): ${finalist.booking_confirmation_evidence}`
                            : "Appointment confirmed by Retell"}
                          {" · final audio quality and consent require human approval"}
                        </span>
                      </div>
                      {playingId === finalist.call_id && (
                        <div className="mt-3">
                          <AudioPlayer src={candidate.recording_url} onEnded={() => setPlayingId(null)} />
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-zinc-50 dark:bg-zinc-900/60 px-3 py-2">
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] text-zinc-500">{label}</div>
    </div>
  );
}
