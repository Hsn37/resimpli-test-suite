// One-time Supabase -> Turso migration for the call-grader "prod" workspace.
//
// Reads the client's Supabase (calls, call_grades, failure_classes, app_config,
// agent_voices) via PostgREST + fetch (NO @supabase/supabase-js dependency),
// maps the Postgres types to our Turso schema, tags every row workspace="prod",
// and upserts idempotently. Existing grades are copied AS-IS (no re-grading, no
// OpenAI call). Re-running is safe: our id for a source row is derived
// deterministically from its Supabase UUID, so upserts hit the same rows.
//
// Run a dry-run first (fetch + report counts, write nothing):
//   npx tsx scripts/migrate-supabase.ts --dry-run
// Then the real run against live Turso (.env.local):
//   npx tsx scripts/migrate-supabase.ts
//
// If Supabase auth/read fails (RLS/auth), the script stops gracefully and asks
// Boss for a service-role key rather than fabricating data.

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

import {
  upsertCallGrade,
  upsertAgentVoice,
  getAppConfig,
  setAppConfig,
  getDb,
} from "../src/lib/db";
import { APP_CONFIG_KEYS } from "../src/lib/graderRubric";
import type { Workspace } from "../src/lib/workspace";

// ---------------------------------------------------------------------------
// Constants — no magic strings/numbers.
// ---------------------------------------------------------------------------
const TARGET_WORKSPACE: Workspace = "prod";
// Page small + ordered: a full `select=*` on `calls` (large transcript/raw_payload
// JSONB) hits Supabase's statement timeout at 1000 rows; 200 ordered by id keeps
// each page well under the limit and makes offset pagination stable.
const PAGE_SIZE = 200;
const DRY_RUN_FLAG = "--dry-run";
// A full `select=*` on `calls` (large transcript/raw_payload JSONB) can hit
// Supabase's statement timeout, and deep offset pagination makes it worse. We
// page by keyset (pk > lastSeen) which stays cheap at any depth, and retry the
// occasional transient timeout a few times before giving up.
const PAGE_RETRIES = 4;
const RETRY_BACKOFF_MS = 1500;
const STATEMENT_TIMEOUT_CODE = "57014";

// Primary-key column per table — used both to order and to keyset-paginate.
const PK_COLUMN: Record<string, string> = {
  calls: "id",
  call_grades: "call_id",
  failure_classes: "key",
  app_config: "key",
  agent_voices: "agent_id",
};

// Source tables to migrate.
const TABLE = {
  calls: "calls",
  callGrades: "call_grades",
  failureClasses: "failure_classes",
  appConfig: "app_config",
  agentVoices: "agent_voices",
} as const;

// app_config keys we adopt from the client's real deployment (their genuine
// ingestion/tracking state), rather than keeping our generic seed. Everything
// else in app_config (grader_model, agent_id_allowlist, automation_enabled,
// grader_system_prompt) keeps our seeded value — see decision note in handoff.
//
// NB: we deliberately do NOT adopt "backfill_cursor". The client's cursor is a
// Supabase-domain pagination value that is meaningless to our Retell backfill
// (which paginates on Retell call_ids). Adopting it also contradicts
// backfill_complete=true and would leave isBackfillComplete() false forever
// (see B6-1). Our backfill cursor state is independent of theirs.
const ADOPTED_CONFIG_KEYS: string[] = [
  APP_CONFIG_KEYS.trackingStartDate,
  APP_CONFIG_KEYS.backfillComplete,
];

// ---------------------------------------------------------------------------
// Supabase PostgREST reader (fetch only).
// ---------------------------------------------------------------------------
function supabaseEnv(): { url: string; key: string } {
  const url = process.env.MIGRATION_SUPABASE_URL;
  const key = process.env.MIGRATION_SUPABASE_KEY;
  if (!url || !key) {
    throw new Error(
      "MIGRATION_SUPABASE_URL / MIGRATION_SUPABASE_KEY not set in .env.local"
    );
  }
  return { url: url.replace(/\/$/, ""), key };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fetch one keyset page (pk > afterPk), retrying transient statement timeouts. */
async function fetchPage(
  table: string,
  pk: string,
  afterPk: string | null
): Promise<Record<string, unknown>[]> {
  const { url, key } = supabaseEnv();
  const filter = afterPk == null ? "" : `&${pk}=gt.${encodeURIComponent(afterPk)}`;
  const target = `${url}/rest/v1/${table}?select=*&order=${pk}.asc&limit=${PAGE_SIZE}${filter}`;
  let lastErr = "";
  for (let attempt = 0; attempt <= PAGE_RETRIES; attempt++) {
    const res = await fetch(target, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Supabase read of "${table}" was denied (HTTP ${res.status}). The publishable ` +
          `key can't read this table under RLS — Boss must supply a service-role key.`
      );
    }
    if (res.ok) return (await res.json()) as Record<string, unknown>[];
    const body = await res.text();
    lastErr = `HTTP ${res.status} ${body.slice(0, 200)}`;
    // Retry only the transient statement-timeout; anything else is fatal.
    if (res.status >= 500 && body.includes(STATEMENT_TIMEOUT_CODE) && attempt < PAGE_RETRIES) {
      await sleep(RETRY_BACKOFF_MS * (attempt + 1));
      continue;
    }
    throw new Error(`Supabase read of "${table}" failed: ${lastErr}`);
  }
  throw new Error(`Supabase read of "${table}" failed after retries: ${lastErr}`);
}

/** Fetch every row of a Supabase table via keyset pagination on its PK. */
async function fetchAll(table: string): Promise<Record<string, unknown>[]> {
  const pk = PK_COLUMN[table];
  if (!pk) throw new Error(`No PK column configured for table "${table}"`);
  const rows: Record<string, unknown>[] = [];
  let afterPk: string | null = null;
  for (;;) {
    const page = await fetchPage(table, pk, afterPk);
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    afterPk = String(page[page.length - 1][pk]);
  }
  return rows;
}

/** HEAD request for an exact row count (cheap dry-run probe). */
async function countRows(table: string): Promise<number> {
  const { url, key } = supabaseEnv();
  const res = await fetch(`${url}/rest/v1/${table}?select=*`, {
    method: "HEAD",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: "count=exact",
      Range: "0-0",
    },
  });
  if (!res.ok && res.status !== 206) {
    throw new Error(`Supabase count of "${table}" failed: HTTP ${res.status}`);
  }
  const range = res.headers.get("content-range") ?? "";
  const total = range.split("/")[1];
  return total && total !== "*" ? Number(total) : 0;
}

// ---------------------------------------------------------------------------
// Type mapping helpers (Postgres -> Turso).
// ---------------------------------------------------------------------------

/**
 * Deterministic Turso id for a Supabase UUID. Same shape as db.newId ("call_" +
 * 24 hex chars) but derived from the source UUID so re-runs are idempotent and
 * call_grades.call_id keeps linking to the migrated call.
 */
function stableCallId(sourceUuid: string): string {
  return `call_${sourceUuid.replace(/-/g, "").slice(0, 24)}`;
}

/** TIMESTAMPTZ / ISO string -> epoch ms (null-safe). */
function toEpochMs(value: unknown): number | null {
  if (value == null) return null;
  const ms = typeof value === "number" ? value : Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

function toNumberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toStringOrNull(value: unknown): string | null {
  return value == null ? null : String(value);
}

function toRecordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

// ---------------------------------------------------------------------------
// Migration passes.
// ---------------------------------------------------------------------------
interface CallsResult {
  count: number;
  idMap: Map<string, string>; // source UUID -> our call id
}

async function migrateCalls(dryRun: boolean): Promise<CallsResult> {
  const rows = await fetchAll(TABLE.calls);
  const idMap = new Map<string, string>();
  let count = 0;
  for (const r of rows) {
    const sourceId = String(r.id);
    const ourId = stableCallId(sourceId);
    idMap.set(sourceId, ourId);
    if (dryRun) {
      count += 1;
      continue;
    }
    // upsertCall derives its own id from (workspace, retell_call_id); to force
    // our deterministic id we upsert directly via getDb so grades stay linked.
    await upsertCallRow({
      id: ourId,
      workspace: TARGET_WORKSPACE,
      retellCallId: String(r.retell_call_id),
      agentId: toStringOrNull(r.agent_id),
      agentVersion: toStringOrNull(r.agent_version),
      timestamp: toEpochMs(r.timestamp),
      durationSeconds: toNumberOrNull(r.duration_seconds),
      phoneNumber: toStringOrNull(r.phone_number),
      transcript: r.transcript ?? null,
      dynamicVariables: toRecordOrNull(r.dynamic_variables),
      recordingUrl: toStringOrNull(r.recording_url),
      latency: r.latency ?? null,
      voiceId: toStringOrNull(r.voice_id),
      voiceName: toStringOrNull(r.voice_name),
      rawPayload: r.raw_payload ?? null,
      createdAt: toEpochMs(r.created_at),
    });
    count += 1;
  }
  return { count, idMap };
}

/**
 * Direct upsert on calls keyed by (workspace, retell_call_id) using a caller-
 * supplied deterministic id. Mirrors db.upsertCall's column mapping but lets the
 * migration pin the id so call_grades.call_id keeps linking on re-runs.
 */
async function upsertCallRow(input: {
  id: string;
  workspace: Workspace;
  retellCallId: string;
  agentId: string | null;
  agentVersion: string | null;
  timestamp: number | null;
  durationSeconds: number | null;
  phoneNumber: string | null;
  transcript: unknown;
  dynamicVariables: Record<string, unknown> | null;
  recordingUrl: string | null;
  latency: unknown;
  voiceId: string | null;
  voiceName: string | null;
  rawPayload: unknown;
  createdAt: number | null;
}): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.execute({
    sql: `INSERT INTO calls
            (id, workspace, retell_call_id, agent_id, agent_version, timestamp,
             duration_seconds, phone_number, transcript, dynamic_variables,
             recording_url, latency, voice_id, voice_name, raw_payload, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(workspace, retell_call_id) DO UPDATE SET
            agent_id          = excluded.agent_id,
            agent_version     = excluded.agent_version,
            timestamp         = excluded.timestamp,
            duration_seconds  = excluded.duration_seconds,
            phone_number      = excluded.phone_number,
            transcript        = excluded.transcript,
            dynamic_variables = excluded.dynamic_variables,
            recording_url     = excluded.recording_url,
            latency           = excluded.latency,
            voice_id          = excluded.voice_id,
            voice_name        = excluded.voice_name,
            raw_payload       = excluded.raw_payload`,
    args: [
      input.id,
      input.workspace,
      input.retellCallId,
      input.agentId,
      input.agentVersion,
      input.timestamp ?? now,
      input.durationSeconds,
      input.phoneNumber,
      input.transcript == null ? null : JSON.stringify(input.transcript),
      input.dynamicVariables == null ? null : JSON.stringify(input.dynamicVariables),
      input.recordingUrl,
      input.latency == null ? null : JSON.stringify(input.latency),
      input.voiceId,
      input.voiceName,
      input.rawPayload == null ? null : JSON.stringify(input.rawPayload),
      input.createdAt ?? now,
    ],
  });
}

async function migrateGrades(
  idMap: Map<string, string>,
  dryRun: boolean
): Promise<{ count: number; orphaned: number }> {
  const rows = await fetchAll(TABLE.callGrades);
  let count = 0;
  let orphaned = 0;
  for (const r of rows) {
    const ourCallId = idMap.get(String(r.call_id));
    if (!ourCallId) {
      // Grade points at a call we didn't migrate (shouldn't happen with a full
      // pull, but guard so we never write a dangling grade).
      orphaned += 1;
      continue;
    }
    if (dryRun) {
      count += 1;
      continue;
    }
    // Copy the grade AS-IS — no re-grading, no OpenAI.
    await upsertCallGrade({
      callId: ourCallId,
      workspace: TARGET_WORKSPACE,
      grade: toNumberOrNull(r.grade),
      applicableCount: toNumberOrNull(r.applicable_count) ?? 0,
      passedCount: toNumberOrNull(r.passed_count) ?? 0,
      results: toRecordOrNull(r.results) ?? {},
      aiCallout: r.ai_callout === true,
      aiCalloutQuote: toStringOrNull(r.ai_callout_quote),
      repScore: toNumberOrNull(r.rep_score),
      repScorecard: toRecordOrNull(r.rep_scorecard) ?? {},
      model: toStringOrNull(r.model),
      error: toStringOrNull(r.error),
    });
    count += 1;
  }
  return { count, orphaned };
}

async function migrateAgentVoices(dryRun: boolean): Promise<number> {
  const rows = await fetchAll(TABLE.agentVoices);
  let count = 0;
  for (const r of rows) {
    const agentId = toStringOrNull(r.agent_id);
    if (!agentId) continue;
    if (!dryRun) {
      await upsertAgentVoice({
        workspace: TARGET_WORKSPACE,
        agentId,
        voiceId: toStringOrNull(r.voice_id),
        voiceName: toStringOrNull(r.voice_name),
        agentName: toStringOrNull(r.agent_name),
      });
    }
    count += 1;
  }
  return count;
}

/**
 * app_config: only adopt the client's genuine ingestion/tracking state
 * (tracking_start_date, backfill_complete, backfill_cursor). Our seed already
 * holds sensible defaults for the grader keys, so we don't clobber those.
 */
async function migrateAppConfig(
  dryRun: boolean
): Promise<{ adopted: string[]; skipped: string[] }> {
  const rows = await fetchAll(TABLE.appConfig);
  const adopted: string[] = [];
  const skipped: string[] = [];
  for (const r of rows) {
    const key = String(r.key);
    if (!ADOPTED_CONFIG_KEYS.includes(key)) {
      skipped.push(key);
      continue;
    }
    if (!dryRun) {
      await setAppConfig(TARGET_WORKSPACE, key, r.value);
    }
    adopted.push(key);
  }
  return { adopted, skipped };
}

/** failure_classes exist in Supabase but our seed is verbatim-identical, so we
 * only report the count and never clobber the seeded (admin-editable) rows. */
async function reportFailureClasses(): Promise<number> {
  return (await fetchAll(TABLE.failureClasses)).length;
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------
async function main() {
  const dryRun = process.argv.includes(DRY_RUN_FLAG);
  console.log(
    `\n=== Supabase -> Turso migration (${dryRun ? "DRY RUN — writes nothing" : "LIVE — writing to Turso"}) ===`
  );
  console.log(`Target workspace: "${TARGET_WORKSPACE}"\n`);

  // Fail fast + gracefully if Supabase can't be read.
  let counts: Record<string, number>;
  try {
    counts = {
      calls: await countRows(TABLE.calls),
      call_grades: await countRows(TABLE.callGrades),
      failure_classes: await countRows(TABLE.failureClasses),
      app_config: await countRows(TABLE.appConfig),
      agent_voices: await countRows(TABLE.agentVoices),
    };
  } catch (err) {
    console.error(
      `\nSTOPPED — could not read Supabase. ${(err as Error).message}\n` +
        `No data was written. Ask Boss for a service-role key if this is an RLS/auth issue.`
    );
    process.exit(1);
  }

  console.log("Source row counts (Supabase):");
  for (const [t, n] of Object.entries(counts)) console.log(`  ${t}: ${n}`);
  console.log("");

  try {
    const { count: callCount, idMap } = await migrateCalls(dryRun);
    const grades = await migrateGrades(idMap, dryRun);
    const voices = await migrateAgentVoices(dryRun);
    const cfg = await migrateAppConfig(dryRun);
    const failureClassCount = await reportFailureClasses();

    console.log(`${dryRun ? "Would migrate" : "Migrated"} into workspace "${TARGET_WORKSPACE}":`);
    console.log(`  calls:          ${callCount}`);
    console.log(`  call_grades:    ${grades.count}${grades.orphaned ? ` (skipped ${grades.orphaned} orphaned)` : ""}`);
    console.log(`  agent_voices:   ${voices}`);
    console.log(
      `  app_config:     adopted [${cfg.adopted.join(", ") || "none"}]; kept-our-seed [${cfg.skipped.join(", ") || "none"}]`
    );
    console.log(`  failure_classes: ${failureClassCount} in Supabase (seed is verbatim-identical — not clobbered)`);

    if (!dryRun) {
      const landedTracking = await getAppConfig<string>(
        TARGET_WORKSPACE,
        APP_CONFIG_KEYS.trackingStartDate
      );
      console.log(`\nProd tracking_start_date now: ${landedTracking}`);
    }
    console.log(`\n=== ${dryRun ? "Dry run complete — nothing written." : "Migration complete."} ===\n`);
  } catch (err) {
    console.error(`\nFAILED mid-migration: ${(err as Error).message}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
