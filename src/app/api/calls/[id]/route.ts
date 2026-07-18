import { NextResponse } from "next/server";
import { getAgent, getCall } from "@/lib/retell";
import { getCallGradesByIds, getCallLogsByIds } from "@/lib/db";
import { getServerWorkspace, retellKeyForWorkspace } from "@/lib/workspaceServer";
import { scoreToStars } from "@/lib/grade";
import { ensureCallGraded } from "@/lib/grading";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const workspace = await getServerWorkspace();
    const apiKey = retellKeyForWorkspace(workspace);
    const call = await getCall(id, apiKey);

    let agentName: string | null = null;
    if (call.agent_id) {
      try {
        const agent = await getAgent(call.agent_id, apiKey);
        agentName = agent.agent_name ?? null;
      } catch {
        agentName = null;
      }
    }

    // Enrich with our own call log (grade/note/user) + the full 0-100
    // call_grades row (for the rich AI-grade breakdown). Both degrade
    // gracefully if the DB is unreachable.
    const [logs, callGrades] = await Promise.all([
      getCallLogsByIds(workspace, [id]).catch(() => new Map()),
      getCallGradesByIds(workspace, [id]).catch(() => new Map()),
    ]);
    const log = logs.get(id);
    const metaUser = (call.metadata as { user?: string } | undefined)?.user;
    // DB stores the rating as a score out of 10; convert to a star count.
    const grade = log?.grade != null ? scoreToStars(log.grade) : null;

    const aiGrade = await ensureCallGraded(
      id,
      call.transcript_object,
      call.retell_llm_dynamic_variables,
      workspace
    );

    return NextResponse.json({
      ...call,
      agent_name: agentName,
      grade,
      note: log?.note ?? null,
      user_email: log?.user_email ?? metaUser ?? null,
      ai_grade: aiGrade,
      call_grades: callGrades.get(id) ?? null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to get call";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
