// B6-1 one-time live fix: null out prod's foreign backfill_cursor on Turso.
//
// The migration mistakenly adopted the client's Supabase `backfill_cursor` into
// our prod workspace. That value is a Supabase-domain pagination key, invalid
// for our Retell backfill, and it leaves isBackfillComplete("prod") false
// forever (complete=true && !cursor). This script surgically read-modify-writes
// ONLY the prod `app_config` `backfill_cursor` key (via setAppConfig) and
// verifies it touched nothing else (calls / call_grades / agent_voices row
// counts are snapshotted before and after and asserted unchanged).
//
// Run (guarded — pass --apply to actually write; default is a dry read):
//   npx tsx scripts/fix-prod-backfill-cursor.ts            # dry (report only)
//   npx tsx scripts/fix-prod-backfill-cursor.ts --apply    # perform the fix
//
// The migration itself no longer adopts backfill_cursor (see ADOPTED_CONFIG_KEYS
// in migrate-supabase.ts), so this is a one-time unstick for already-landed prod.

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

import { getAppConfig, setAppConfig, getDb } from "../src/lib/db";
import { APP_CONFIG_KEYS } from "../src/lib/graderRubric";
import { isBackfillComplete, BACKFILL_CURSOR_KEY } from "../src/lib/automation";
import type { Workspace } from "../src/lib/workspace";

const TARGET_WORKSPACE: Workspace = "prod";

/** Row count of a table for a workspace — used as a "did we touch data?" guard. */
async function rowCount(table: string, workspace: Workspace): Promise<number> {
  const db = await getDb();
  const res = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM ${table} WHERE workspace = ?`,
    args: [workspace],
  });
  return Number(res.rows[0]?.n ?? 0);
}

async function snapshotData(workspace: Workspace) {
  const [calls, grades, voices] = await Promise.all([
    rowCount("calls", workspace),
    rowCount("call_grades", workspace),
    rowCount("agent_voices", workspace),
  ]);
  return { calls, grades, voices };
}

async function main() {
  const apply = process.argv.includes("--apply");

  // BEFORE
  const beforeCursor = await getAppConfig<string>(TARGET_WORKSPACE, BACKFILL_CURSOR_KEY);
  const beforeComplete = await getAppConfig<boolean>(
    TARGET_WORKSPACE,
    APP_CONFIG_KEYS.backfillComplete
  );
  const beforeIsComplete = await isBackfillComplete(TARGET_WORKSPACE);
  const beforeData = await snapshotData(TARGET_WORKSPACE);

  console.log("=== B6-1 prod backfill_cursor fix ===");
  console.log("mode:", apply ? "APPLY (writing)" : "DRY (read-only)");
  console.log("BEFORE:");
  console.log("  backfill_cursor     =", JSON.stringify(beforeCursor));
  console.log("  backfill_complete   =", JSON.stringify(beforeComplete));
  console.log("  isBackfillComplete  =", beforeIsComplete);
  console.log("  data rows (untouched target):", beforeData);

  if (!apply) {
    console.log("\nDRY run — no write performed. Re-run with --apply to fix.");
    return;
  }

  // MODIFY — only the prod backfill_cursor key; leaves backfill_complete as-is.
  await setAppConfig(TARGET_WORKSPACE, BACKFILL_CURSOR_KEY, null);

  // AFTER
  const afterCursor = await getAppConfig<string>(TARGET_WORKSPACE, BACKFILL_CURSOR_KEY);
  const afterComplete = await getAppConfig<boolean>(
    TARGET_WORKSPACE,
    APP_CONFIG_KEYS.backfillComplete
  );
  const afterIsComplete = await isBackfillComplete(TARGET_WORKSPACE);
  const afterData = await snapshotData(TARGET_WORKSPACE);

  console.log("\nAFTER:");
  console.log("  backfill_cursor     =", JSON.stringify(afterCursor));
  console.log("  backfill_complete   =", JSON.stringify(afterComplete));
  console.log("  isBackfillComplete  =", afterIsComplete);
  console.log("  data rows (untouched target):", afterData);

  const dataUntouched =
    beforeData.calls === afterData.calls &&
    beforeData.grades === afterData.grades &&
    beforeData.voices === afterData.voices;
  const completePreserved = beforeComplete === afterComplete;

  console.log("\nGUARDS:");
  console.log("  calls/grades/voices unchanged:", dataUntouched);
  console.log("  backfill_complete preserved   :", completePreserved);
  console.log("  cursor cleared (null)         :", afterCursor === null);
  console.log("  isBackfillComplete now true   :", afterIsComplete === true);

  if (!dataUntouched || !completePreserved) {
    throw new Error("GUARD FAILED: unexpected change to data rows or backfill_complete");
  }
  console.log("\n✅ B6-1 applied: prod backfill_cursor nulled, no row data touched.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
