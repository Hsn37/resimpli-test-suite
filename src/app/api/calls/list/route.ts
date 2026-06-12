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

    const callList = calls as Array<Record<string, unknown>>;

    // Enrich with our own call logs (grade/note/user) for calls placed from
    // within this tool. Degrades gracefully if the DB is unreachable.
    const callIds = callList.map((c) => String(c.call_id));
    const logs = await getCallLogsByIds(callIds).catch(() => new Map());

    const enriched = callList.map((call) => {
      const log = logs.get(String(call.call_id));
      // Prefer our DB record; fall back to the user we stamped into the Retell
      // call metadata at creation time (covers calls placed from this tool).
      const metaUser = (call.metadata as { user?: string } | undefined)?.user;
      // DB stores the rating as a score out of 10; convert back to stars (1-5)
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
