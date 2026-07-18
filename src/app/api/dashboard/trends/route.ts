import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { listGradeTrendRows, listDurationTrendRows } from "@/lib/db";
import { getServerWorkspace } from "@/lib/workspaceServer";
import { MIN_DURATION_SECONDS } from "@/lib/dashboard";

// Row caps mirror the Lovable source (10k grade rows, 20k duration rows).
const GRADE_ROW_LIMIT = 10000;
const DURATION_ROW_LIMIT = 20000;

// Trend rows since `since` (epoch ms): grade rows (grade/rep/callout + parent
// timestamp) and duration-eligible calls. Bucketing/aggregation is done
// client-side at the chosen granularity.
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const since = Number(searchParams.get("since"));
  if (!Number.isFinite(since)) {
    return NextResponse.json({ error: "since (epoch ms) required" }, { status: 400 });
  }

  const workspace = await getServerWorkspace();
  const [gradeRows, durationRows] = await Promise.all([
    listGradeTrendRows(workspace, since, GRADE_ROW_LIMIT),
    listDurationTrendRows(workspace, since, MIN_DURATION_SECONDS, DURATION_ROW_LIMIT),
  ]);
  return NextResponse.json({ gradeRows, durationRows });
}
