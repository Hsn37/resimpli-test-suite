import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { listAgents } from "@/lib/retell";
import { getRecentCallLogs } from "@/lib/db";
import { scoreToStars } from "@/lib/grade";

interface RetellAgent {
  agent_id: string;
  agent_name?: string;
}

// Recent calls placed from this tool by the signed-in user, newest first.
export async function GET(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const clerk = await clerkClient();
    const user = await clerk.users.getUser(userId);
    const email = user.emailAddresses[0]?.emailAddress;
    if (!email) return NextResponse.json([]);

    const { searchParams } = new URL(request.url);
    const parsedLimit = Number(searchParams.get("limit"));
    const limit =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, 100)
        : 20;

    const [logs, agents] = await Promise.all([
      getRecentCallLogs(email, limit),
      listAgents().catch(() => [] as RetellAgent[]),
    ]);

    const agentNames = new Map<string, string>(
      (agents as RetellAgent[]).map((a) => [a.agent_id, a.agent_name ?? a.agent_id])
    );

    // Resolve the current agent name by id so a rename in Retell is reflected;
    // fall back to the name stored at call time, then a generic label.
    const recent = logs.map((log) => ({
      callId: log.call_id,
      agentId: log.agent_id,
      agentName:
        (log.agent_id ? agentNames.get(log.agent_id) : undefined) ??
        log.agent_name ??
        "Agent",
      mode: log.direction,
      timestamp: log.timestamp,
      duration: log.duration,
      grade: log.grade != null ? scoreToStars(log.grade) : null,
      note: log.note,
    }));

    return NextResponse.json(recent);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to list recent calls";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
