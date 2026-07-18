import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { getServerWorkspace, retellKeyForWorkspace } from "@/lib/workspaceServer";
import { runBackfill } from "@/lib/ingestionJobs";

// Resumable Retell → Turso backfill for the active workspace (admin). Thin
// wrapper over runBackfill: guard → resolve workspace key → run one chunk →
// JSON. Press again until { done: true }. Pass { reset: true } to restart.
export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const workspace = await getServerWorkspace();
  let apiKey: string;
  try {
    apiKey = retellKeyForWorkspace(workspace);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "No Retell key" },
      { status: 400 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as { reset?: boolean };
  const result = await runBackfill({ workspace, apiKey, reset: body?.reset === true });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
