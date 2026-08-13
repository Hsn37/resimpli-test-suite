// Pure shortlist policy for the weekly marketing-call workflow. New calls use
// Retell's authoritative appointment_booked flag. Historical calls with no flag
// are tagged legacy_unverified and must be verified from the transcript by the
// marketing judge before they can become finalists.

export const CALL_OF_WEEK_SHORTLIST_LIMIT = 20;
export const CALL_OF_WEEK_MIN_DURATION_SECONDS = 3 * 60;
export const CALL_OF_WEEK_MIN_GRADE = 50;
export const CALL_OF_WEEK_MIN_REP_SCORE = 70;

// A call with one of these failures is a poor publishing candidate even when
// its aggregate grade clears the broad floor. Specific gates are more stable
// than treating the quantized failure-class ratio as the primary quality score.
export const CALL_OF_WEEK_DISQUALIFYING_FAILURES = [
  "spoke_name_aloud",
  "steamrolled_caller",
  "false_completeness_claim",
  "appointment_recall_failure",
] as const;

export type BookingEvidenceSource = "retell_analysis" | "legacy_unverified";

export interface CallOfWeekCandidate {
  id: string;
  retell_call_id: string;
  timestamp: number | null;
  duration_seconds: number;
  agent_name: string | null;
  agent_version: string | null;
  voice_name: string | null;
  recording_url: string;
  appointment_booked: boolean | null;
  booking_source: BookingEvidenceSource;
  booking_evidence: string;
  grade: number | null;
  rep_score: number;
  disqualifying_failures: string[];
}

export interface CallOfWeekPool {
  total_calls: number;
  reported_booked_calls: number;
  legacy_unverified_calls: number;
  eligible_calls: number;
  shortlist: CallOfWeekCandidate[];
}

interface WeeklyGradeInput {
  grade: number | null;
  rep_score: number | null;
  ai_callout: boolean;
  results: Record<string, unknown>;
  rep_scorecard: Record<string, unknown>;
}

interface WeeklyCallInput {
  id: string;
  retell_call_id: string;
  timestamp: number | null;
  duration_seconds: number | null;
  agent_name: string | null;
  agent_version: string | null;
  voice_name: string | null;
  recording_url: string | null;
  appointment_booked: boolean | null;
  call_grades: WeeklyGradeInput | null;
}

function isViolated(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const result = value as { applicable?: unknown; violated?: unknown; passed?: unknown };
  if (result.applicable !== true) return false;
  if (typeof result.violated === "boolean") return result.violated;
  return typeof result.passed === "boolean" ? !result.passed : false;
}

function disqualifyingFailures(grade: WeeklyGradeInput): string[] {
  return CALL_OF_WEEK_DISQUALIFYING_FAILURES.filter((key) =>
    isViolated(grade.results?.[key])
  );
}

function bookingEvidence(call: WeeklyCallInput): {
  source: BookingEvidenceSource;
  evidence: string;
} | null {
  if (call.appointment_booked === true) {
    return {
      source: "retell_analysis",
      evidence: "Retell post-call analysis: appointment_booked=true",
    };
  }
  // Explicit false is authoritative. Only genuinely missing historical flags
  // proceed, and they remain unverified until the transcript-reading judge.
  if (call.appointment_booked === null) {
    return {
      source: "legacy_unverified",
      evidence: "Historical call has no appointment_booked field; transcript verification required",
    };
  }
  return null;
}

function toCandidate(call: WeeklyCallInput): CallOfWeekCandidate | null {
  const grade = call.call_grades;
  const booking = bookingEvidence(call);
  if (!booking || !grade) return null;
  if (!call.recording_url) return null;
  if ((call.duration_seconds ?? 0) < CALL_OF_WEEK_MIN_DURATION_SECONDS) return null;
  // Null means no configured failure class was applicable, not a failed call.
  if (grade.grade != null && grade.grade < CALL_OF_WEEK_MIN_GRADE) return null;
  if (grade.rep_score == null || grade.rep_score < CALL_OF_WEEK_MIN_REP_SCORE) return null;
  if (grade.ai_callout) return null;
  const failures = disqualifyingFailures(grade);
  if (failures.length > 0) return null;

  return {
    id: call.id,
    retell_call_id: call.retell_call_id,
    timestamp: call.timestamp,
    duration_seconds: call.duration_seconds!,
    agent_name: call.agent_name,
    agent_version: call.agent_version,
    voice_name: call.voice_name,
    recording_url: call.recording_url,
    appointment_booked: call.appointment_booked,
    booking_source: booking.source,
    booking_evidence: booking.evidence,
    grade: grade.grade == null ? null : Number(grade.grade),
    rep_score: Number(grade.rep_score),
    disqualifying_failures: failures,
  };
}

/**
 * Deterministic candidate order. Retell-confirmed bookings are never crowded
 * out by legacy calls. rep_score is already the mean of applicable dimensions,
 * so using it directly avoids double-counting rapport/control/outcome.
 */
export function rankCallOfWeekCandidates(calls: WeeklyCallInput[]): CallOfWeekCandidate[] {
  return calls
    .map(toCandidate)
    .filter((candidate): candidate is CallOfWeekCandidate => candidate != null)
    .sort(
      (a, b) =>
        Number(b.booking_source === "retell_analysis") -
          Number(a.booking_source === "retell_analysis") ||
        b.rep_score - a.rep_score ||
        (b.grade ?? -1) - (a.grade ?? -1) ||
        b.duration_seconds - a.duration_seconds ||
        (b.timestamp ?? 0) - (a.timestamp ?? 0)
    );
}

export function buildCallOfWeekPool(
  calls: WeeklyCallInput[],
  rankedCandidates: CallOfWeekCandidate[] = rankCallOfWeekCandidates(calls),
  displayedCandidates: CallOfWeekCandidate[] = rankedCandidates.slice(
    0,
    CALL_OF_WEEK_SHORTLIST_LIMIT
  )
): CallOfWeekPool {
  const reportedBooked = calls.filter((call) => call.appointment_booked === true).length;
  const legacyUnverified = rankedCandidates.filter(
    (call) => call.booking_source === "legacy_unverified"
  ).length;
  return {
    total_calls: calls.length,
    reported_booked_calls: reportedBooked,
    legacy_unverified_calls: legacyUnverified,
    eligible_calls: rankedCandidates.length,
    shortlist: displayedCandidates,
  };
}
