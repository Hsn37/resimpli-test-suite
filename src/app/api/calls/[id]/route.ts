import { NextResponse } from "next/server";
import { getAgent, getCall } from "@/lib/retell";
import { getCallLogsByIds } from "@/lib/db";
import { scoreToStars } from "@/lib/grade";

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

    return NextResponse.json({
      ...call,
      agent_name: agentName,
      grade,
      note: log?.note ?? null,
      user_email: log?.user_email ?? metaUser ?? null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to get call";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
