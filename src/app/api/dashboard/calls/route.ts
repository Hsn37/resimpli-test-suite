import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { listDashboardCallsInRange } from "@/lib/db";
import { getServerWorkspace } from "@/lib/workspaceServer";
import { CALLS_WINDOW_LIMIT } from "@/lib/dashboard";

// Calls (with grades) in a [from, to) epoch-ms window for the active workspace,
// newest first. Powers the KPI cards, leaderboard, voice breakdown and calls
// table. Filtering happens client-side over this window (like the source).
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const from = Number(searchParams.get("from"));
  const to = Number(searchParams.get("to"));
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return NextResponse.json({ error: "from/to (epoch ms) required" }, { status: 400 });
  }

  const workspace = await getServerWorkspace();
  const calls = await listDashboardCallsInRange(workspace, from, to, CALLS_WINDOW_LIMIT);
  return NextResponse.json({ calls });
}
