import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getCostReport } from "@/lib/costReport";
import { costToday, daysBetween, isDay, parseAgentFilter } from "@/lib/costs";

// Cost report for the /costs page: Retell spend across ALL workspaces.
// Deliberately open to every signed-in user, not just admins — unlike the rest
// of the prod data (transcripts, recordings), this is aggregate spend the whole
// ReSimpli team needs. It never exposes call content, only counts, durations
// and cents per agent.
//
// Query: from, to (YYYY-MM-DD, inclusive, reporting-timezone days — see
// COST_TIMEZONE), optional agent=<workspace>:<agentId> to narrow every
// aggregate to one agent.

const MAX_SPAN_DAYS = 800;

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const from = params.get("from");
  const toParam = params.get("to");
  if (!isDay(from) || !isDay(toParam) || toParam < from) {
    return NextResponse.json({ error: "from/to must be YYYY-MM-DD days with to >= from" }, { status: 400 });
  }
  // Nothing is billed in the future; clamping also keeps the previous-period
  // comparison honest for ranges that run through today.
  const today = costToday();
  const to = toParam > today ? today : toParam;
  if (to < from) {
    return NextResponse.json({ error: "Range starts in the future" }, { status: 400 });
  }
  if (daysBetween(from, to) > MAX_SPAN_DAYS) {
    return NextResponse.json({ error: "Range too large (max ~2 years)" }, { status: 400 });
  }

  const agentParam = params.get("agent");
  const agent = parseAgentFilter(agentParam);
  if (agentParam && !agent) {
    return NextResponse.json({ error: "agent must be <workspace>:<agentId>" }, { status: 400 });
  }

  try {
    return NextResponse.json(await getCostReport({ from, to }, agent));
  } catch (err) {
    // Log the real cause; don't hand DB internals to the browser.
    console.error("[api/costs] report failed", err);
    return NextResponse.json({ error: "Failed to load costs" }, { status: 500 });
  }
}
