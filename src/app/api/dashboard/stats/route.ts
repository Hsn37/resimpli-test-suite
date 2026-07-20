import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { getServerWorkspace } from "@/lib/workspaceServer";
import { isAutomationEnabled, getLastTickAt } from "@/lib/automation";
import { countPendingGrades } from "@/lib/ingestionJobs";

// Lightweight automation stats for the dashboard's Stats card (admin): whether
// automation is on, when the cron tick last ran, and how many calls are still
// waiting to be graded. Read-only; no side effects.
export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  try {
    const workspace = await getServerWorkspace();
    const [automationEnabled, lastTickAt, ungradedCount] = await Promise.all([
      isAutomationEnabled(workspace),
      getLastTickAt(workspace),
      countPendingGrades(workspace),
    ]);
    return NextResponse.json({ workspace, automationEnabled, lastTickAt, ungradedCount });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load stats";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
