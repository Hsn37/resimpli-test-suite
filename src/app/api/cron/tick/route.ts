import { NextRequest, NextResponse } from "next/server";
import { WORKSPACES, type Workspace } from "@/lib/workspace";
import { retellKeyForWorkspace } from "@/lib/workspaceServer";
import {
  isCronAuthorized,
  isAutomationEnabled,
  isBackfillComplete,
  isVoiceSyncDue,
  recordTick,
} from "@/lib/automation";
import { runBackfill, runGradePending, runVoiceSync } from "@/lib/ingestionJobs";

// Automation cron. One unit of work per workspace per tick:
//   - automation paused        → skip
//   - backfill not complete     → run one backfill chunk
//   - ungraded calls remain     → run one grade-pending batch
//   - idle + voice-sync due     → refresh the agent-voice cache (hourly)
//
// Guarded by CRON_SECRET (header/query) OR the Vercel cron header — never
// publicly triggerable. GET and POST both supported (Vercel cron issues GET).

type WorkspaceTick = { workspace: Workspace; action: string; result?: unknown; error?: string };

async function tickWorkspace(workspace: Workspace): Promise<WorkspaceTick> {
  if (!(await isAutomationEnabled(workspace))) {
    return { workspace, action: "paused" };
  }

  let apiKey: string;
  try {
    apiKey = retellKeyForWorkspace(workspace);
  } catch (err) {
    return { workspace, action: "error", error: err instanceof Error ? err.message : "No Retell key" };
  }

  // 1. Backfill until complete.
  if (!(await isBackfillComplete(workspace))) {
    const result = await runBackfill({ workspace, apiKey });
    return { workspace, action: "backfill", result };
  }

  // 2. Grade any pending calls.
  const grade = await runGradePending(workspace);
  if (grade.batch > 0 || grade.remaining > 0) {
    return { workspace, action: "grade", result: grade };
  }

  // 3. Idle — opportunistically refresh the voice cache (hourly).
  if (await isVoiceSyncDue(workspace)) {
    const result = await runVoiceSync({ workspace, apiKey });
    return { workspace, action: "sync_voices", result };
  }

  return { workspace, action: "idle" };
}

async function handle(request: NextRequest) {
  const secretParam = new URL(request.url).searchParams.get("secret");
  if (!isCronAuthorized(request.headers, secretParam)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ticks: WorkspaceTick[] = [];
  for (const workspace of WORKSPACES) {
    // Stamp the tick time first so the dashboard's "last run" reflects every
    // invocation, even one that ends up paused or erroring below.
    await recordTick(workspace);
    try {
      ticks.push(await tickWorkspace(workspace));
    } catch (err) {
      ticks.push({
        workspace,
        action: "error",
        error: err instanceof Error ? err.message : "tick failed",
      });
    }
  }
  return NextResponse.json({ ok: true, ticks });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
