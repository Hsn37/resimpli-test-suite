import { NextResponse } from "next/server";
import { getAgent, getCall } from "@/lib/retell";
import { getAiGrade, getCallLogsByIds, insertAiGrade } from "@/lib/db";
import { scoreToStars } from "@/lib/grade";
import { gradeTranscript } from "@/lib/grader";
import type { TranscriptTurn } from "@/components/TranscriptView";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const call = await getCall(id);

    let agentName: string | null = null;
    if (call.agent_id) {
      try {
        const agent = await getAgent(call.agent_id);
        agentName = agent.agent_name ?? null;
      } catch {
        agentName = null;
      }
    }

    // Enrich with our own call log (grade/note/user) for calls placed from
    // within this tool. Degrades gracefully if the DB is unreachable.
    const logs = await getCallLogsByIds([id]).catch(() => new Map());
    const log = logs.get(id);
    const metaUser = (call.metadata as { user?: string } | undefined)?.user;
    // DB stores the rating as a score out of 10; convert to a star count.
    const grade = log?.grade != null ? scoreToStars(log.grade) : null;

    const aiGrade = await ensureCallGraded(id, call.transcript_object, call.retell_llm_dynamic_variables);

    return NextResponse.json({
      ...call,
      agent_name: agentName,
      grade,
      note: log?.note ?? null,
      user_email: log?.user_email ?? metaUser ?? null,
      ai_grade: aiGrade,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to get call";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function ensureCallGraded(
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
  } catch {
    return null;
  }
}
