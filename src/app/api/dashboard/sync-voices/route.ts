import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { getServerWorkspace, retellKeyForWorkspace } from "@/lib/workspaceServer";
import { runVoiceSync } from "@/lib/ingestionJobs";

// Sync the workspace's Retell agents → agent_voices cache, then backfill
// calls.voice_id / voice_name for rows still missing it (admin). Thin wrapper
// over runVoiceSync.
export async function POST() {
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

  try {
    const result = await runVoiceSync({ workspace, apiKey });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 }
    );
  }
}
