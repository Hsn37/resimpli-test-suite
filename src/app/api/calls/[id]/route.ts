import { NextResponse } from "next/server";
import { getAgent, getCall } from "@/lib/retell";

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

    return NextResponse.json({ ...call, agent_name: agentName });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to get call";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
