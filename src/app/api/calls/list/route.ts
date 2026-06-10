import { NextResponse } from "next/server";
import { listAgents, listCalls } from "@/lib/retell";

interface RetellAgent {
  agent_id: string;
  agent_name?: string;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const parsedLimit = Number(searchParams.get("limit"));
    const limit =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, 1000)
        : 50;
    const paginationKey = searchParams.get("pagination_key") || undefined;

    const [calls, agents] = await Promise.all([
      listCalls({ limit, pagination_key: paginationKey }),
      listAgents().catch(() => [] as RetellAgent[]),
    ]);

    const agentNames = new Map<string, string>(
      (agents as RetellAgent[]).map((a) => [a.agent_id, a.agent_name ?? a.agent_id])
    );

    const enriched = (calls as Array<Record<string, unknown>>).map((call) => ({
      ...call,
      agent_name: agentNames.get(call.agent_id as string) ?? null,
    }));

    return NextResponse.json(enriched);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to list calls";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
