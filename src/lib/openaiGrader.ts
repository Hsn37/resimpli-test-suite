import "server-only";
import OpenAI from "openai";

// OpenAI 2-layer call grader engine. A PURE compute + single OpenAI call: no DB
// reads or writes live here — callers (src/lib/grading.ts) fetch the inputs
// (rubric/model from the DB, transcript from Retell) and persist the result.
//
// The model returns plain JSON (response_format: json_object) — no function/tool
// call. The output contract is described in the composed system prompt, so the
// whole grader spec reads top-to-bottom as instructions rather than a separate
// tool schema.
//
// Layer 1 = failure classes ("doesn't sound robotic" floor) → grade (0-100),
//   the share of applicable failure situations the agent got through WITHOUT
//   committing the failure (violated=false).
// Layer 2 = rep scorecard (QA-manager view) → rep_score (0-100).
// ai_callout is a separate signal that must not influence either layer.

// --- OpenAI call constants (no magic strings, per CLAUDE.md) ------------------
const GRADER_TEMPERATURE = 0.2;
// Plain JSON output — the schema lives in the system prompt, not a tool schema.
const RESPONSE_FORMAT_JSON = { type: "json_object" } as const;
// Hard cap on the OpenAI request so a hung call can't stall the background
// after() hook past its platform budget. Paired with maxRetries: 0 so total
// wall time is bounded by this single attempt.
const OPENAI_FETCH_TIMEOUT_MS = 30000;
const OPENAI_MAX_RETRIES = 0;
// Values that count as "empty" for a prefilled variable (case-insensitive,
// trimmed) — ported verbatim from the client's splitVariables.
const EMPTY_VARIABLE_TOKENS = ["unknown", "n/a", "none", "null"];
// Cap the evidence/quote strings the model returns before we persist them, so a
// runaway generation can't bloat call_grades. 600 chars comfortably holds a
// short quote + [turn] reference.
const MAX_EVIDENCE_LENGTH = 600;
const GRADE_SCALE_MAX = 100;

/** A rubric entry (failure class or rep dimension) as passed to the engine. */
export interface GraderRubricEntry {
  key: string;
  name: string;
  definition: string;
}

export interface FailureClassResult {
  applicable: boolean;
  violated: boolean; // true = the failure occurred (bad); only meaningful when applicable
  evidence: string;
}

export interface RepScorecardResult {
  applicable: boolean;
  score: number | null;
  evidence: string;
}

/** The typed 2-layer grade the engine returns. Mirrors the stored call_grades row. */
export interface OpenAiGradeResult {
  grade: number | null; // 0-100, or null when no failure class applied
  applicable_count: number;
  passed_count: number; // applicable classes NOT violated (drives grade; higher = better)
  results: Record<string, FailureClassResult>;
  ai_callout: boolean;
  ai_callout_quote: string | null;
  rep_score: number | null; // 0-100, or null when no dimension applied
  rep_scorecard: Record<string, RepScorecardResult>;
  model: string;
  error: string | null;
}

export interface GradeCallInput {
  transcript: unknown; // Retell transcript_object / stored transcript turns
  dynamicVariables: Record<string, unknown> | null | undefined;
  failureClasses: GraderRubricEntry[];
  repDimensions: GraderRubricEntry[];
  systemPrompt: string; // the editable judgment instructions (from app_config)
  model: string;
  apiKey: string | undefined;
}

/**
 * Split dynamic variables into PRE-FILLED (authoritative ground truth) and
 * EMPTY/UNKNOWN (the agent legitimately needed to ask). Ported verbatim from
 * the client's splitVariables so grading behaviour matches exactly.
 */
export function splitVariables(dv: Record<string, unknown> | null | undefined): {
  prefilled: Record<string, unknown>;
  empty: string[];
} {
  const prefilled: Record<string, unknown> = {};
  const empty: string[] = [];
  for (const [k, v] of Object.entries(dv ?? {})) {
    if (v == null) {
      empty.push(k);
      continue;
    }
    if (typeof v === "string") {
      const t = v.trim().toLowerCase();
      if (!t || EMPTY_VARIABLE_TOKENS.includes(t)) {
        empty.push(k);
        continue;
      }
    }
    prefilled[k] = v;
  }
  return { prefilled, empty };
}

interface TranscriptTurnLike {
  turn?: unknown;
  role?: unknown;
  content?: unknown;
}

/**
 * Format transcript turns as `[turn] role: content`. Ported from the client's
 * formatTranscript; falls back to the 1-based index for the turn number since
 * Retell's transcript_object turns don't carry a `turn` field.
 */
export function formatTranscript(turns: unknown): string {
  if (!Array.isArray(turns)) return "";
  return turns
    .map((raw, i) => {
      const t = (raw ?? {}) as TranscriptTurnLike;
      const n = t.turn ?? i + 1;
      const role = t.role ?? "unknown";
      const content = (t.content ?? "").toString().trim();
      return `[${n}] ${role}: ${content}`;
    })
    .join("\n");
}

/** Render a rubric layer as a `- key (name): definition` list for the prompt. */
function renderRubric(entries: GraderRubricEntry[]): string {
  return entries.map((e) => `- ${e.key} (${e.name}): ${e.definition}`).join("\n");
}

// The output contract — code-owned so it always matches the parser below and is
// safe against a stale/edited stored system prompt. This is where the JSON shape
// is defined; tweak the outputs here.
const OUTPUT_CONTRACT = `Respond with ONLY a JSON object (no markdown, no commentary) of exactly this shape:
{
  "failures": [
    { "key": <a failure-class key from the list above>, "applicable": <boolean>, "violated": <boolean>, "evidence": <short transcript quote with a [turn] reference, or ""> }
  ],
  "ai_callout": <boolean>,
  "ai_callout_quote": <short caller quote with a [turn] reference, or "">,
  "scorecard": [
    { "key": <a rep-dimension key from the list above>, "applicable": <boolean>, "score": <integer 0-100, or null>, "evidence": <short quote/observation with a [turn] reference, or ""> }
  ]
}

Rules:
- "failures": exactly one entry per failure class listed above. "applicable" = did the situation this class describes arise in the call. "violated" = true ONLY when the failure actually occurred; it is meaningful only when "applicable" is true (use false when not applicable).
- "scorecard": exactly one entry per rep dimension listed above. "applicable" = false only when the call gave no opportunity to evaluate that dimension. "score" = 0-100 judged relative to opportunity when applicable; use null when not applicable.
- "ai_callout" = true only if the caller indicates they suspect an AI/robot/recording (or hangs up right after voicing that suspicion). It MUST NOT influence any "violated" or "score" value.
- Quote real transcript evidence with [turn] references. Never invent turns.`;

/**
 * Compose the full system prompt: editable judgment instructions + the two
 * rubric layers + the output contract. The user prompt carries only the
 * per-call dynamic context.
 */
function buildSystemPrompt(
  basePrompt: string,
  failureClasses: GraderRubricEntry[],
  repDimensions: GraderRubricEntry[]
): string {
  return [
    basePrompt.trim(),
    `Failure classes:\n${renderRubric(failureClasses)}`,
    `Rep scorecard dimensions:\n${renderRubric(repDimensions)}`,
    OUTPUT_CONTRACT,
  ].join("\n\n");
}

/** Build the user prompt from the split variables and transcript (dynamic context only). */
function buildUserPrompt(
  prefilled: Record<string, unknown>,
  empty: string[],
  transcriptText: string
): string {
  return [
    `PRE-FILLED variables (agent already knew these — do NOT penalize for skipping):\n${JSON.stringify(prefilled, null, 2)}`,
    `EMPTY / UNKNOWN variables (agent legitimately needed to ask):\n${JSON.stringify(empty, null, 2)}`,
    `Transcript:\n${transcriptText || "(empty)"}`,
  ].join("\n\n");
}

/** Coerce a model-returned evidence/quote value to a length-capped string. */
function boundedEvidence(value: unknown): string {
  const s = typeof value === "string" ? value : value == null ? "" : String(value);
  return s.length > MAX_EVIDENCE_LENGTH ? s.slice(0, MAX_EVIDENCE_LENGTH) : s;
}

/** Safe JSON.parse — returns null instead of throwing on malformed output. */
function safeJsonParse(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

interface GradeJson {
  failures?: Array<{ key?: unknown; applicable?: unknown; violated?: unknown; evidence?: unknown }>;
  ai_callout?: unknown;
  ai_callout_quote?: unknown;
  scorecard?: Array<{ key?: unknown; applicable?: unknown; score?: unknown; evidence?: unknown }>;
}

/** Call OpenAI (SDK, json_object mode) for a plain-JSON grade. Returns the parsed object or throws. */
async function callOpenAi(
  input: GradeCallInput,
  systemPrompt: string,
  userPrompt: string
): Promise<GradeJson> {
  if (!input.apiKey) {
    // Surface a clear, catchable error rather than calling the SDK with no token.
    throw new Error("OPENAI_API_KEY is not set");
  }

  const client = new OpenAI({ apiKey: input.apiKey, maxRetries: OPENAI_MAX_RETRIES });
  const completion = await client.chat.completions.create(
    {
      model: input.model,
      temperature: GRADER_TEMPERATURE,
      response_format: RESPONSE_FORMAT_JSON,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    },
    { timeout: OPENAI_FETCH_TIMEOUT_MS }
  );

  const content = completion.choices[0]?.message?.content;
  if (typeof content !== "string") throw new Error("No content returned");
  const parsed = safeJsonParse(content);
  if (!parsed) throw new Error("Malformed JSON output");
  return parsed as GradeJson;
}

/** Reduce Layer-1 output into the failure-class map + grade (0-100). */
function reduceFailures(
  failures: GradeJson["failures"],
  validKeys: Set<string>
): {
  resultsByKey: Record<string, FailureClassResult>;
  applicable: number;
  passed: number;
  grade: number | null;
} {
  const resultsByKey: Record<string, FailureClassResult> = {};
  let applicable = 0;
  let passed = 0;
  for (const r of failures ?? []) {
    const key = String(r.key);
    if (!validKeys.has(key)) continue; // ignore hallucinated keys
    const isApplicable = !!r.applicable;
    const violated = isApplicable && !!r.violated;
    resultsByKey[key] = { applicable: isApplicable, violated, evidence: boundedEvidence(r.evidence) };
    if (isApplicable) {
      applicable += 1;
      if (!violated) passed += 1;
    }
  }
  const grade =
    applicable === 0 ? null : Math.round((passed / applicable) * GRADE_SCALE_MAX * 100) / 100;
  return { resultsByKey, applicable, passed, grade };
}

/** Reduce Layer-2 output into the scorecard map + rep_score (0-100). */
function reduceScorecard(
  scorecard: GradeJson["scorecard"],
  validKeys: Set<string>
): {
  scorecardByKey: Record<string, RepScorecardResult>;
  repScore: number | null;
} {
  const scorecardByKey: Record<string, RepScorecardResult> = {};
  const applicableScores: number[] = [];
  for (const d of scorecard ?? []) {
    const key = String(d.key);
    if (!validKeys.has(key)) continue; // ignore hallucinated keys
    const app = !!d.applicable;
    const raw = typeof d.score === "number" ? d.score : null;
    const clamped = raw == null ? null : Math.max(0, Math.min(GRADE_SCALE_MAX, Math.round(raw)));
    scorecardByKey[key] = {
      applicable: app,
      score: app ? clamped : null,
      evidence: boundedEvidence(d.evidence),
    };
    if (app && clamped != null) applicableScores.push(clamped);
  }
  const repScore =
    applicableScores.length === 0
      ? null
      : Math.round(
          (applicableScores.reduce((a, b) => a + b, 0) / applicableScores.length) * 100
        ) / 100;
  return { scorecardByKey, repScore };
}

/**
 * Run the OpenAI 2-layer grader. Never throws: on any failure (missing key,
 * timeout, non-2xx, malformed output) it returns a zeroed result with `error`
 * set, so the background after() hook and request handlers stay alive.
 */
export async function gradeCallWithOpenAi(input: GradeCallInput): Promise<OpenAiGradeResult> {
  const { prefilled, empty } = splitVariables(input.dynamicVariables);
  const transcriptText = formatTranscript(input.transcript);
  const systemPrompt = buildSystemPrompt(input.systemPrompt, input.failureClasses, input.repDimensions);
  const userPrompt = buildUserPrompt(prefilled, empty, transcriptText);

  let gradeJson: GradeJson | null = null;
  let error: string | null = null;
  try {
    gradeJson = await callOpenAi(input, systemPrompt, userPrompt);
  } catch (e) {
    error = String((e as Error)?.message ?? e);
    console.error("[grader] OpenAI grading error:", error);
  }

  if (!gradeJson) {
    return {
      grade: null,
      applicable_count: 0,
      passed_count: 0,
      results: {},
      ai_callout: false,
      ai_callout_quote: null,
      rep_score: null,
      rep_scorecard: {},
      model: input.model,
      error,
    };
  }

  const failureKeys = new Set(input.failureClasses.map((c) => c.key));
  const dimensionKeys = new Set(input.repDimensions.map((d) => d.key));
  const { resultsByKey, applicable, passed, grade } = reduceFailures(gradeJson.failures, failureKeys);
  const { scorecardByKey, repScore } = reduceScorecard(gradeJson.scorecard, dimensionKeys);

  return {
    grade,
    applicable_count: applicable,
    passed_count: passed,
    results: resultsByKey,
    ai_callout: !!gradeJson.ai_callout,
    ai_callout_quote: boundedEvidence(gradeJson.ai_callout_quote) || null,
    rep_score: repScore,
    rep_scorecard: scorecardByKey,
    model: input.model,
    error: null,
  };
}
