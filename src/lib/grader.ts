// LEGACY: Retell grader — superseded by src/lib/openaiGrader.ts. Kept for
// reference, intentionally unwired. No live path imports this module anymore
// (call sites moved to src/lib/grading.ts). Do not re-wire without a decision.
import "server-only";
import { createChat, createChatCompletion, endChat, getCall, getChat } from "./retell";
import { getAiGrade, insertAiGrade } from "./db";
import { SCORE_MAX } from "./grade";
import type { TranscriptTurn } from "./transcript";

function getGraderAgentId(): string {
  const id = process.env.RETELL_GRADER_AGENT_ID;
  if (!id) throw new Error("RETELL_GRADER_AGENT_ID is not set");
  return id;
}

// The Retell grader agent scores conversational quality on a 1-5 scale (see
// scripts/setup-grader-agent.ts). Scale it up to the app's 0-10 convention
// (matching the human star rating, see src/lib/grade.ts) before storing, so
// both grade types render correctly against the same 10-star widget.
const GRADER_NATIVE_MAX = 5;

function formatGradingMessage(
  turns: TranscriptTurn[],
  context: Record<string, string>
): string {
  const contextLines = Object.entries(context)
    .filter(([, v]) => v !== "" && v != null)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  const transcriptLines = turns
    .filter((t) => t.role === "agent" || t.role === "user")
    .map((t) => `${t.role}: ${t.content}`)
    .join("\n");

  return [
    "CONTEXT",
    contextLines || "(no additional context)",
    "",
    "TRANSCRIPT",
    transcriptLines || "(empty transcript)",
  ].join("\n");
}

export interface GradeResult {
  score: number;
  note: string;
  chatId: string;
}

const POLL_INTERVAL_MS = 1500;
const MAX_POLL_ATTEMPTS = 10; // ~15s cap

/** Grade a transcript via the dedicated Retell grader chat agent. */
export async function gradeTranscript(
  turns: TranscriptTurn[],
  context: Record<string, string> = {}
): Promise<GradeResult> {
  const agentId = getGraderAgentId();

  const chat = await createChat({ agent_id: agentId });
  const content = formatGradingMessage(turns, context);
  await createChatCompletion({ chat_id: chat.chat_id, content });
  await endChat(chat.chat_id);

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const result = await getChat(chat.chat_id);
    const data = result.chat_analysis?.custom_analysis_data;
    if (result.chat_status === "ended" && data && data.grade != null) {
      return {
        score: (Number(data.grade) / GRADER_NATIVE_MAX) * SCORE_MAX,
        note: String(data.note ?? ""),
        chatId: chat.chat_id,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(`Grading timed out for chat ${chat.chat_id}`);
}

/**
 * Grade a call, reusing a cached grade if one already exists. Used both as a
 * lazy fallback (call detail view) and by the eager background job below.
 */
export async function ensureCallGraded(
  callId: string,
  transcriptObject: TranscriptTurn[] | undefined,
  dynamicVariables: Record<string, unknown> | undefined
): Promise<{ score: number; note: string } | null> {
  const existing = await getAiGrade("call", callId);
  if (existing) return { score: existing.score, note: existing.note };

  if (!transcriptObject || transcriptObject.length === 0) return null;

  try {
    const context: Record<string, string> = {};
    for (const [k, v] of Object.entries(dynamicVariables ?? {})) {
      context[k] = String(v);
    }
    const result = await gradeTranscript(transcriptObject, context);
    await insertAiGrade({
      subjectType: "call",
      subjectId: callId,
      score: result.score,
      note: result.note,
      chatId: result.chatId,
    });
    return { score: result.score, note: result.note };
  } catch (err) {
    console.error(`[grading] failed to grade call ${callId}:`, err);
    return null;
  }
}

const CALL_READY_POLL_INTERVAL_MS = 3000;
const CALL_READY_MAX_ATTEMPTS = 5; // ~15s cap waiting for Retell's transcript

/**
 * Poll Retell for a call's transcript until it's ready, then grade it. Meant
 * to run as background work (via `after()`) right after a call ends, so
 * grading happens automatically without anyone needing to open the call.
 */
export async function gradeCallWhenReady(callId: string): Promise<void> {
  for (let attempt = 0; attempt < CALL_READY_MAX_ATTEMPTS; attempt++) {
    const call = await getCall(callId).catch(() => null);
    const transcriptObject = call?.transcript_object as TranscriptTurn[] | undefined;
    if (transcriptObject && transcriptObject.length > 0) {
      await ensureCallGraded(callId, transcriptObject, call?.retell_llm_dynamic_variables);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, CALL_READY_POLL_INTERVAL_MS));
  }
  console.error(`[grading] transcript never became ready for call ${callId}`);
}
