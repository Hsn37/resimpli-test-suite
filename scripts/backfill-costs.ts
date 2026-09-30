// One-off / catch-up backfill of call_costs + the call_cost_daily roll-ups
// (the /costs dashboard). The cron tick does the same work in 40s slices; this
// runs it to completion locally with bigger pages, which is much faster for
// the first load (outbound is ~25k+ calls a month).
//
//   npx tsx --conditions=react-server scripts/backfill-costs.ts
//   npx tsx --conditions=react-server scripts/backfill-costs.ts --since 2025-06-01
//   npx tsx --conditions=react-server scripts/backfill-costs.ts --workspace outbound
//
// --since moves the history floor earlier than COST_HISTORY_START (it never
// shrinks it); days older than RAW_RETENTION_DAYS are rolled up, then their
// call rows are pruned. Safe to interrupt and re-run: every cursor and the
// roll-up queue are resumable.
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

import { WORKSPACES, isWorkspace, type Workspace } from "../src/lib/workspace";
import { retellKeyForWorkspace } from "../src/lib/retellKeys";
import { extendCostHistory, getCostSyncStates, runCostSync } from "../src/lib/costSync";
import { costDayStartMs, isDay } from "../src/lib/costs";

const MAX_CONSECUTIVE_FAILURES = 5;
const LOCK_WAIT_MS = 10_000;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function backfill(workspace: Workspace, sinceMs: number | null) {
  const apiKey = retellKeyForWorkspace(workspace);
  if (sinceMs != null) await extendCostHistory(workspace, sinceMs);
  let total = 0;
  let failures = 0;
  for (;;) {
    const r = await runCostSync(workspace, apiKey, {
      deadline: Date.now() + 60_000,
      pageSize: 1000,
      unthrottled: true,
    });
    if (r.skipped) {
      // The cron (or another script) is mid-run on this workspace; its lock
      // lapses within a minute or two.
      console.log(`[${workspace}] another sync holds the lock — waiting`);
      await new Promise((res) => setTimeout(res, LOCK_WAIT_MS));
      continue;
    }
    if (r.error) {
      // Transient network / Retell errors: both cursors are saved per page, so
      // back off and resume rather than abandoning a long backfill.
      if (++failures > MAX_CONSECUTIVE_FAILURES) throw new Error(`${workspace}: ${r.error}`);
      console.warn(`[${workspace}] ${r.error} — retrying (${failures}/${MAX_CONSECUTIVE_FAILURES})`);
      await new Promise((res) => setTimeout(res, failures * 5_000));
      continue;
    }
    failures = 0;
    total += r.forward.fetched + r.backfill.fetched;
    const reached = r.backfill.cursor ? new Date(r.backfill.cursor).toISOString().slice(0, 10) : "done";
    console.log(
      `[${workspace}] fetched ${total} calls so far · backfill at ${reached} · roll-up days pending ${r.rollups.pending}`
    );
    if (r.backfill.done && r.rollups.pending === 0) break;
  }
  const state = (await getCostSyncStates()).find((s) => s.workspace === workspace)!;
  console.log(
    `[${workspace}] complete — history from ${new Date(state.backfilledTo ?? 0).toISOString().slice(0, 10)}`
  );
}

async function main() {
  const since = arg("since");
  if (since && !isDay(since)) throw new Error(`Bad --since date (want YYYY-MM-DD): ${since}`);
  const sinceMs = since ? costDayStartMs(since) : null;
  const only = arg("workspace");
  if (only && !isWorkspace(only)) throw new Error(`Unknown workspace: ${only}`);
  const targets = only ? [only as Workspace] : [...WORKSPACES];
  // Separate Retell accounts, so the workspaces backfill in parallel.
  await Promise.all(targets.map((ws) => backfill(ws, sinceMs)));
}

main().catch((err) => {
  console.error("Cost backfill failed:", err);
  process.exit(1);
});
