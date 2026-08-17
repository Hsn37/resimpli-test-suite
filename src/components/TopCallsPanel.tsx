"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Download,
  Eye,
  CalendarRange,
  Loader2,
  Medal,
  Play,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Trophy,
} from "lucide-react";
import AudioPlayer from "./AudioPlayer";
import { useToast } from "./Toast";
import { fmtDuration, fmtDate, fmtDateTime, DAY_MS } from "@/lib/dashboard";
import { TOP_CALLS_MAX_WINDOW_DAYS, type TopCallsCandidate } from "@/lib/topCalls";
import type { TopCallsFinalist, TopCallsRecommendation } from "@/lib/topCallsJudge";
import { downloadRecording } from "@/lib/downloadRecording";

const CARD = "rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950";
const DATE_INPUT =
  "rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent px-2 py-1 text-xs tabular-nums";

const RUNNER_UP_CARD = "border-zinc-200 dark:border-zinc-800";
const AMBER_TEXT = "text-amber-700 dark:text-amber-400";
// How each booking outcome reads on a finalist card. Booking no longer gates
// entry, so a call with none still appears — it just says so plainly.
const BOOKING_LABELS: Record<
  TopCallsFinalist["booking_outcome"],
  { label: string; tone: string; confirmed: boolean }
> = {
  retell_confirmed: {
    label: "Appointment confirmed by Retell",
    tone: "text-zinc-500",
    confirmed: true,
  },
  confirmed_in_transcript: {
    label: "Appointment confirmed in the transcript",
    tone: AMBER_TEXT,
    confirmed: true,
  },
  committed_next_step: {
    label: "Committed next step, not a booked appointment",
    tone: AMBER_TEXT,
    confirmed: false,
  },
  none: {
    label: "No booking or committed next step",
    tone: AMBER_TEXT,
    confirmed: false,
  },
};
// Gold / silver / bronze, indexed by podium rank. Anything outside this list is
// a runner-up and renders as a plain card.
const PODIUM = [
  {
    badge: "bg-amber-500",
    card: "border-amber-300 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/15",
  },
  {
    badge: "bg-zinc-400 dark:bg-zinc-500",
    card: "border-zinc-300 dark:border-zinc-600 bg-zinc-50/70 dark:bg-zinc-900/40",
  },
  {
    badge: "bg-amber-700",
    card: "border-amber-200 dark:border-amber-900/60 bg-amber-50/25 dark:bg-amber-950/10",
  },
];

/** Cycle boundaries are UTC midnights, so keep the picker on the same grid. */
function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function isoDayToMs(day: string): number {
  return new Date(`${day}T00:00:00.000Z`).getTime();
}

/** ISO day strings compare correctly lexicographically. */
function minIsoDay(a: string, b: string): string {
  return a < b ? a : b;
}

interface ReviewPayload {
  recommendation: TopCallsRecommendation;
  model: string | null;
  generated_at: number;
}

interface PanelData {
  total_calls: number;
  reported_booked_calls: number;
  legacy_unverified_calls: number;
  eligible_calls: number;
  shortlist: TopCallsCandidate[];
  review: ReviewPayload | null;
}

export default function TopCallsPanel({
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
  // Editable range, seeded from the cycle. The cycle runs ahead of today, and
  // ranking days that have not happened yet only wastes the window — so the
  // default end is clamped to today.
  const [rangeFrom, setRangeFrom] = useState(() => isoDay(from.getTime()));
  const [rangeTo, setRangeTo] = useState(() =>
    minIsoDay(isoDay(to.getTime() - DAY_MS), isoDay(Date.now()))
  );
  const fromMs = isoDayToMs(rangeFrom);
  // The API treats `to` as exclusive; the picker is inclusive.
  const toMs = isoDayToMs(rangeTo) + DAY_MS;
  const rangeDays = Math.round((toMs - fromMs) / DAY_MS);
  const rangeError =
    !Number.isFinite(fromMs) || !Number.isFinite(toMs)
      ? "Pick both dates"
      : toMs <= fromMs
        ? "End date must be on or after the start date"
        : rangeDays > TOP_CALLS_MAX_WINDOW_DAYS
          ? `Range must be ${TOP_CALLS_MAX_WINDOW_DAYS} days or fewer`
          : null;
  const endpoint = useMemo(
    () => `/api/dashboard/top-calls?from=${fromMs}&to=${toMs}`,
    [fromMs, toMs]
  );

  useEffect(() => {
    if (rangeError) return;
    let cancelled = false;
    // Deferred to a microtask on purpose: setting state synchronously inside an
    // effect trips react-hooks/set-state-in-effect, which is an error here.
    Promise.resolve().then(() => {
      if (!cancelled) setLoading(true);
    });
    fetch(endpoint)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Failed to load candidates");
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
  }, [endpoint, rangeError, toast]);

  async function runRanking(force: boolean) {
    setRanking(true);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Ranking failed");
      setData(body as PanelData);
      toast("Top calls are ready", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Ranking failed", "error");
    } finally {
      setRanking(false);
    }
  }

  const candidatesById = useMemo(
    () => new Map((data?.shortlist ?? []).map((candidate) => [candidate.retell_call_id, candidate])),
    [data?.shortlist]
  );
  const finalists = data?.review?.recommendation.finalists ?? [];
  const podiumIds = data?.review?.recommendation.podium_call_ids ?? [];
  const rangeEndInclusive = new Date(toMs - 1);

  return (
    <section className={`${CARD} overflow-hidden`}>
      <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 bg-gradient-to-r from-amber-50 to-white dark:from-amber-950/25 dark:to-zinc-950">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Trophy size={19} className="text-amber-600 dark:text-amber-400" />
              <h2 className="text-base font-semibold">Top Calls</h2>
            </div>
            <p className="text-xs text-zinc-500 mt-1">
              {rangeError ? "Select a range" : `${fmtDate(new Date(fromMs))} – ${fmtDate(rangeEndInclusive)}`} · Ranked for marketing value, booking outcome labelled
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-zinc-500">
              <CalendarRange size={14} />
              <input
                type="date"
                value={rangeFrom}
                max={rangeTo}
                onChange={(e) => setRangeFrom(e.target.value)}
                className={DATE_INPUT}
                aria-label="Range start"
              />
            </label>
            <span className="text-xs text-zinc-500">to</span>
            <input
              type="date"
              value={rangeTo}
              min={rangeFrom}
              onChange={(e) => setRangeTo(e.target.value)}
              className={DATE_INPUT}
              aria-label="Range end"
            />
            {data?.review && isAdmin ? (
              <button
                onClick={() => runRanking(true)}
                disabled={ranking || rangeError != null}
                className="flex items-center gap-1.5 text-sm border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 rounded-lg hover:bg-white dark:hover:bg-zinc-900 disabled:opacity-50"
              >
                {ranking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                Rerun ranking
              </button>
            ) : null}
          </div>
        </div>
        {rangeError && (
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-2">{rangeError}</p>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-500">
          <Loader2 size={18} className="animate-spin" /> Loading candidates…
        </div>
      ) : !data ? (
        <div className="py-10 text-center text-sm text-zinc-500">Candidates could not be loaded.</div>
      ) : (
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Stat label="Calls" value={data.total_calls} />
            <Stat label="Confirmed by Retell" value={data.reported_booked_calls} />
            <Stat label="No Retell flag" value={data.legacy_unverified_calls} />
            <Stat label="Passed all gates" value={data.eligible_calls} />
            <Stat label="LLM shortlist" value={data.shortlist.length} />
          </div>

          <div className="text-xs text-zinc-500">
            Gates: no explicit “not booked” flag · recording present · grade null or ≥50 · rep score ≥60 · no AI suspicion · at least 2 minutes · no critical QA failure. Booking is ranked, not required.
          </div>

          {data.shortlist.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-6 text-center">
              <div className="text-sm font-medium">No qualified calls yet</div>
              <p className="text-xs text-zinc-500 mt-1">
                Only calls Retell explicitly marked as not booked are excluded outright. Everything else needs a recording, at least 2 minutes, and clean QA to reach the judge.
              </p>
            </div>
          ) : !data.review ? (
            <div className="rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50/60 dark:bg-blue-950/20 p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">{data.shortlist.length} qualified calls are ready</div>
                <p className="text-xs text-zinc-500 mt-1">
                  {isAdmin
                    ? "The LLM will compare marketing value and return a ranked top 3, plus runners-up."
                    : "An admin can run the ranking to pick this cycle's top calls."}
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
                  <div className="text-sm font-medium">No finalist returned</div>
                  <p className="text-xs text-zinc-500 mt-1">
                    The judge reviewed the shortlist but found nothing worth publishing. Try widening the date range.
                  </p>
                </div>
              ) : (
              <div className="space-y-3">
                {finalists.map((finalist, index) => {
                  const candidate = candidatesById.get(finalist.call_id);
                  if (!candidate) return null;
                  // undefined for runners-up and for any out-of-range rank.
                  const podiumStyle = PODIUM[podiumIds.indexOf(finalist.call_id)];
                  const outcome = BOOKING_LABELS[finalist.booking_outcome];
                  const clip =
                    finalist.clip_start_seconds != null && finalist.clip_end_seconds != null
                      ? `${fmtDuration(Math.round(finalist.clip_start_seconds))}–${fmtDuration(Math.round(finalist.clip_end_seconds))}`
                      : null;
                  return (
                    <article
                      key={finalist.call_id}
                      className={`rounded-xl border p-4 ${podiumStyle?.card ?? RUNNER_UP_CARD}`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs text-zinc-400">#{index + 1}</span>
                            {podiumStyle && (
                              <span
                                className={`inline-flex items-center gap-1 rounded-full ${podiumStyle.badge} text-white px-2 py-0.5 text-xs font-semibold`}
                              >
                                {index === 0 ? <Trophy size={11} /> : <Medal size={11} />}
                                Recommended #{index + 1}
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
                      <div className={`flex items-start gap-1.5 mt-2 text-xs ${outcome.tone}`}>
                        {outcome.confirmed ? (
                          <CheckCircle2 size={13} className="shrink-0 mt-0.5 text-green-600 dark:text-green-400" />
                        ) : (
                          <ShieldAlert size={13} className="shrink-0 mt-0.5" />
                        )}
                        <span>
                          {outcome.label}
                          {finalist.booking_outcome !== "retell_confirmed" &&
                            finalist.booking_outcome !== "none" &&
                            ` (${Math.round(finalist.booking_confidence * 100)}% confidence)`}
                          {finalist.booking_evidence ? `: ${finalist.booking_evidence}` : ""}
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
