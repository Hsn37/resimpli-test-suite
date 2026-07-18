import "server-only";

// OpenAI 2-layer call grader engine — a faithful port of the client's Supabase
// edge function (`grade-call/index.ts`), minus the Deno/Supabase bits. This is a
// PURE compute + single OpenAI call: no DB reads or writes live here — callers
// (src/lib/grading.ts) fetch the inputs (rubric/model from the DB, transcript
// from Retell) and persist the result.
//
// Layer 1 = failure classes ("doesn't sound robotic" floor) → grade (0-100).
// Layer 2 = rep scorecard (QA-manager view) → rep_score (0-100).
// ai_callout is a separate signal that must not influence either layer.

// --- OpenAI call constants (no magic strings, per CLAUDE.md) ------------------
const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const SUBMIT_GRADE_TOOL_NAME = "submit_grade";
const GRADER_TEMPERATURE = 0.2;
// Hard cap on the OpenAI request so a hung fetch can't stall the background
// after() hook past its platform budget (Lovable had no timeout — a bug).
const OPENAI_FETCH_TIMEOUT_MS = 30000;
// Values that count as "empty" for a prefilled variable (case-insensitive,
// trimmed) — ported verbatim from the client's splitVariables.
const EMPTY_VARIABLE_TOKENS = ["unknown", "n/a", "none", "null"];
// Cap the evidence/quote strings the model returns before we persist them. The
// Lovable app stored these unbounded (a hardening gap — Phase 8); a runaway
// generation could otherwise bloat call_grades. 600 chars comfortably holds a
// short quote + [turn] reference.
const MAX_EVIDENCE_LENGTH = 600;

/** A rubric entry (failure class or rep dimension) as passed to the engine. */
export interface GraderRubricEntry {
  key: string;
  name: string;
  definition: string;
}

export interface FailureClassResult {
  applicable: boolean;
  passed: boolean;
  evidence: string;
}

export interface RepScorecardResult {
  applicable: boolean;
  score: number | null;
  evidence: string;
}

/** The typed 2-layer grade the engine returns. Mirrors the client's call_grades row. */
export interface OpenAiGradeResult {
  grade: number | null; // 0-100, or null when no failure class applied
  applicable_count: number;
  passed_count: number;
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
  systemPrompt: string;
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

/** Build the forced `submit_grade` tool schema from the DB rubric keys. */
function buildSubmitGradeTool(
  failureClasses: GraderRubricEntry[],
  repDimensions: GraderRubricEntry[]
) {
  return {
    type: "function",
    function: {
      name: SUBMIT_GRADE_TOOL_NAME,
      description:
        "Return failure-class results, ai_callout signal, and rep scorecard in a single call.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          results: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                key: { type: "string", enum: failureClasses.map((c) => c.key) },
                applicable: {
                  type: "boolean",
                  description:
                    "Did the situation described by this failure class arise in the call?",
                },
                passed: {
                  type: "boolean",
                  description:
                    "Only meaningful when applicable=true. false = the failure occurred.",
                },
                evidence: {
                  type: "string",
                  description:
                    "Short quote from the transcript with a [turn] reference. Empty string if not applicable.",
                },
              },
              required: ["key", "applicable", "passed", "evidence"],
            },
          },
          ai_callout: {
            type: "boolean",
            description:
              "True if the caller indicated they suspect they are talking to an AI/robot/recording (or hung up right after voicing that suspicion).",
          },
          ai_callout_quote: {
            type: "string",
            description:
              "Short quoted moment from the caller with [turn] reference. Empty string if ai_callout is false.",
          },
          rep_scorecard: {
            type: "array",
            description:
              "One entry per rep-scorecard dimension. Score 0-100 when applicable=true; when applicable=false the score is ignored.",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                key: { type: "string", enum: repDimensions.map((d) => d.key) },
                applicable: {
                  type: "boolean",
                  description:
                    "False only for dimensions with no evidence to score (e.g. objection_handling when no objection arose).",
                },
                score: {
                  type: "integer",
                  minimum: 0,
                  maximum: 100,
                  description:
                    "0-100. Judge relative to opportunity; do not penalize for questions the call had no chance to reach.",
                },
                evidence: {
                  type: "string",
                  description:
                    "Short quote or observation with [turn] reference where relevant. Empty string if not applicable.",
                },
              },
              required: ["key", "applicable", "score", "evidence"],
            },
          },
        },
        required: ["results", "ai_callout", "ai_callout_quote", "rep_scorecard"],
      },
    },
  };
}

/** Build the user prompt from the split variables, rubric, and transcript. */
function buildUserPrompt(
  prefilled: Record<string, unknown>,
  empty: string[],
  classDefinitions: GraderRubricEntry[],
  repDefinitions: GraderRubricEntry[],
  transcriptText: string
): string {
  return [
    `PRE-FILLED variables (do NOT penalize for skipping):\n${JSON.stringify(prefilled, null, 2)}`,
    `EMPTY / UNKNOWN variables (agent legitimately needed):\n${JSON.stringify(empty, null, 2)}`,
    `Failure classes:\n${JSON.stringify(classDefinitions, null, 2)}`,
    `Rep-scorecard dimensions:\n${JSON.stringify(repDefinitions, null, 2)}`,
    `Transcript:\n${transcriptText || "(empty)"}`,
  ].join("\n\n");
}

/** Coerce a model-returned evidence/quote value to a length-capped string. */
function boundedEvidence(value: unknown): string {
  const s = typeof value === "string" ? value : value == null ? "" : String(value);
  return s.length > MAX_EVIDENCE_LENGTH ? s.slice(0, MAX_EVIDENCE_LENGTH) : s;
}

/** Safe JSON.parse — returns null instead of throwing on malformed tool args. */
function safeJsonParse(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

interface ToolArgs {
  results?: Array<{ key?: unknown; applicable?: unknown; passed?: unknown; evidence?: unknown }>;
  ai_callout?: unknown;
  ai_callout_quote?: unknown;
  rep_scorecard?: Array<{ key?: unknown; applicable?: unknown; score?: unknown; evidence?: unknown }>;
}

/** POST to OpenAI with a forced submit_grade tool call. Returns parsed tool args or throws. */
async function callOpenAi(
  input: GradeCallInput,
  tool: ReturnType<typeof buildSubmitGradeTool>,
  userPrompt: string
): Promise<ToolArgs> {
  if (!input.apiKey) {
    // Boss hasn't provided OPENAI_API_KEY yet — surface a clear, catchable error
    // rather than firing a fetch with a missing bearer token.
    throw new Error("OPENAI_API_KEY is not set");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENAI_FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        temperature: GRADER_TEMPERATURE,
        messages: [
          { role: "system", content: input.systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [tool],
        tool_choice: { type: "function", function: { name: SUBMIT_GRADE_TOOL_NAME } },
      }),
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`OpenAI ${resp.status}: ${await resp.text()}`);
    const json = await resp.json();
    const toolCall = json.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No tool call returned");
    const args = safeJsonParse(toolCall.function?.arguments ?? "");
    if (!args) throw new Error("Malformed tool arguments");
    return args as ToolArgs;
  } finally {
    clearTimeout(timer);
  }
}

/** Reduce Layer-1 tool results into the failure-class map + grade (0-100). */
function reduceFailureClasses(results: ToolArgs["results"]): {
  resultsByKey: Record<string, FailureClassResult>;
  applicable: number;
  passed: number;
  grade: number | null;
} {
  const resultsByKey: Record<string, FailureClassResult> = {};
  let applicable = 0;
  let passed = 0;
  for (const r of results ?? []) {
    resultsByKey[String(r.key)] = {
      applicable: !!r.applicable,
      passed: !!r.passed,
      evidence: boundedEvidence(r.evidence),
    };
    if (r.applicable) {
      applicable += 1;
      if (r.passed) passed += 1;
    }
  }
  const grade = applicable === 0 ? null : Math.round((passed / applicable) * 10000) / 100;
  return { resultsByKey, applicable, passed, grade };
}

/** Reduce Layer-2 tool results into the scorecard map + rep_score (0-100). */
function reduceRepScorecard(scorecard: ToolArgs["rep_scorecard"]): {
  scorecardByKey: Record<string, RepScorecardResult>;
  repScore: number | null;
} {
  const scorecardByKey: Record<string, RepScorecardResult> = {};
  const applicableScores: number[] = [];
  for (const d of scorecard ?? []) {
    const app = !!d.applicable;
    const raw = typeof d.score === "number" ? d.score : null;
    const clamped = raw == null ? null : Math.max(0, Math.min(100, Math.round(raw)));
    scorecardByKey[String(d.key)] = {
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
 * timeout, non-2xx, malformed args) it returns a zeroed result with `error`
 * set, so the background after() hook and request handlers stay alive.
 */
export async function gradeCallWithOpenAi(input: GradeCallInput): Promise<OpenAiGradeResult> {
  const { prefilled, empty } = splitVariables(input.dynamicVariables);
  const transcriptText = formatTranscript(input.transcript);
  const tool = buildSubmitGradeTool(input.failureClasses, input.repDimensions);
  const userPrompt = buildUserPrompt(
    prefilled,
    empty,
    input.failureClasses,
    input.repDimensions,
    transcriptText
  );

  let toolArgs: ToolArgs | null = null;
  let error: string | null = null;
  try {
    toolArgs = await callOpenAi(input, tool, userPrompt);
  } catch (e) {
    error = String((e as Error)?.message ?? e);
    console.error("[grader] OpenAI grading error:", error);
  }

  if (!toolArgs) {
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

  const { resultsByKey, applicable, passed, grade } = reduceFailureClasses(toolArgs.results);
  const { scorecardByKey, repScore } = reduceRepScorecard(toolArgs.rep_scorecard);

  return {
    grade,
    applicable_count: applicable,
    passed_count: passed,
    results: resultsByKey,
    ai_callout: !!toolArgs.ai_callout,
    ai_callout_quote: boundedEvidence(toolArgs.ai_callout_quote) || null,
    rep_score: repScore,
    rep_scorecard: scorecardByKey,
    model: input.model,
    error: null,
  };
}
