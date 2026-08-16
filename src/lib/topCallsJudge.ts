import "server-only";

import { createHash } from "crypto";
import OpenAI from "openai";
import type { TopCallsCandidate } from "./topCalls";

// Ranking runs on its own model, independent of the grader's app_config value.
// gpt-5 models reject `max_tokens` (see MAX_COMPLETION_TOKENS below) and reject
// a non-default temperature once `reasoning_effort` is set — so we leave
// reasoning off, which also keeps reasoning_tokens at 0 and the output budget
// entirely for JSON.
export const TOP_CALLS_MODEL = "gpt-5.4-mini";
const JUDGE_TEMPERATURE = 0.2;
const JUDGE_TIMEOUT_MS = 30_000;
// Five finalists' worth of bounded prose plus the summary; generous so a long
// response is never truncated into malformed JSON.
const MAX_COMPLETION_TOKENS = 6_000;
const MAX_TRANSCRIPT_CHARS = 7_000;
export const TOP_CALLS_MAX_FINALISTS = 5;
// How many finalists are promoted to the ranked recommendation. The rest stay
// on the shortlist as runners-up.
export const TOP_CALLS_PODIUM_SIZE = 3;
// Increment whenever prompt semantics or output validation changes. Included in
// the cache fingerprint so old recommendations cannot survive a judge update.
// 4: single winner_call_id replaced by a ranked podium_call_ids.
export const TOP_CALLS_JUDGE_VERSION = "4";

export interface TopCallsFinalist {
  call_id: string;
  marketing_score: number;
  reason: string;
  strongest_moment: string;
  clip_start_seconds: number | null;
  clip_end_seconds: number | null;
  privacy_risks: string[];
  booking_confirmed: true;
  booking_confirmation_evidence: string;
  booking_confidence: number;
  audio_review_required: true;
}

export interface TopCallsRecommendation {
  /** Best-first, at most TOP_CALLS_PODIUM_SIZE. Mirrors finalists[0..2]. */
  podium_call_ids: string[];
  summary: string;
  finalists: TopCallsFinalist[];
  evaluated_call_ids: string[];
}

interface CandidateWithTranscript {
  candidate: TopCallsCandidate;
  transcript: unknown;
}

function toFiniteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function turnStartSeconds(turn: Record<string, unknown>, durationSeconds: number): number | null {
  const words = Array.isArray(turn.words) ? turn.words : [];
  const first = words[0] as Record<string, unknown> | undefined;
  let value = toFiniteNumber(first?.start ?? first?.start_time);
  if (value == null) return null;
  // Retell payload variants have used both seconds and milliseconds.
  if (value > durationSeconds * 10) value /= 1000;
  return Math.max(0, value);
}

function transcriptForJudge(transcript: unknown, durationSeconds: number): string {
  if (!Array.isArray(transcript)) return "";
  const rendered = transcript
    .map((raw, index) => {
      const turn = (raw ?? {}) as Record<string, unknown>;
      const content = typeof turn.content === "string" ? turn.content.trim() : "";
      if (!content) return "";
      const start = turnStartSeconds(turn, durationSeconds);
      const time = start == null ? "" : ` @${Math.floor(start / 60)}:${Math.floor(start % 60).toString().padStart(2, "0")}`;
      return `[${index + 1}${time}] ${String(turn.role ?? "unknown")}: ${content}`;
    })
    .filter(Boolean)
    .join("\n");

  if (rendered.length <= MAX_TRANSCRIPT_CHARS) return rendered;
  const half = Math.floor(MAX_TRANSCRIPT_CHARS / 2);
  return `${rendered.slice(0, half)}\n[...middle shortened for ranking...]\n${rendered.slice(-half)}`;
}

export function topCallsFingerprint(
  candidates: TopCallsCandidate[],
  model: string
): string {
  const stable = candidates.map((candidate) => ({
    id: candidate.id,
    call_id: candidate.retell_call_id,
    timestamp: candidate.timestamp,
    duration: candidate.duration_seconds,
    grade: candidate.grade,
    rep: candidate.rep_score,
    booking_source: candidate.booking_source,
    booking_evidence: candidate.booking_evidence,
  }));
  return createHash("sha256")
    .update(
      JSON.stringify({
        judge_version: TOP_CALLS_JUDGE_VERSION,
        model,
        candidates: stable,
      })
    )
    .digest("hex");
}

function boundedString(value: unknown, max = 600): string {
  const string = typeof value === "string" ? value.trim() : "";
  return string.slice(0, max);
}

/**
 * Rank by marketing score, keep the top finalists, then float the podium to the
 * front so the UI's "#1/#2/#3" and the recommended badges always agree.
 *
 * Cutting to the top N happens *after* sorting, so a high scorer the model
 * happened to list late still survives. `nominatedIds` are the judge's own
 * picks in its preferred order (one run per batch); those that survived the cut
 * lead the podium, and any remaining slots are filled by score.
 */
export function selectFinalists(
  finalists: TopCallsFinalist[],
  nominatedIds: string[]
): { finalists: TopCallsFinalist[]; podiumCallIds: string[] } {
  const ranked = [...finalists]
    .sort((a, b) => b.marketing_score - a.marketing_score)
    .slice(0, TOP_CALLS_MAX_FINALISTS);
  const available = new Set(ranked.map((row) => row.call_id));
  const podium: string[] = [];
  for (const id of nominatedIds) {
    if (podium.length >= TOP_CALLS_PODIUM_SIZE) break;
    if (id && available.has(id) && !podium.includes(id)) podium.push(id);
  }
  // Backfill by score when the judge nominated too few, or too few survived.
  for (const row of ranked) {
    if (podium.length >= TOP_CALLS_PODIUM_SIZE) break;
    if (!podium.includes(row.call_id)) podium.push(row.call_id);
  }
  const byId = new Map(ranked.map((row) => [row.call_id, row]));
  return {
    finalists: [
      ...podium.map((id) => byId.get(id)!),
      ...ranked.filter((row) => !podium.includes(row.call_id)),
    ],
    podiumCallIds: podium,
  };
}

function parseRecommendation(
  raw: Record<string, unknown>,
  candidates: TopCallsCandidate[]
): TopCallsRecommendation {
  const validIds = new Set(candidates.map((candidate) => candidate.retell_call_id));
  const candidateById = new Map(candidates.map((candidate) => [candidate.retell_call_id, candidate]));
  const seen = new Set<string>();
  const finalists: TopCallsFinalist[] = [];
  const rows = Array.isArray(raw.finalists) ? raw.finalists : [];

  for (const value of rows) {
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    const callId = String(row.call_id ?? "");
    if (!validIds.has(callId) || seen.has(callId)) continue;
    const candidate = candidateById.get(callId)!;
    const bookingEvidence = boundedString(row.booking_confirmation_evidence);
    const bookingConfidence = Math.max(
      0,
      Math.min(1, toFiniteNumber(row.booking_confidence) ?? 0)
    );
    // Retell's true flag is authoritative. A legacy call must be affirmatively
    // verified by the transcript judge; omission/uncertainty keeps it out.
    if (
      candidate.booking_source === "legacy_unverified" &&
      (row.booking_confirmed !== true || !bookingEvidence || bookingConfidence < 0.7)
    ) {
      continue;
    }
    seen.add(callId);
    const score = Math.max(0, Math.min(100, Math.round(toFiniteNumber(row.marketing_score) ?? 0)));
    const privacyRisks = Array.isArray(row.privacy_risks)
      ? row.privacy_risks.map((risk) => boundedString(risk, 200)).filter(Boolean).slice(0, 5)
      : [];
    const duration = candidate.duration_seconds;
    const rawStart = toFiniteNumber(row.clip_start_seconds);
    const rawEnd = toFiniteNumber(row.clip_end_seconds);
    const clipStart = rawStart == null ? null : Math.max(0, Math.min(duration, rawStart));
    const clipEnd = rawEnd == null ? null : Math.max(0, Math.min(duration, rawEnd));
    const validClip = clipStart != null && clipEnd != null && clipEnd > clipStart;
    finalists.push({
      call_id: callId,
      marketing_score: score,
      reason: boundedString(row.reason),
      strongest_moment: boundedString(row.strongest_moment),
      clip_start_seconds: validClip ? clipStart : null,
      clip_end_seconds: validClip ? clipEnd : null,
      privacy_risks: privacyRisks,
      booking_confirmed: true,
      booking_confirmation_evidence:
        candidate.booking_source === "retell_analysis"
          ? candidate.booking_evidence
          : bookingEvidence,
      booking_confidence:
        candidate.booking_source === "retell_analysis" ? 1 : bookingConfidence,
      // The judge receives transcripts, not audio. Never imply otherwise.
      audio_review_required: true,
    });
  }

  const nominated = Array.isArray(raw.top_call_ids)
    ? raw.top_call_ids.map((id) => String(id ?? ""))
    : [];
  const selected = selectFinalists(finalists, nominated);
  return {
    podium_call_ids: selected.podiumCallIds,
    summary: boundedString(raw.summary, 800),
    finalists: selected.finalists,
    evaluated_call_ids: candidates.map((candidate) => candidate.retell_call_id),
  };
}

export async function judgeTopCalls(input: {
  candidates: CandidateWithTranscript[];
  model: string;
  apiKey: string | undefined;
}): Promise<TopCallsRecommendation> {
  if (!input.apiKey) throw new Error("OPENAI_API_KEY is not set");
  if (input.candidates.length === 0) throw new Error("No eligible calls to rank");

  const payload = input.candidates.map(({ candidate, transcript }) => ({
    call_id: candidate.retell_call_id,
    duration_seconds: candidate.duration_seconds,
    qa: {
      grade: candidate.grade,
      rep_score: candidate.rep_score,
      appointment_booked: candidate.appointment_booked,
      booking_source: candidate.booking_source,
      booking_evidence: candidate.booking_evidence,
    },
    transcript: transcriptForJudge(transcript, candidate.duration_seconds),
  }));

  const system = `You select the best phone calls of the cycle for a real-estate acquisitions company's marketing team.

Every candidate has already passed the recording, rep score >=70, no-caller-AI-suspicion, duration >=3-minute, and critical-failure gates. A non-null QA grade is >=50; QA grade can legitimately be null when no configured failure class was applicable.

Booking has two possible sources:
- "retell_analysis": appointment_booked=true came from Retell post-call analysis and is authoritative. Do not re-infer or reject this booking.
- "legacy_unverified": the historical call predates that field. Inspect the transcript and include this call as a finalist only when it clearly shows the caller accepting a specific appointment and the agent confirming the newly booked appointment. An offered slot, callback, transfer, pre-existing appointment, vague next step, or unaccepted time is not enough. Exclude an unconfirmed legacy call from finalists.

Rank candidates for MARKETING value, not length. Score 0-100 using: compelling seller story 25%, natural/human conversation 20%, rapport and empathy 15%, objection handling or meaningful progression 15%, clear appointment payoff 15%, and standalone clarity 10%. Penalize rambling, confusion, weak narrative, generic exchanges, and privacy/brand risk. Identify names, phone numbers, street addresses, financial details, health/family details, or other content that needs consent or redaction.

You only receive transcripts, not recordings. Do not claim to have judged audio quality. Set a useful clip range only when transcript timestamps support it; otherwise use null. A human must listen to the finalists and approve sound quality and privacy.

Return ONLY JSON:
{
  "top_call_ids": ["call_best", "call_second", "call_third"],
  "summary": "short comparison summary",
  "finalists": [
    {
      "call_id": "call_...",
      "marketing_score": 0,
      "reason": "why this works for marketing",
      "strongest_moment": "specific moment or turn range",
      "clip_start_seconds": null,
      "clip_end_seconds": null,
      "booking_confirmed": true,
      "booking_confirmation_evidence": "specific transcript quote/turns proving a newly booked appointment",
      "booking_confidence": 0.0,
      "privacy_risks": ["specific item to review/redact"]
    }
  ]
}

For every legacy_unverified finalist, booking_confirmed must be true, booking_confirmation_evidence must quote the transcript with turn references, and booking_confidence must be 0-1. Do not return that call at all unless confidence is at least 0.7. Retell-confirmed calls may use the supplied Retell evidence.

Return up to five finalists in best-first order and use only supplied call IDs. It is valid to return an empty finalists array when no candidate is suitable.

"top_call_ids" is your ranked recommendation: the best three finalists, best first, drawn only from the finalists you returned. Return fewer than three when fewer are worth recommending, and an empty array when none are. The remaining finalists stand as runners-up.`;

  const client = new OpenAI({ apiKey: input.apiKey, maxRetries: 0 });
  const completion = await client.chat.completions.create(
    {
      model: input.model,
      temperature: JUDGE_TEMPERATURE,
      response_format: { type: "json_object" },
      max_completion_tokens: MAX_COMPLETION_TOKENS,
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify({ candidates: payload }) },
      ],
    },
    { timeout: JUDGE_TIMEOUT_MS }
  );
  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("The marketing judge returned no content");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    throw new Error("The marketing judge returned malformed JSON");
  }
  return parseRecommendation(parsed, input.candidates.map(({ candidate }) => candidate));
}
