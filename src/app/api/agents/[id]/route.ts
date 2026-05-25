import { NextResponse } from "next/server";
import { getAgent, getAgentVersions } from "@/lib/retell";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const [agent, versions] = await Promise.all([
      getAgent(id),
      getAgentVersions(id).catch(() => []),
    ]);
    return NextResponse.json({ agent, versions });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to get agent";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
