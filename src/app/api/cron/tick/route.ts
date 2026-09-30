import { NextRequest, NextResponse } from "next/server";
import { DASHBOARD_WORKSPACES, WORKSPACES, type Workspace } from "@/lib/workspace";
import { retellKeyForWorkspace } from "@/lib/workspaceServer";
import {
  isCronAuthorized,
  isAutomationEnabled,
  isBackfillComplete,
  isVoiceSyncDue,
  recordTick,
} from "@/lib/automation";
import { runBackfill, runGradePending, runVoiceSync } from "@/lib/ingestionJobs";
import { runCostSync, type CostSyncResult } from "@/lib/costSync";

// Grades run in parallel now, but a single slow OpenAI call can still take its
// full 30s timeout — give the tick headroom so a slow wave isn't killed midway.
export const maxDuration = 60;

// Budget for the cost sync (runs alongside the grading ticks, not after them).
// Pages are resumable, so stopping early only defers work to the next tick.
const COST_SYNC_BUDGET_MS = 40_000;

// Automation cron. One unit of work per workspace per tick:
//   - automation paused        → skip
//   - backfill not complete     → run one backfill chunk
//   - ungraded calls remain     → run one grade-pending batch
//   - idle + voice-sync due     → refresh the agent-voice cache (hourly)
//
// Separately, and for EVERY workspace (not only DASHBOARD_WORKSPACES), the
// cost sync (at most every 15 min — it skips the ticks in between, see
// SYNC_INTERVAL_MS in costSync.ts) pulls new calls into call_costs for the
// /costs page, advances its
// history backfill, rebuilds the daily roll-ups the page reads and prunes old
// call rows. It ignores the automation pause — spend tracking has nothing to
// do with grading.
//
// Guarded by CRON_SECRET (Bearer / x-cron-secret header / ?secret=) — never
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

  // Only workspaces with a live dashboard are ticked — outbound / speed-to-lead
  // have no dashboard set up yet, so nothing is ingested or graded for them.
  // Workspaces share no state, so run them concurrently — the tick's wall time
  // is one workspace's work, not the sum. Each stamps its tick time first so the
  // dashboard's "last run" reflects every invocation, even a paused/errored one.
  const deadline = Date.now() + COST_SYNC_BUDGET_MS;
  const costsPromise = Promise.all(
    WORKSPACES.map(async (workspace): Promise<CostSyncResult | { workspace: Workspace; error: string }> => {
      try {
        return await runCostSync(workspace, retellKeyForWorkspace(workspace), { deadline });
      } catch (err) {
        return { workspace, error: err instanceof Error ? err.message : "cost sync failed" };
      }
    })
  );
  const ticks = await Promise.all(
    DASHBOARD_WORKSPACES.map(async (workspace): Promise<WorkspaceTick> => {
      await recordTick(workspace);
      try {
        return await tickWorkspace(workspace);
      } catch (err) {
        return {
          workspace,
          action: "error",
          error: err instanceof Error ? err.message : "tick failed",
        };
      }
    })
  );
  const costs = await costsPromise;
  return NextResponse.json({ ok: true, ticks, costs });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
