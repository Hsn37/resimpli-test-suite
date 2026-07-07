import "server-only";
import { createChat, createChatCompletion, endChat, getChat } from "./retell";
import type { TranscriptTurn } from "@/components/TranscriptView";

function getGraderAgentId(): string {
  const id = process.env.RETELL_GRADER_AGENT_ID;
  if (!id) throw new Error("RETELL_GRADER_AGENT_ID is not set");
  return id;
}

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
        score: Number(data.grade),
        note: String(data.note ?? ""),
        chatId: chat.chat_id,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(`Grading timed out for chat ${chat.chat_id}`);
}
