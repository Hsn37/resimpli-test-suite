// Grade the full ungraded prod backlog by looping the REAL runGradePending
// orchestration (src/lib/ingestionJobs.ts) until no eligible ungraded prod call
// remains. Same code path the cron/admin routes use — no re-implementation.
//
// Each iteration grades one bounded batch (GRADE_BATCH_SIZE in ingestionJobs)
// and logs a progress line (batch graded / errored / cumulative graded /
// remaining). A failed batch is tolerated: we log it and continue, stopping only
// after MAX_CONSECUTIVE_FAILURES in a row (so a transient OpenAI/Turso blip
// doesn't abort the whole run, but a hard outage doesn't spin forever). A final
// summary prints total graded, total errored, and elapsed time.
//
// Idempotent / safe to re-run: already-graded calls are excluded up front by
// runGradePending's eligibility guard + the ungraded scan (LEFT JOIN on
// call_grades), so a second run simply finds fewer/zero eligible calls.
//
// ingestionJobs.ts is `server-only`; run under the react-server condition so
// Next's `server-only` resolves to a no-op (same as migrate-supabase.ts) — no
// source change needed:
//   npx tsx --conditions=react-server scripts/grade-backlog.ts            # full loop
//   npx tsx --conditions=react-server scripts/grade-backlog.ts --max-batches=1   # one batch, then stop

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

import { runGradePending } from "../src/lib/ingestionJobs";
import type { Workspace } from "../src/lib/workspace";

const TARGET_WORKSPACE: Workspace = "prod";
// Stop after this many consecutive failed batches so a hard outage can't spin
// forever; a lone transient failure is logged and the loop continues.
const MAX_CONSECUTIVE_FAILURES = 3;
// Safety pause between batches (also eases OpenAI/Turso rate pressure).
const INTER_BATCH_DELAY_MS = 250;

/** Parse `--max-batches=N` (optional cap; used for the one-batch verification). */
function parseMaxBatches(): number | null {
  const arg = process.argv.find((a) => a.startsWith("--max-batches="));
  if (!arg) return null;
  const n = Number(arg.split("=")[1]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const maxBatches = parseMaxBatches();
  const startedAt = Date.now();

  console.log("=== grade-backlog: real runGradePending loop ===");
  console.log("workspace     :", TARGET_WORKSPACE);
  console.log("max batches   :", maxBatches ?? "unbounded (until empty)");
  console.log("");

  let batchNo = 0;
  let totalGraded = 0;
  let totalErrored = 0;
  let consecutiveFailures = 0;
  let stoppedReason = "backlog empty (no eligible ungraded calls remain)";

  // A "batch" here is one runGradePending call: it grades up to GRADE_BATCH_SIZE
  // eligible ungraded calls and reports how many eligible calls remain after.
  while (true) {
    if (maxBatches != null && batchNo >= maxBatches) {
      stoppedReason = `--max-batches=${maxBatches} cap reached`;
      break;
    }
    batchNo += 1;

    let result;
    try {
      result = await runGradePending(TARGET_WORKSPACE);
    } catch (e) {
      // runGradePending is designed not to throw, but guard the loop anyway.
      consecutiveFailures += 1;
      console.error(
        `[batch ${batchNo}] THREW (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES} consecutive): ${
          e instanceof Error ? e.message : String(e)
        }`
      );
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        stoppedReason = `stopped after ${MAX_CONSECUTIVE_FAILURES} consecutive failing batches`;
        break;
      }
      await sleep(INTER_BATCH_DELAY_MS);
      continue;
    }

    totalGraded += result.graded;
    totalErrored += result.failed;

    console.log(
      `[batch ${batchNo}] graded=${result.graded} errored=${result.failed} | ` +
        `cumulative graded=${totalGraded} errored=${totalErrored} | remaining=${result.remaining}`
    );

    // A batch that graded nothing but attempted work (all failed) counts as a
    // failure for the consecutive-failure guard; a batch that graded >=1 resets.
    if (result.batch > 0 && result.graded === 0) {
      consecutiveFailures += 1;
      if (result.failedIds.length > 0) {
        console.error(`[batch ${batchNo}] failed ids: ${result.failedIds.join(", ")}`);
      }
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        stoppedReason = `stopped after ${MAX_CONSECUTIVE_FAILURES} consecutive all-failed batches`;
        break;
      }
    } else {
      consecutiveFailures = 0;
    }

    // Nothing left to do this batch AND nothing remaining → backlog is drained.
    if (result.batch === 0 && result.remaining === 0) {
      break;
    }

    await sleep(INTER_BATCH_DELAY_MS);
  }

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log("");
  console.log("=== summary ===");
  console.log("stopped       :", stoppedReason);
  console.log("batches run   :", batchNo);
  console.log("total graded  :", totalGraded);
  console.log("total errored :", totalErrored);
  console.log("elapsed       :", `${elapsedSec}s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
