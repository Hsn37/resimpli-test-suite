import { NextResponse } from "next/server";
import { getAgent, getCall } from "@/lib/retell";
import { getCallGradesByIds, getCallLogsByIds, type CallGrade } from "@/lib/db";
import { getServerWorkspace, retellKeyForWorkspace } from "@/lib/workspaceServer";
import { scoreToStars } from "@/lib/grade";
import { gradeRetellCall } from "@/lib/grading";

// Grading polls OpenAI on a cache miss, so give the route headroom.
export const maxDuration = 30;

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
      getCallGradesByIds(workspace, [id]).catch(() => new Map<string, CallGrade>()),
    ]);
    const log = logs.get(id);
    const metaUser = (call.metadata as { user?: string } | undefined)?.user;
    // DB stores the rating as a score out of 10; convert to a star count.
    const grade = log?.grade != null ? scoreToStars(log.grade) : null;

    // Lazily grade via the unified 0-100 path when this call has no grade yet
    // and a transcript exists — so opening a call populates the same
    // call_grades breakdown the list + dashboard render.
    let callGrade: CallGrade | null = callGrades.get(id) ?? null;
    if (!callGrade) {
      const turns = call.transcript_object as unknown[] | undefined;
      if (Array.isArray(turns) && turns.length > 0) {
        callGrade = await gradeRetellCall(workspace, id, apiKey, call).catch(() => null);
      }
    }

    return NextResponse.json({
      ...call,
      agent_name: agentName,
      grade,
      note: log?.note ?? null,
      user_email: log?.user_email ?? metaUser ?? null,
      call_grades: callGrade,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to get call";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
