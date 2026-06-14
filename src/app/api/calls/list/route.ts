import { NextResponse } from "next/server";
import { listAgents, listCalls } from "@/lib/retell";
import { getCallLogsByIds } from "@/lib/db";
import { scoreToStars } from "@/lib/grade";

interface RetellAgent {
  agent_id: string;
  agent_name?: string;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const parsedLimit = Number(searchParams.get("limit"));
    // Total number of recent calls to return. The /calls page loads this whole
    // window and filters/sorts/paginates over it client-side.
    const target =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, 5000)
        : 50;

    // Kick off the agent-name lookup in parallel with paging through calls.
    const agentsPromise = listAgents().catch(() => [] as RetellAgent[]);

    // Retell caps a single list-calls request at 1000, so page through it
    // (newest first) until we reach the target or run out of calls.
    const PER_REQUEST = 1000;
    const callList: Array<Record<string, unknown>> = [];
    let cursor = searchParams.get("pagination_key") || undefined;
    while (callList.length < target) {
      const batch = (await listCalls({
        limit: Math.min(PER_REQUEST, target - callList.length),
        pagination_key: cursor,
      })) as Array<Record<string, unknown>>;
      if (batch.length === 0) break;
      callList.push(...batch);
      if (batch.length < PER_REQUEST) break; // No more pages.
      cursor = String(batch[batch.length - 1].call_id);
    }

    const agents = await agentsPromise;
    const agentNames = new Map<string, string>(
      (agents as RetellAgent[]).map((a) => [a.agent_id, a.agent_name ?? a.agent_id])
    );

    // Enrich with our own call logs (grade/note/user) for calls placed from
    // within this tool. Degrades gracefully if the DB is unreachable.
    const callIds = callList.map((c) => String(c.call_id));
    const logs = await getCallLogsByIds(callIds).catch(() => new Map());

    const enriched = callList.map((call) => {
      const log = logs.get(String(call.call_id));
      // Prefer our DB record; fall back to the user we stamped into the Retell
      // call metadata at creation time (covers calls placed from this tool).
      const metaUser = (call.metadata as { user?: string } | undefined)?.user;
      // DB stores the rating as a score out of 10; convert to a star count
      // for the UI, which renders star icons.
      const grade = log?.grade != null ? scoreToStars(log.grade) : null;
      return {
        ...call,
        agent_name: agentNames.get(call.agent_id as string) ?? null,
        grade,
        note: log?.note ?? null,
        user_email: log?.user_email ?? metaUser ?? null,
      };
    });

    return NextResponse.json(enriched);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to list calls";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
