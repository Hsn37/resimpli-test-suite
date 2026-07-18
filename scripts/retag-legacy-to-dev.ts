// B9 one-time live fix: re-tag the legacy test-suite rows prod -> dev on Turso.
//
// Boss's corrected model: dev = the existing test suite; prod = the client's
// Supabase-migrated analytics data. Build 2 wrongly defaulted every pre-existing
// row to "prod", so the test-suite history (call_logs / agent_settings) is
// mis-tagged. This script surgically read-modify-writes ONLY the `workspace`
// column of call_logs + agent_settings, moving 'prod' -> 'dev'. It touches no
// other table and no other column. The prod analytics tables (calls /
// call_grades / agent_voices) are snapshotted before and after and asserted
// unchanged. Idempotent — re-running after apply is a no-op (0 rows moved).
//
// Run (guarded — pass --apply to actually write; default is a dry read):
//   npx tsx scripts/retag-legacy-to-dev.ts            # dry (report only)
//   npx tsx scripts/retag-legacy-to-dev.ts --apply    # perform the re-tag
//
// The source default is corrected too (LEGACY_ROW_WORKSPACE = "dev" in
// src/lib/db.ts), so a fresh DB stamps legacy rows "dev" going forward; this
// script is the one-time fix for the already-landed live data.

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

import { getDb } from "../src/lib/db";
import type { Workspace } from "../src/lib/workspace";

// Tables we re-tag (workspace column only).
const RETAG_TABLES = ["call_logs", "agent_settings"] as const;
// Prod analytics tables we must NOT touch — snapshotted as a "did we touch data?" guard.
const GUARD_TABLES = ["calls", "call_grades", "agent_voices"] as const;

const FROM_WORKSPACE: Workspace = "prod";
const TO_WORKSPACE: Workspace = "dev";

/** Row count of a table filtered by workspace. */
async function rowCount(table: string, workspace: Workspace): Promise<number> {
  const db = await getDb();
  const res = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM ${table} WHERE workspace = ?`,
    args: [workspace],
  });
  return Number(res.rows[0]?.n ?? 0);
}

/** prod + dev counts for a re-tag target table. */
async function tagCounts(table: string): Promise<{ prod: number; dev: number }> {
  const [prod, dev] = await Promise.all([
    rowCount(table, "prod"),
    rowCount(table, "dev"),
  ]);
  return { prod, dev };
}

/** prod-scoped counts of the untouched analytics tables (guard snapshot). */
async function snapshotGuard(): Promise<Record<string, number>> {
  const entries = await Promise.all(
    GUARD_TABLES.map(async (t) => [t, await rowCount(t, FROM_WORKSPACE)] as const)
  );
  return Object.fromEntries(entries);
}

async function reportTagCounts(label: string): Promise<Record<string, { prod: number; dev: number }>> {
  const out: Record<string, { prod: number; dev: number }> = {};
  for (const table of RETAG_TABLES) {
    out[table] = await tagCounts(table);
    console.log(`  ${label} ${table}: prod=${out[table].prod}, dev=${out[table].dev}`);
  }
  return out;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const db = await getDb();

  console.log("=== B9 re-tag legacy test-suite data prod -> dev ===");
  console.log("mode:", apply ? "APPLY (writing)" : "DRY (read-only)");

  // BEFORE
  console.log("BEFORE:");
  await reportTagCounts("");
  const beforeGuard = await snapshotGuard();
  console.log("  guard rows (untouched, prod):", beforeGuard);

  if (!apply) {
    console.log("\nDRY run — no write performed. Re-run with --apply to re-tag.");
    return;
  }

  // MODIFY — only the workspace column of the two target tables, prod -> dev.
  let moved = 0;
  for (const table of RETAG_TABLES) {
    const res = await db.execute({
      sql: `UPDATE ${table} SET workspace = ? WHERE workspace = ?`,
      args: [TO_WORKSPACE, FROM_WORKSPACE],
    });
    const n = Number(res.rowsAffected ?? 0);
    moved += n;
    console.log(`  moved ${table}: ${n} row(s) prod -> dev`);
  }

  // AFTER
  console.log("\nAFTER:");
  await reportTagCounts("");
  const afterGuard = await snapshotGuard();
  console.log("  guard rows (untouched, prod):", afterGuard);

  // GUARDS
  const guardUntouched = GUARD_TABLES.every(
    (t) => beforeGuard[t] === afterGuard[t]
  );
  const prodDrained = (
    await Promise.all(RETAG_TABLES.map((t) => rowCount(t, FROM_WORKSPACE)))
  ).every((n) => n === 0);

  console.log("\nGUARDS:");
  console.log("  calls/call_grades/agent_voices unchanged:", guardUntouched);
  console.log("  target tables' prod count now 0         :", prodDrained);
  console.log("  rows moved this run                     :", moved);

  if (!guardUntouched) {
    throw new Error(
      "GUARD FAILED: a prod analytics table (calls/call_grades/agent_voices) row count changed"
    );
  }
  if (!prodDrained) {
    throw new Error("GUARD FAILED: a target table still has prod rows after apply");
  }
  console.log("\n✅ B9 applied: call_logs + agent_settings re-tagged prod -> dev; no analytics data touched.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
