import { NextResponse } from "next/server";
import { getAgent, getCall } from "@/lib/retell";
import { getCallGradesByIds, getCallLogsByIds, getCallWorkspaceOwner, type CallGrade } from "@/lib/db";
import { getServerWorkspace, isWorkspaceAuthorized, retellKeyForWorkspace } from "@/lib/workspaceServer";
import { isWorkspace } from "@/lib/workspace";
import { scoreToStars } from "@/lib/grade";
import { gradeRetellCall } from "@/lib/grading";

// Grading polls OpenAI on a cache miss, so give the route headroom.
export const maxDuration = 30;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Resolve the call's actual owning workspace, independent of the
    // viewer's currently active workspace — this is what makes a shared
    // link work when opened by someone whose active workspace differs from
    // the one it was shared from. The `ws` query param (stamped into the
    // link at share time — see sharePath()) is the primary source: outbound
    // and stl have no ingestion pipeline, so a real production call there
    // usually has no DB row to derive this from otherwise. Older links
    // without the param fall back to the DB lookup.
    const requestedWs = new URL(request.url).searchParams.get("ws");
    const owningWorkspace = isWorkspace(requestedWs)
      ? requestedWs
      : await getCallWorkspaceOwner(id);
    const sessionWorkspace = await getServerWorkspace();

    let workspace = sessionWorkspace;
    if (owningWorkspace && owningWorkspace !== sessionWorkspace) {
      if (!(await isWorkspaceAuthorized(owningWorkspace))) {
        return NextResponse.json(
          { error: "You don't have access to this call's workspace" },
          { status: 403 }
        );
      }
      workspace = owningWorkspace;
    }

    const apiKey = retellKeyForWorkspace(workspace);
    const call = await getCall(id, apiKey);

    // Retell stamps the agent name on the call at call time; getAgent gives the
    // current one (so a rename shows through). Start from the stamped name so a
    // deleted or unreadable agent still leaves the call labeled.
    let agentName: string | null = call.agent_name ?? null;
    if (call.agent_id) {
      try {
        const agent = await getAgent(call.agent_id, apiKey);
        agentName = agent.agent_name ?? agentName;
      } catch {
        // Keep the stamped name.
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
