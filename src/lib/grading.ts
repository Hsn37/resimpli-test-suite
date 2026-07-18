import "server-only";
import { getCall as getRetellCall } from "./retell";
import {
  getAiGrade,
  insertAiGrade,
  listFailureClasses,
  listRepDimensions,
  getAppConfig,
  getCall as getDbCall,
  getCallGrade,
  upsertCallGrade,
  type CallGrade,
} from "./db";
import { ingestCall, type RetellCallPayload } from "./ingestion";
import {
  gradeCallWithOpenAi,
  type GraderRubricEntry,
  type OpenAiGradeResult,
} from "./openaiGrader";
import { APP_CONFIG_KEYS, DEFAULT_GRADER_MODEL } from "./graderRubric";
import { retellKeyForWorkspace } from "./retellKeys";
import { DEFAULT_WORKSPACE, type Workspace } from "./workspace";
import type { TranscriptTurn } from "./transcript";

// Orchestration for the OpenAI 2-layer grader. Two persistence paths:
//   1. Dashboard/ingested calls (rows in `calls`) → full 0-100 result in
//      `call_grades` via gradeAndStoreCall (Build 5/6 reuse this).
//   2. Test-suite calls (tracked in call_logs / batch runs) → the engine's
//      grade scaled to 0-10 in the legacy `ai_grades` table, so the existing
//      call-history/detail + batch-run UIs keep rendering unchanged.
// The 0-100 truth for analytics lives in call_grades; the 0-10 star is the
// "scale to /10 for the UI" convention (see src/lib/grade.ts).

// The engine grades 0-100; the legacy star widget stores 0-10 (SCORE_MAX).
const OPENAI_GRADE_MAX = 100;
const AI_GRADE_SCALE_MAX = 10;

/** Scale the engine's 0-100 grade to the legacy 0-10 ai_grades score. */
function scaleTo10(grade: number | null): number | null {
  if (grade == null) return null;
  return Math.round((grade / OPENAI_GRADE_MAX) * AI_GRADE_SCALE_MAX);
}

/** Map DB rubric rows to the lean {key,name,definition} the engine expects. */
function toRubricEntries(rows: { key: string; name: string; definition: string }[]): GraderRubricEntry[] {
  return rows.map((r) => ({ key: r.key, name: r.name, definition: r.definition }));
}

/**
 * Load the workspace's grader config: failure classes, rep dimensions, system
 * prompt, and model — all from the DB (never hardcoded). Model falls back to
 * the seed default if the config key is somehow unset.
 */
async function loadGraderConfig(workspace: Workspace): Promise<{
  failureClasses: GraderRubricEntry[];
  repDimensions: GraderRubricEntry[];
  systemPrompt: string;
  model: string;
}> {
  const [failureRows, repRows, systemPrompt, model] = await Promise.all([
    listFailureClasses(workspace),
    listRepDimensions(workspace),
    getAppConfig<string>(workspace, APP_CONFIG_KEYS.graderSystemPrompt),
    getAppConfig<string>(workspace, APP_CONFIG_KEYS.graderModel),
  ]);
  return {
    failureClasses: toRubricEntries(failureRows),
    repDimensions: toRubricEntries(repRows),
    systemPrompt: systemPrompt ?? "",
    model: model || DEFAULT_GRADER_MODEL,
  };
}

/** Run the engine for a workspace against a transcript + variables. */
async function runEngine(
  workspace: Workspace,
  transcript: unknown,
  dynamicVariables: Record<string, unknown> | null | undefined
): Promise<OpenAiGradeResult> {
  const config = await loadGraderConfig(workspace);
  return gradeCallWithOpenAi({
    transcript,
    dynamicVariables,
    failureClasses: config.failureClasses,
    repDimensions: config.repDimensions,
    systemPrompt: config.systemPrompt,
    model: config.model,
    apiKey: process.env.OPENAI_API_KEY,
  });
}

/**
 * Compose the short `ai_grades.note` from the 2-layer result: the AI-callout
 * quote if the caller suspected a bot, else the first failed class in
 * sort-order (rubric rows arrive pre-ordered by sort_order), else a compact
 * pass summary.
 */
function noteFromResult(result: OpenAiGradeResult): string {
  if (result.error) return `Grading error: ${result.error}`;
  if (result.ai_callout) {
    return `AI callout${result.ai_callout_quote ? `: ${result.ai_callout_quote}` : ""}`;
  }
  const failed = Object.entries(result.results).find(
    ([, r]) => r.applicable && r.violated
  );
  if (failed) {
    const [key, r] = failed;
    return `Top issue — ${key}${r.evidence ? `: ${r.evidence}` : ""}`;
  }
  return `Passed ${result.passed_count}/${result.applicable_count} applicable checks`;
}

// ---------------------------------------------------------------------------
// Dashboard path — full 0-100 result into call_grades (Build 5/6 reuse this)
// ---------------------------------------------------------------------------

/** Upsert a full 0-100 engine result into call_grades, keyed by a `calls.id`. */
function storeCallGrade(
  workspace: Workspace,
  callRowId: string,
  result: OpenAiGradeResult
): Promise<void> {
  return upsertCallGrade({
    callId: callRowId,
    workspace,
    grade: result.grade,
    applicableCount: result.applicable_count,
    passedCount: result.passed_count,
    results: result.results,
    aiCallout: result.ai_callout,
    aiCalloutQuote: result.ai_callout_quote,
    repScore: result.rep_score,
    repScorecard: result.rep_scorecard,
    model: result.model,
    error: result.error,
  });
}

/**
 * Grade an ingested/dashboard call (a row in `calls`) and upsert the full
 * 0-100 result into `call_grades`. Reads transcript + variables from the DB
 * row; does not touch Retell. Returns null when the call row is missing.
 */
export async function gradeAndStoreCall(
  workspace: Workspace,
  callId: string
): Promise<OpenAiGradeResult | null> {
  const call = await getDbCall(workspace, callId);
  if (!call) return null;

  const result = await runEngine(workspace, call.transcript, call.dynamic_variables);
  await storeCallGrade(workspace, callId, result);
  return result;
}

/**
 * Unified grade for a Retell call surfaced on /calls (manual "Grade call" button
 * or lazy grade on open). Ensures the call exists as a `calls` row — ingested
 * WITHOUT the inbound/allowlist/tracking filters, since the user explicitly
 * asked to grade it — then runs the full 0-100 grader into `call_grades`. This
 * replaces the legacy 0-10 ai_grades path so every graded call, however placed,
 * shows the same rep_score + grade breakdown. Returns the stored CallGrade, or
 * null when the call has no transcript to grade.
 *
 * Pass the already-fetched Retell record as `payload` to skip a redundant
 * get-call (e.g. the list route already holds it).
 */
export async function gradeRetellCall(
  workspace: Workspace,
  callId: string,
  apiKey: string,
  payload?: RetellCallPayload
): Promise<CallGrade | null> {
  const call = payload ?? (await getRetellCall(callId, apiKey));
  const ingest = await ingestCall({
    workspace,
    call,
    allowlist: [],
    trackingStart: null,
    apiKey,
    enrich: !payload, // a passed payload is already the full get-call record
    bypassEligibility: true,
    rawPayload: { source: "manual_grade", call },
  });
  if (!ingest.callRowId) return null; // missing id / empty transcript
  await gradeAndStoreCall(workspace, ingest.callRowId);
  return getCallGrade(workspace, ingest.callRowId);
}

// ---------------------------------------------------------------------------
// Test-suite path — engine grade scaled to 0-10 into legacy ai_grades
// ---------------------------------------------------------------------------

/**
 * Grade a transcript via the OpenAI engine and return the legacy {score,note}
 * shape (score on the 0-10 star scale). Used by the batch test-run view.
 * Never throws — on failure it still returns the (scaled-null) result so the
 * caller can decide whether to persist.
 */
export async function gradeTranscript(
  workspace: Workspace,
  turns: TranscriptTurn[],
  dynamicVariables: Record<string, unknown> = {}
): Promise<{ score: number; note: string } | null> {
  const result = await runEngine(workspace, turns, dynamicVariables);
  const score = scaleTo10(result.grade);
  if (score == null) return null;
  return { score, note: noteFromResult(result) };
}

/**
 * Grade a call, reusing a cached ai_grade if one exists. Lazy fallback for the
 * call-detail/history views. Stores the engine grade scaled to 0-10 in
 * ai_grades. Now workspace-aware so dev/prod grade independently.
 */
export async function ensureCallGraded(
  callId: string,
  transcriptObject: TranscriptTurn[] | undefined,
  dynamicVariables: Record<string, unknown> | undefined,
  workspace: Workspace = DEFAULT_WORKSPACE
): Promise<{ score: number; note: string } | null> {
  const existing = await getAiGrade("call", callId);
  if (existing) return { score: existing.score, note: existing.note };

  if (!transcriptObject || transcriptObject.length === 0) return null;

  const result = await runEngine(workspace, transcriptObject, dynamicVariables);
  const score = scaleTo10(result.grade);
  if (score == null) {
    // No applicable failure class (or a grading error) — nothing to store on
    // the 0-10 star scale. Leave uncached so a later grade can fill it in.
    return null;
  }
  const note = noteFromResult(result);
  await insertAiGrade({ subjectType: "call", subjectId: callId, score, note });
  return { score, note };
}

const CALL_READY_POLL_INTERVAL_MS = 3000;
const CALL_READY_MAX_ATTEMPTS = 5; // ~15s cap waiting for Retell's transcript

/**
 * Poll Retell (with the ACTIVE WORKSPACE's key — fixes F-1) for a call's
 * transcript, then grade it via the unified 0-100 path (upsert into `calls` →
 * call_grades) so calls placed through the tool land the same breakdown /calls
 * renders. Background work via after() right after a call ends, so grading
 * happens without anyone opening the call.
 */
export async function gradeCallWhenReady(
  callId: string,
  workspace: Workspace = DEFAULT_WORKSPACE
): Promise<void> {
  const apiKey = retellKeyForWorkspace(workspace);
  for (let attempt = 0; attempt < CALL_READY_MAX_ATTEMPTS; attempt++) {
    const call = await getRetellCall(callId, apiKey).catch(() => null);
    const transcriptObject = call?.transcript_object as TranscriptTurn[] | undefined;
    if (call && transcriptObject && transcriptObject.length > 0) {
      await gradeRetellCall(workspace, callId, apiKey, call);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, CALL_READY_POLL_INTERVAL_MS));
  }
  console.error(`[grading] transcript never became ready for call ${callId}`);
}
