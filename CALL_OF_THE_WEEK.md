# Call of the Week — Implementation Handoff

## What was built

The dashboard now has a **Call of the Week** workflow for finding calls that are strong enough for the marketing team to review and publish.

The workflow has three deliberately separate stages:

1. **Deterministic quality gates** remove calls that are too short, lack a recording, have weak QA, look AI-generated, or contain critical QA failures.
2. **Transcript ranking and booking verification** uses an LLM to compare qualified calls for marketing value. For older calls without the new booking field, this step must also prove from the transcript that a new appointment was booked.
3. **Human approval** requires marketing to listen to the recording and check sound quality, consent, privacy, redactions, and brand fit before publishing.

An LLM that only receives a transcript cannot reliably determine whether audio “sounds great,” so the UI never claims that audio quality has been approved.

## Dashboard workflow

The panel appears near the top of `/dashboard` and uses the dashboard's current seven-day cycle.

It shows:

- Total calls in the week.
- Calls authoritatively confirmed by Retell.
- Historical eligible calls whose missing booking flag still needs transcript verification.
- Calls that passed all deterministic gates.
- Calls actually evaluated by the LLM.

Clicking **Pick the finalists** returns up to five finalists and one recommended winner. Each result includes:

- Marketing score and reason.
- Strongest transcript moment and an optional clip range.
- Booking evidence and confidence for a historical call.
- Privacy/redaction warnings.
- Recording playback, full-call review, and recording download actions.

**Rerun ranking** bypasses the cache and asks the model to judge the current pool again.

## Weekly window

The feature uses the dashboard's existing cycle:

- Start: `cycle.start`
- End: `cycle.end`, exclusive
- Length: seven days
- Anchor: the workspace's `tracking_start_date`

The API accepts a maximum window of eight days. The panel intentionally follows the current cycle rather than the dashboard's other interactive date filters.

## Appointment booking signal

### New calls: authoritative flag

The primary source is Retell post-call analysis:

```json
{
  "appointment_booked": true
}
```

The expected location is:

```text
call.call_analysis.custom_analysis_data.appointment_booked
```

Ingestion also tolerates these compatible shapes:

- `call_analysis.appointment_booked`
- `post_call_analysis_data.appointment_booked`
- `custom_analysis_data.appointment_booked`
- Top-level `appointment_booked`

Accepted encodings are `true`, `false`, `1`, `0`, `"true"`, `"false"`, `"1"`, and `"0"`. Missing or unrecognized values remain `NULL`.

The `calls` table contains a nullable indexed column:

```sql
appointment_booked INTEGER
```

Its meanings are:

- `1`: Retell explicitly reported a booked appointment.
- `0`: Retell explicitly reported no booked appointment.
- `NULL`: the call predates the field, analysis has not supplied it, or its value was unrecognized.

An explicit `false` is authoritative and always excludes the call. A thin later payload that omits the field does not overwrite an existing value; `COALESCE` preserves it. Schema initialization also attempts to recover the flag from stored raw Retell payloads.

### Historical calls: temporary transcript verification

Older calls with `appointment_booked = NULL` are not treated as booked and are not inferred with keywords or grader text. If they pass the other deterministic gates, they enter the queue as:

```text
booking_source = legacy_unverified
booking_evidence = Historical call has no appointment_booked field; transcript verification required
```

The LLM may return such a call as a finalist only when the transcript clearly shows all of the following:

- The appointment is new, not a pre-existing appointment.
- The caller accepts a specific appointment.
- The agent confirms it was booked.
- The model supplies transcript evidence with at least `0.70` confidence.

An offered slot, callback, transfer, vague next step, booking attempt, or unaccepted time does not qualify. Parser validation drops any historical finalist that fails these requirements, even if the model otherwise gives it a high marketing score.

This temporary path never writes an inferred value to `calls.appointment_booked`, so it can be removed cleanly once historical coverage is no longer needed.

## Deterministic eligibility heuristic

A call must pass every gate:

| Gate | Current rule |
| --- | --- |
| Booking status | `appointment_booked === true`, or `NULL` pending transcript verification |
| Recording | `recording_url` is present |
| Duration | At least **180 seconds (3 minutes)** |
| Rep score | At least **70** |
| Overall grade | `NULL` is allowed; otherwise at least **50** |
| AI suspicion | `ai_callout === false` |
| Critical failures | None of the four failures below may be violated |

The critical publishing-safety failures are:

- `spoke_name_aloud`
- `steamrolled_caller`
- `false_completeness_claim`
- `appointment_recall_failure`

These specific gates prevent a call with a tolerable aggregate score from qualifying despite a serious behavior problem. Missing or non-applicable results are not treated as violations.

The thresholds are centralized in `src/lib/callOfWeek.ts`:

```ts
CALL_OF_WEEK_SHORTLIST_LIMIT = 20
CALL_OF_WEEK_MIN_DURATION_SECONDS = 180
CALL_OF_WEEK_MIN_GRADE = 50
CALL_OF_WEEK_MIN_REP_SCORE = 70
CALL_OF_WEEK_DISQUALIFYING_FAILURES = [
  "spoke_name_aloud",
  "steamrolled_caller",
  "false_completeness_claim",
  "appointment_recall_failure",
]
```

### Why `grade = NULL` is allowed

In this grader, `NULL` can mean no configured failure class was applicable. It is not automatically equivalent to a zero or failed grade. A call with a null grade must still satisfy the rep-score, AI, duration, recording, booking, and critical-failure gates.

## Pre-LLM ordering

The eligible queue is ordered deterministically:

1. Retell-confirmed bookings before historical unverified calls.
2. Higher overall rep score.
3. Higher non-null overall grade; null sorts below a numeric grade.
4. Longer duration.
5. More recent call.

There is no weighted heuristic score. The prior weighting double-counted rep dimensions already represented by `rep_score`, and substituting `rep_score` for a null grade could inflate a candidate. The simplified order is only a cost-control shortlist, not the final marketing judgment.

## LLM judging and refill behavior

The model evaluates at most 20 calls per batch and returns up to five finalists. Its marketing rubric is:

- 25% compelling seller story.
- 20% natural/human conversation.
- 15% rapport and empathy.
- 15% objection handling or meaningful progression.
- 15% clear appointment payoff.
- 10% standalone clarity.

It penalizes rambling, confusion, generic exchanges, weak narrative, privacy risk, and brand risk.

If historical candidates are rejected and fewer than five finalists remain, the API refills from the next ranked batch. It evaluates at most three batches (60 calls) per request to bound latency and cost.

Transcripts are formatted with turn numbers and timestamps when available. Each transcript is capped at roughly 7,000 characters by keeping the beginning and end, which preserves the opening context and the likely appointment close.

The parsed response requires:

- `winner_call_id`
- `summary`
- `finalists`
- Per-finalist marketing score, reason, strongest moment, and optional clip range
- Privacy risks
- Booking confirmation, evidence, and confidence

All returned IDs are checked against the supplied candidates. Scores and clip ranges are bounded, duplicates are removed, and historical booking validation is enforced in code after the model responds. An empty finalist list is a valid result.

## Caching and API behavior

The ranking is cached in `weekly_call_reviews`, keyed by workspace and week start.

The cache fingerprint includes:

- The full eligible queue, including refill candidates.
- Candidate timestamps, duration, grade, rep score, and booking source/evidence.
- The configured model.
- `CALL_OF_WEEK_JUDGE_VERSION`.

Changing candidates, the model, or judge semantics therefore invalidates old output. Increment `CALL_OF_WEEK_JUDGE_VERSION` whenever prompt behavior or response validation changes.

Endpoints:

- `GET /api/dashboard/call-of-week?from=...&to=...` returns the funnel and a valid cached review, if present.
- `POST /api/dashboard/call-of-week?from=...&to=...` runs or reuses the ranking.
- `POST` with `{ "force": true }` reruns the model.
- A valid week with no eligible calls returns `200` with an empty pool and `review: null`; it is not treated as an API error.

The judge requires `OPENAI_API_KEY`. Its model comes from the workspace grader-model configuration, falling back to the existing default grader model.

## Human publication checklist

Before publishing the winner, marketing still needs to:

1. Listen to the actual recording for clarity, volume, distortion, awkward dead air, and recording defects.
2. Confirm the appointment really was booked, especially for a historical call.
3. Review names, phone numbers, addresses, financial details, health/family details, and other personal information.
4. Confirm recording consent and the company's publication rights.
5. Redact or edit sensitive material and confirm the final clip still has enough context.
6. Confirm brand fit.

## Files added

- `src/lib/callOfWeek.ts` — deterministic gates, candidate types, and queue ordering.
- `src/lib/callOfWeekJudge.ts` — transcript formatting, LLM prompt, output validation, cache fingerprint, and judge version.
- `src/app/api/dashboard/call-of-week/route.ts` — weekly GET/POST API, caching, batched refill, and empty-week handling.
- `src/components/CallOfWeekPanel.tsx` — dashboard funnel, ranking controls, finalist cards, audio playback, and review warnings.
- `CALL_OF_THE_WEEK.md` — this implementation handoff.

## Files changed

- `src/app/(app)/dashboard/page.tsx` — mounts the new panel for the current cycle.
- `src/lib/ingestion.ts` — normalizes `appointment_booked` from Retell payloads and persists it.
- `src/lib/db.ts` — adds the appointment column/index, raw-payload backfill, dashboard field, and weekly-review cache.
- `src/lib/dashboard.ts` — exposes the appointment field and uses an explicit `en-US` display locale to prevent server/client hydration mismatches.
- `src/app/api/dashboard/export/route.ts` — includes `appointment_booked` in dashboard exports.

## Operational notes

- The minimum duration is intentionally **180 seconds**, not 45 seconds.
- The first-stage ordering is not the winner selection; it only controls which calls reach the LLM first.
- Retell `false` is never overridden by the fallback.
- Historical `NULL` calls can become finalists only after transcript verification.
- The feature analyzes transcripts but does not automate audio-quality approval.
- Once the new flag has broad coverage, remove the `legacy_unverified` path and require `appointment_booked === true` for every candidate.
