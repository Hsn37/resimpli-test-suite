import "server-only";
import { createClient, type Client } from "@libsql/client";
import { starsToScore } from "./grade";
import type { TestCase } from "./testCase";
import { ALL_AGENTS_TAG } from "./presets";
import {
  FAILURE_CLASSES,
  REP_DIMENSIONS,
  DEFAULT_APP_CONFIG,
  type RubricEntry,
} from "./graderRubric";
import { WORKSPACES, type Workspace } from "./workspace";

// Workspace tag stamped onto legacy call_logs / agent_settings rows that predate
// the workspace dimension. Pinned to "dev": under Boss's corrected model (Build 9)
// dev = the existing test suite and prod = the client's Supabase-migrated data, so
// this historical test-suite data belongs in "dev" (Build 2 wrongly defaulted it to
// "prod"). Kept as its own const (decoupled from DEFAULT_WORKSPACE) so a fresh DB
// stamps pre-existing rows "dev" without coupling to the app default.
const LEGACY_ROW_WORKSPACE: Workspace = "dev";

// Turso / libSQL client. Reused across requests in the same server process.
let client: Client | null = null;
let schemaReady: Promise<void> | null = null;

function getClient(): Client {
  if (client) return client;
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) {
    throw new Error("TURSO_DATABASE_URL is not set");
  }
  client = createClient({ url, authToken });
  return client;
}

// Idempotent schema creation, memoized at most once per process. In production
// the request path skips this (see getDb) — the deploy-time migration
// (scripts/migrate.ts → migrateSchema) owns DDL there, so cold starts pay no
// round-trips. This stays as the zero-setup lazy bootstrap for local dev + CLI
// scripts.
function ensureSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  const db = getClient();
  const ready = (async () => {
    await db.execute(
      `CREATE TABLE IF NOT EXISTS call_logs (
        call_id     TEXT PRIMARY KEY,
        agent_id    TEXT,
        agent_name  TEXT,
        version     INTEGER,
        direction   TEXT,
        variables   TEXT,
        user_email  TEXT,
        timestamp   INTEGER,
        duration    INTEGER,
        grade       INTEGER,
        note        TEXT,
        updated_at  INTEGER
      )`
    );
    // Backfill columns on databases created before these were added. The
    // workspace column defaults to LEGACY_ROW_WORKSPACE ("dev") so every
    // pre-existing row (placed before workspaces existed) is treated as dev.
    for (const col of [
      "agent_id TEXT",
      "duration INTEGER",
      `workspace TEXT NOT NULL DEFAULT '${LEGACY_ROW_WORKSPACE}'`,
    ]) {
      try {
        await db.execute(`ALTER TABLE call_logs ADD COLUMN ${col}`);
      } catch {
        // Column already exists.
      }
    }

    await Promise.all([
      db.execute(
        `CREATE TABLE IF NOT EXISTS test_case_sets (
          id          TEXT PRIMARY KEY,
          name        TEXT,
          created_at  INTEGER,
          updated_at  INTEGER
        )`
      ),
      db.execute(
        `CREATE TABLE IF NOT EXISTS test_cases (
          id                TEXT PRIMARY KEY,
          set_id            TEXT,
          sort_order        INTEGER,
          name              TEXT,
          user_prompt       TEXT,
          metrics           TEXT,
          dynamic_variables TEXT,
          tool_mocks        TEXT,
          llm_model         TEXT,
          updated_at        INTEGER
        )`
      ),
      db.execute(
        `CREATE TABLE IF NOT EXISTS batch_test_runs (
          id               TEXT PRIMARY KEY,
          set_id           TEXT,
          set_name         TEXT,
          agent_id         TEXT,
          agent_name       TEXT,
          version          INTEGER,
          response_engine  TEXT,
          status           TEXT,
          pass_count       INTEGER,
          fail_count       INTEGER,
          error_count      INTEGER,
          total_count      INTEGER,
          user_email       TEXT,
          created_at       INTEGER,
          updated_at       INTEGER
        )`
      ),
      db.execute(
        `CREATE TABLE IF NOT EXISTS ai_grades (
          id           TEXT PRIMARY KEY,
          subject_type TEXT,
          subject_id   TEXT,
          score        INTEGER,
          note         TEXT,
          chat_id      TEXT,
          created_at   INTEGER
        )`
      ),
      db.execute(
        `CREATE TABLE IF NOT EXISTS agent_settings (
          agent_id    TEXT PRIMARY KEY,
          enabled     INTEGER DEFAULT 1,
          tag         TEXT DEFAULT 'all',
          updated_at  INTEGER
        )`
      ),
    ]);
    // Backfill columns on databases created before these were added. Existing
    // per-agent overrides predate workspaces, so they default to dev
    // (LEGACY_ROW_WORKSPACE).
    for (const col of [
      "tag TEXT DEFAULT 'all'",
      `workspace TEXT NOT NULL DEFAULT '${LEGACY_ROW_WORKSPACE}'`,
    ]) {
      try {
        await db.execute(`ALTER TABLE agent_settings ADD COLUMN ${col}`);
      } catch {
        // Column already exists.
      }
    }
    await db.execute(
      `CREATE UNIQUE INDEX IF NOT EXISTS ai_grades_subject
       ON ai_grades (subject_type, subject_id)`
    );

    // -----------------------------------------------------------------------
    // Call-grader tables (ported from the client's Supabase schema). Every row
    // is scoped to a workspace ("dev" / "prod"). Additive — existing tables and
    // flows above are untouched.
    // -----------------------------------------------------------------------
    await Promise.all([
      db.execute(
        `CREATE TABLE IF NOT EXISTS calls (
          id                TEXT PRIMARY KEY,
          workspace         TEXT NOT NULL,
          retell_call_id    TEXT NOT NULL,
          agent_id          TEXT,
          agent_version     TEXT,
          timestamp         INTEGER,
          duration_seconds  INTEGER,
          phone_number      TEXT,
          transcript        TEXT,
          dynamic_variables TEXT,
          recording_url     TEXT,
          latency           TEXT,
          voice_id          TEXT,
          voice_name        TEXT,
          raw_payload       TEXT,
          created_at        INTEGER
        )`
      ),
      db.execute(
        `CREATE TABLE IF NOT EXISTS call_grades (
          call_id          TEXT PRIMARY KEY,
          workspace        TEXT NOT NULL,
          grade            REAL,
          applicable_count INTEGER NOT NULL DEFAULT 0,
          passed_count     INTEGER NOT NULL DEFAULT 0,
          results          TEXT NOT NULL DEFAULT '{}',
          ai_callout       INTEGER NOT NULL DEFAULT 0,
          ai_callout_quote TEXT,
          rep_score        REAL,
          rep_scorecard    TEXT NOT NULL DEFAULT '{}',
          model            TEXT,
          error            TEXT,
          graded_at        INTEGER
        )`
      ),
      db.execute(
        `CREATE TABLE IF NOT EXISTS failure_classes (
          workspace   TEXT NOT NULL,
          key         TEXT NOT NULL,
          name        TEXT NOT NULL,
          definition  TEXT NOT NULL,
          sort_order  INTEGER NOT NULL DEFAULT 0,
          active      INTEGER NOT NULL DEFAULT 1,
          updated_at  INTEGER,
          PRIMARY KEY (workspace, key)
        )`
      ),
      db.execute(
        `CREATE TABLE IF NOT EXISTS rep_dimensions (
          workspace   TEXT NOT NULL,
          key         TEXT NOT NULL,
          name        TEXT NOT NULL,
          definition  TEXT NOT NULL,
          sort_order  INTEGER NOT NULL DEFAULT 0,
          active      INTEGER NOT NULL DEFAULT 1,
          updated_at  INTEGER,
          PRIMARY KEY (workspace, key)
        )`
      ),
      db.execute(
        `CREATE TABLE IF NOT EXISTS app_config (
          workspace   TEXT NOT NULL,
          key         TEXT NOT NULL,
          value       TEXT NOT NULL,
          updated_at  INTEGER,
          PRIMARY KEY (workspace, key)
        )`
      ),
      db.execute(
        `CREATE TABLE IF NOT EXISTS agent_voices (
          workspace       TEXT NOT NULL,
          agent_id        TEXT NOT NULL,
          voice_id        TEXT,
          voice_name      TEXT,
          agent_name      TEXT,
          last_synced_at  INTEGER,
          PRIMARY KEY (workspace, agent_id)
        )`
      ),
    ]);
    await Promise.all([
      // retell_call_id is unique per workspace (Lovable had a global UNIQUE).
      db.execute(
        `CREATE UNIQUE INDEX IF NOT EXISTS calls_workspace_retell_id
         ON calls (workspace, retell_call_id)`
      ),
      db.execute(
        `CREATE INDEX IF NOT EXISTS calls_workspace_timestamp
         ON calls (workspace, timestamp DESC)`
      ),
      db.execute(
        `CREATE INDEX IF NOT EXISTS calls_workspace_agent_version
         ON calls (workspace, agent_version)`
      ),
      db.execute(
        `CREATE INDEX IF NOT EXISTS calls_workspace_agent_id
         ON calls (workspace, agent_id)`
      ),
      db.execute(
        `CREATE INDEX IF NOT EXISTS calls_workspace_voice_name
         ON calls (workspace, voice_name)`
      ),
      db.execute(
        `CREATE INDEX IF NOT EXISTS call_grades_workspace_grade
         ON call_grades (workspace, grade)`
      ),
    ]);
    await seedGraderRubric(db);
  })();
  schemaReady = ready;
  return ready;
}

/**
 * Apply the full schema once. Entry point for the deploy-time migration step
 * (`npm run migrate`, wired into the build). Reuses ensureSchema's idempotent
 * DDL + seed so there is a single source of truth for the schema.
 */
export function migrateSchema(): Promise<void> {
  return ensureSchema();
}

// ---------------------------------------------------------------------------
// Call-grader seed (idempotent). INSERT OR IGNORE so admin edits to a
// workspace's rubric/config are never clobbered on re-bootstrap.
// ---------------------------------------------------------------------------

async function seedRubricTable(
  db: Client,
  table: "failure_classes" | "rep_dimensions",
  entries: RubricEntry[],
  workspace: Workspace,
  now: number
): Promise<void> {
  await db.batch(
    entries.map((entry) => ({
      sql: `INSERT OR IGNORE INTO ${table}
              (workspace, key, name, definition, sort_order, active, updated_at)
            VALUES (?, ?, ?, ?, ?, 1, ?)`,
      args: [workspace, entry.key, entry.name, entry.definition, entry.sort_order, now],
    }))
  );
}

async function seedAppConfig(
  db: Client,
  workspace: Workspace,
  now: number
): Promise<void> {
  await db.batch(
    Object.entries(DEFAULT_APP_CONFIG).map(([key, value]) => ({
      sql: `INSERT OR IGNORE INTO app_config (workspace, key, value, updated_at)
            VALUES (?, ?, ?, ?)`,
      args: [workspace, key, JSON.stringify(value), now],
    }))
  );
}

async function seedGraderRubric(db: Client): Promise<void> {
  const now = Date.now();
  for (const workspace of WORKSPACES) {
    await seedRubricTable(db, "failure_classes", FAILURE_CLASSES, workspace, now);
    await seedRubricTable(db, "rep_dimensions", REP_DIMENSIONS, workspace, now);
    await seedAppConfig(db, workspace, now);
  }
}

export async function getDb(): Promise<Client> {
  // Production applies the schema at deploy time (scripts/migrate.ts), so the
  // request path never runs DDL. Outside production we lazily bootstrap once per
  // process for zero-setup local dev and CLI scripts.
  if (process.env.NODE_ENV !== "production") await ensureSchema();
  return getClient();
}

export interface CallLog {
  call_id: string;
  agent_id: string | null;
  agent_name: string | null;
  version: number | null;
  direction: string | null;
  variables: Record<string, string> | null;
  user_email: string | null;
  timestamp: number | null;
  duration: number | null;
  grade: number | null;
  note: string | null;
}

export interface InsertCallLogInput {
  callId: string;
  workspace: Workspace;
  agentId?: string;
  agentName?: string;
  version?: number;
  direction?: string;
  variables?: Record<string, string>;
  userEmail?: string;
  timestamp?: number;
  duration?: number;
}

/** Upsert the base call record when a call ends. Grade/note are set later. */
export async function insertCallLog(input: InsertCallLogInput): Promise<void> {
  const db = await getDb();
  await db.execute({
    sql: `INSERT INTO call_logs
            (call_id, workspace, agent_id, agent_name, version, direction, variables, user_email, timestamp, duration, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(call_id) DO UPDATE SET
            workspace  = excluded.workspace,
            agent_id   = excluded.agent_id,
            agent_name = excluded.agent_name,
            version    = excluded.version,
            direction  = excluded.direction,
            variables  = excluded.variables,
            user_email = excluded.user_email,
            timestamp  = excluded.timestamp,
            duration   = excluded.duration,
            updated_at = excluded.updated_at`,
    args: [
      input.callId,
      input.workspace,
      input.agentId ?? null,
      input.agentName ?? null,
      input.version ?? null,
      input.direction ?? null,
      input.variables ? JSON.stringify(input.variables) : null,
      input.userEmail ?? null,
      input.timestamp ?? Date.now(),
      input.duration ?? null,
      Date.now(),
    ],
  });
}

/**
 * Update grade + note for a call, creating a stub row if it doesn't exist yet.
 * `grade` is a 1..MAX_STARS star count; it's stored as a score out of 10.
 */
export async function updateCallGrade(
  workspace: Workspace,
  callId: string,
  grade?: number,
  note?: string
): Promise<void> {
  const db = await getDb();
  await db.execute({
    sql: `INSERT INTO call_logs (call_id, workspace, grade, note, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(call_id) DO UPDATE SET
            grade = excluded.grade,
            note = excluded.note,
            updated_at = excluded.updated_at`,
    args: [callId, workspace, starsToScore(grade), note ?? null, Date.now()],
  });
}

function rowToCallLog(row: Record<string, unknown>): CallLog {
  let variables: Record<string, string> | null = null;
  if (typeof row.variables === "string") {
    try {
      variables = JSON.parse(row.variables);
    } catch {
      variables = null;
    }
  }
  return {
    call_id: String(row.call_id),
    agent_id: (row.agent_id as string) ?? null,
    agent_name: (row.agent_name as string) ?? null,
    version: row.version == null ? null : Number(row.version),
    direction: (row.direction as string) ?? null,
    variables,
    user_email: (row.user_email as string) ?? null,
    timestamp: row.timestamp == null ? null : Number(row.timestamp),
    duration: row.duration == null ? null : Number(row.duration),
    grade: row.grade == null ? null : Number(row.grade),
    note: (row.note as string) ?? null,
  };
}

/** Fetch call logs for a set of call ids in a workspace, keyed by call_id. */
export async function getCallLogsByIds(
  workspace: Workspace,
  callIds: string[]
): Promise<Map<string, CallLog>> {
  const map = new Map<string, CallLog>();
  if (callIds.length === 0) return map;

  const db = await getDb();
  // Chunk the IN (...) so a large window stays well under SQLite's bind-var cap.
  const CHUNK = 200;
  for (let i = 0; i < callIds.length; i += CHUNK) {
    const batch = callIds.slice(i, i + CHUNK);
    const placeholders = batch.map(() => "?").join(", ");
    const result = await db.execute({
      sql: `SELECT * FROM call_logs WHERE workspace = ? AND call_id IN (${placeholders})`,
      args: [workspace, ...batch],
    });
    for (const row of result.rows) {
      const log = rowToCallLog(row as unknown as Record<string, unknown>);
      map.set(log.call_id, log);
    }
  }
  return map;
}

/** Fetch a user's most recent call logs in a workspace, newest first. */
export async function getRecentCallLogs(
  workspace: Workspace,
  userEmail: string,
  limit = 20
): Promise<CallLog[]> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM call_logs
          WHERE workspace = ? AND user_email = ?
          ORDER BY timestamp DESC
          LIMIT ?`,
    args: [workspace, userEmail, limit],
  });

  const logs: CallLog[] = [];
  for (const row of result.rows) {
    logs.push(rowToCallLog(row as unknown as Record<string, unknown>));
  }
  return logs;
}

// ---------------------------------------------------------------------------
// Test case sets / cases / batch test runs
// ---------------------------------------------------------------------------

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

export interface TestCaseSetSummary {
  id: string;
  name: string;
  case_count: number;
  created_at: number;
  updated_at: number;
}

export async function createTestCaseSet(
  name: string,
  cases: Omit<TestCase, "id">[] = []
): Promise<string> {
  const db = await getDb();
  const id = newId("set");
  const now = Date.now();
  await db.execute({
    sql: `INSERT INTO test_case_sets (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    args: [id, name, now, now],
  });
  if (cases.length > 0) {
    await replaceTestCases(id, cases);
  }
  return id;
}

export async function listTestCaseSets(): Promise<TestCaseSetSummary[]> {
  const db = await getDb();
  const result = await db.execute(
    `SELECT s.id, s.name, s.created_at, s.updated_at, COUNT(c.id) as case_count
     FROM test_case_sets s
     LEFT JOIN test_cases c ON c.set_id = s.id
     GROUP BY s.id
     ORDER BY s.updated_at DESC`
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    name: String(row.name ?? ""),
    case_count: Number(row.case_count ?? 0),
    created_at: Number(row.created_at ?? 0),
    updated_at: Number(row.updated_at ?? 0),
  }));
}

function rowToTestCase(row: Record<string, unknown>): TestCase {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    user_prompt: String(row.user_prompt ?? ""),
    metrics: row.metrics ? JSON.parse(row.metrics as string) : [],
    dynamic_variables: row.dynamic_variables
      ? JSON.parse(row.dynamic_variables as string)
      : {},
    tool_mocks: row.tool_mocks ? JSON.parse(row.tool_mocks as string) : [],
    llm_model: String(row.llm_model ?? ""),
  };
}

export async function getTestCaseSet(
  id: string
): Promise<{ id: string; name: string; cases: TestCase[] } | null> {
  const db = await getDb();
  const setResult = await db.execute({
    sql: `SELECT id, name FROM test_case_sets WHERE id = ?`,
    args: [id],
  });
  if (setResult.rows.length === 0) return null;

  const casesResult = await db.execute({
    sql: `SELECT * FROM test_cases WHERE set_id = ? ORDER BY sort_order ASC`,
    args: [id],
  });

  return {
    id: String(setResult.rows[0].id),
    name: String(setResult.rows[0].name ?? ""),
    cases: casesResult.rows.map((row) =>
      rowToTestCase(row as unknown as Record<string, unknown>)
    ),
  };
}

export async function renameTestCaseSet(id: string, name: string): Promise<void> {
  const db = await getDb();
  await db.execute({
    sql: `UPDATE test_case_sets SET name = ?, updated_at = ? WHERE id = ?`,
    args: [name, Date.now(), id],
  });
}

/** Replace all cases in a set with a new list (delete-then-insert). */
export async function replaceTestCases(
  setId: string,
  cases: Omit<TestCase, "id">[]
): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.execute({
    sql: `DELETE FROM test_cases WHERE set_id = ?`,
    args: [setId],
  });
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    await db.execute({
      sql: `INSERT INTO test_cases
              (id, set_id, sort_order, name, user_prompt, metrics, dynamic_variables, tool_mocks, llm_model, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        newId("case"),
        setId,
        i,
        c.name,
        c.user_prompt,
        JSON.stringify(c.metrics ?? []),
        JSON.stringify(c.dynamic_variables ?? {}),
        JSON.stringify(c.tool_mocks ?? []),
        c.llm_model,
        now,
      ],
    });
  }
  await db.execute({
    sql: `UPDATE test_case_sets SET updated_at = ? WHERE id = ?`,
    args: [now, setId],
  });
}

export async function deleteTestCaseSet(id: string): Promise<void> {
  const db = await getDb();
  await db.execute({ sql: `DELETE FROM test_cases WHERE set_id = ?`, args: [id] });
  await db.execute({ sql: `DELETE FROM test_case_sets WHERE id = ?`, args: [id] });
}

export interface BatchTestRun {
  id: string;
  set_id: string | null;
  set_name: string | null;
  agent_id: string | null;
  agent_name: string | null;
  version: number | null;
  response_engine: Record<string, unknown> | null;
  status: string | null;
  pass_count: number | null;
  fail_count: number | null;
  error_count: number | null;
  total_count: number | null;
  user_email: string | null;
  created_at: number | null;
  updated_at: number | null;
}

export interface InsertBatchTestRunInput {
  id: string;
  setId: string;
  setName: string;
  agentId: string;
  agentName: string;
  version?: number;
  responseEngine: object;
  userEmail?: string;
}

export async function insertBatchTestRun(input: InsertBatchTestRunInput): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.execute({
    sql: `INSERT INTO batch_test_runs
            (id, set_id, set_name, agent_id, agent_name, version, response_engine,
             status, pass_count, fail_count, error_count, total_count, user_email,
             created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      input.id,
      input.setId,
      input.setName,
      input.agentId,
      input.agentName,
      input.version ?? null,
      JSON.stringify(input.responseEngine),
      "pending",
      0,
      0,
      0,
      0,
      input.userEmail ?? null,
      now,
      now,
    ],
  });
}

export async function updateBatchTestRunCounts(
  id: string,
  counts: {
    status?: string;
    pass_count?: number;
    fail_count?: number;
    error_count?: number;
    total_count?: number;
  }
): Promise<void> {
  const db = await getDb();
  await db.execute({
    sql: `UPDATE batch_test_runs SET
            status = COALESCE(?, status),
            pass_count = COALESCE(?, pass_count),
            fail_count = COALESCE(?, fail_count),
            error_count = COALESCE(?, error_count),
            total_count = COALESCE(?, total_count),
            updated_at = ?
          WHERE id = ?`,
    args: [
      counts.status ?? null,
      counts.pass_count ?? null,
      counts.fail_count ?? null,
      counts.error_count ?? null,
      counts.total_count ?? null,
      Date.now(),
      id,
    ],
  });
}

function rowToBatchTestRun(row: Record<string, unknown>): BatchTestRun {
  return {
    id: String(row.id),
    set_id: (row.set_id as string) ?? null,
    set_name: (row.set_name as string) ?? null,
    agent_id: (row.agent_id as string) ?? null,
    agent_name: (row.agent_name as string) ?? null,
    version: row.version == null ? null : Number(row.version),
    response_engine: row.response_engine
      ? JSON.parse(row.response_engine as string)
      : null,
    status: (row.status as string) ?? null,
    pass_count: row.pass_count == null ? null : Number(row.pass_count),
    fail_count: row.fail_count == null ? null : Number(row.fail_count),
    error_count: row.error_count == null ? null : Number(row.error_count),
    total_count: row.total_count == null ? null : Number(row.total_count),
    user_email: (row.user_email as string) ?? null,
    created_at: row.created_at == null ? null : Number(row.created_at),
    updated_at: row.updated_at == null ? null : Number(row.updated_at),
  };
}

export async function listBatchTestRuns(): Promise<BatchTestRun[]> {
  const db = await getDb();
  const result = await db.execute(
    `SELECT * FROM batch_test_runs ORDER BY created_at DESC`
  );
  return result.rows.map((row) =>
    rowToBatchTestRun(row as unknown as Record<string, unknown>)
  );
}

export async function getBatchTestRun(id: string): Promise<BatchTestRun | null> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM batch_test_runs WHERE id = ?`,
    args: [id],
  });
  if (result.rows.length === 0) return null;
  return rowToBatchTestRun(result.rows[0] as unknown as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// AI grades (conversational-quality grading, run by the Retell grader agent)
// ---------------------------------------------------------------------------

export type AiGradeSubjectType = "call" | "test_run";

export interface AiGrade {
  subject_type: AiGradeSubjectType;
  subject_id: string;
  score: number;
  note: string;
  chat_id: string | null;
  created_at: number;
}

export async function insertAiGrade(input: {
  subjectType: AiGradeSubjectType;
  subjectId: string;
  score: number;
  note: string;
  chatId?: string;
}): Promise<void> {
  const db = await getDb();
  await db.execute({
    sql: `INSERT INTO ai_grades (id, subject_type, subject_id, score, note, chat_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(subject_type, subject_id) DO UPDATE SET
            score = excluded.score,
            note = excluded.note,
            chat_id = excluded.chat_id,
            created_at = excluded.created_at`,
    args: [
      newId("grade"),
      input.subjectType,
      input.subjectId,
      input.score,
      input.note,
      input.chatId ?? null,
      Date.now(),
    ],
  });
}

function rowToAiGrade(row: Record<string, unknown>): AiGrade {
  return {
    subject_type: row.subject_type as AiGradeSubjectType,
    subject_id: String(row.subject_id),
    score: Number(row.score),
    note: String(row.note ?? ""),
    chat_id: (row.chat_id as string) ?? null,
    created_at: Number(row.created_at ?? 0),
  };
}

export async function getAiGrade(
  subjectType: AiGradeSubjectType,
  subjectId: string
): Promise<AiGrade | null> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM ai_grades WHERE subject_type = ? AND subject_id = ?`,
    args: [subjectType, subjectId],
  });
  if (result.rows.length === 0) return null;
  return rowToAiGrade(result.rows[0] as unknown as Record<string, unknown>);
}

/** Bulk-fetch cached grades for a set of subject ids, keyed by subject_id. */
export async function getAiGradesForSubjects(
  subjectType: AiGradeSubjectType,
  subjectIds: string[]
): Promise<Map<string, AiGrade>> {
  const map = new Map<string, AiGrade>();
  if (subjectIds.length === 0) return map;

  const db = await getDb();
  const placeholders = subjectIds.map(() => "?").join(", ");
  const result = await db.execute({
    sql: `SELECT * FROM ai_grades WHERE subject_type = ? AND subject_id IN (${placeholders})`,
    args: [subjectType, ...subjectIds],
  });

  for (const row of result.rows) {
    const grade = rowToAiGrade(row as unknown as Record<string, unknown>);
    map.set(grade.subject_id, grade);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Agent settings (enable/disable + tag agents from the admin panel)
// ---------------------------------------------------------------------------

export interface AgentSetting {
  agent_id: string;
  enabled: boolean;
  tag: string;
}

function rowToAgentSetting(
  agentId: string,
  row: { enabled: unknown; tag: unknown }
): AgentSetting {
  return {
    agent_id: agentId,
    enabled: Number(row.enabled) !== 0,
    tag: String(row.tag ?? ALL_AGENTS_TAG),
  };
}

/** Local overrides for agents in a workspace, keyed by agent_id. Agents with no row are enabled with tag "all". */
export async function getAgentSettingsMap(workspace: Workspace): Promise<Map<string, AgentSetting>> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT agent_id, enabled, tag FROM agent_settings WHERE workspace = ?`,
    args: [workspace],
  });
  const map = new Map<string, AgentSetting>();
  for (const row of result.rows) {
    const agentId = String(row.agent_id);
    map.set(agentId, rowToAgentSetting(agentId, row as unknown as { enabled: unknown; tag: unknown }));
  }
  return map;
}

/** A single agent's local settings in a workspace, defaulting to enabled + untagged. */
export async function getAgentSetting(workspace: Workspace, agentId: string): Promise<AgentSetting> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT agent_id, enabled, tag FROM agent_settings WHERE workspace = ? AND agent_id = ?`,
    args: [workspace, agentId],
  });
  if (result.rows.length === 0) {
    return { agent_id: agentId, enabled: true, tag: ALL_AGENTS_TAG };
  }
  return rowToAgentSetting(
    agentId,
    result.rows[0] as unknown as { enabled: unknown; tag: unknown }
  );
}

/** Enable/disable a batch of agents in one round trip, within a workspace. */
export async function setAgentsEnabled(workspace: Workspace, agentIds: string[], enabled: boolean): Promise<void> {
  if (agentIds.length === 0) return;
  const db = await getDb();
  const now = Date.now();
  await db.batch(
    agentIds.map((agentId) => ({
      sql: `INSERT INTO agent_settings (agent_id, workspace, enabled, tag, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(agent_id) DO UPDATE SET
              workspace = excluded.workspace,
              enabled = excluded.enabled,
              updated_at = excluded.updated_at`,
      args: [agentId, workspace, enabled ? 1 : 0, ALL_AGENTS_TAG, now],
    }))
  );
}

/** Tag a batch of agents in one round trip, within a workspace. */
export async function setAgentsTag(workspace: Workspace, agentIds: string[], tag: string): Promise<void> {
  if (agentIds.length === 0) return;
  const db = await getDb();
  const now = Date.now();
  await db.batch(
    agentIds.map((agentId) => ({
      sql: `INSERT INTO agent_settings (agent_id, workspace, enabled, tag, updated_at)
            VALUES (?, ?, 1, ?, ?)
            ON CONFLICT(agent_id) DO UPDATE SET
              workspace = excluded.workspace,
              tag = excluded.tag,
              updated_at = excluded.updated_at`,
      args: [agentId, workspace, tag, now],
    }))
  );
}

// ---------------------------------------------------------------------------
// Call grader — calls + call_grades (workspace-scoped)
// ---------------------------------------------------------------------------

/** Parse a TEXT-stored JSON column, returning `fallback` on null/invalid input. */
function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export interface Call {
  id: string;
  workspace: Workspace;
  retell_call_id: string;
  agent_id: string | null;
  agent_version: string | null;
  timestamp: number | null;
  duration_seconds: number | null;
  phone_number: string | null;
  transcript: unknown;
  dynamic_variables: Record<string, unknown> | null;
  recording_url: string | null;
  latency: unknown;
  voice_id: string | null;
  voice_name: string | null;
  raw_payload: unknown;
  created_at: number | null;
}

export interface UpsertCallInput {
  workspace: Workspace;
  retellCallId: string;
  agentId?: string | null;
  agentVersion?: string | null;
  timestamp?: number | null;
  durationSeconds?: number | null;
  phoneNumber?: string | null;
  transcript?: unknown;
  dynamicVariables?: Record<string, unknown> | null;
  recordingUrl?: string | null;
  latency?: unknown;
  voiceId?: string | null;
  voiceName?: string | null;
  rawPayload?: unknown;
}

function rowToCall(row: Record<string, unknown>): Call {
  return {
    id: String(row.id),
    workspace: row.workspace as Workspace,
    retell_call_id: String(row.retell_call_id),
    agent_id: (row.agent_id as string) ?? null,
    agent_version: (row.agent_version as string) ?? null,
    timestamp: row.timestamp == null ? null : Number(row.timestamp),
    duration_seconds:
      row.duration_seconds == null ? null : Number(row.duration_seconds),
    phone_number: (row.phone_number as string) ?? null,
    transcript: parseJson<unknown>(row.transcript, null),
    dynamic_variables: parseJson<Record<string, unknown> | null>(
      row.dynamic_variables,
      null
    ),
    recording_url: (row.recording_url as string) ?? null,
    latency: parseJson<unknown>(row.latency, null),
    voice_id: (row.voice_id as string) ?? null,
    voice_name: (row.voice_name as string) ?? null,
    raw_payload: parseJson<unknown>(row.raw_payload, null),
    created_at: row.created_at == null ? null : Number(row.created_at),
  };
}

/**
 * Upsert a call keyed by (workspace, retell_call_id). Returns the row id (a
 * stable app-generated `call_…` id, reused on conflict).
 */
export async function upsertCall(input: UpsertCallInput): Promise<string> {
  const db = await getDb();
  const now = Date.now();
  const existing = await db.execute({
    sql: `SELECT id FROM calls WHERE workspace = ? AND retell_call_id = ?`,
    args: [input.workspace, input.retellCallId],
  });
  const id =
    existing.rows.length > 0 ? String(existing.rows[0].id) : newId("call");
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
      id,
      input.workspace,
      input.retellCallId,
      input.agentId ?? null,
      input.agentVersion ?? null,
      input.timestamp ?? now,
      input.durationSeconds ?? null,
      input.phoneNumber ?? null,
      input.transcript === undefined ? null : JSON.stringify(input.transcript ?? null),
      input.dynamicVariables === undefined ? null : JSON.stringify(input.dynamicVariables ?? null),
      input.recordingUrl ?? null,
      input.latency === undefined ? null : JSON.stringify(input.latency ?? null),
      input.voiceId ?? null,
      input.voiceName ?? null,
      input.rawPayload === undefined ? null : JSON.stringify(input.rawPayload ?? null),
      now,
    ],
  });
  return id;
}

export async function getCall(
  workspace: Workspace,
  id: string
): Promise<Call | null> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM calls WHERE workspace = ? AND id = ?`,
    args: [workspace, id],
  });
  if (result.rows.length === 0) return null;
  return rowToCall(result.rows[0] as unknown as Record<string, unknown>);
}

export interface ListCallsFilters {
  agentId?: string;
  agentVersion?: string;
  voiceName?: string;
  limit?: number;
}

/** List calls in a workspace, newest first, with optional equality filters. */
export async function listCalls(
  workspace: Workspace,
  filters: ListCallsFilters = {}
): Promise<Call[]> {
  const db = await getDb();
  const clauses = ["workspace = ?"];
  const args: (string | number)[] = [workspace];
  if (filters.agentId) {
    clauses.push("agent_id = ?");
    args.push(filters.agentId);
  }
  if (filters.agentVersion) {
    clauses.push("agent_version = ?");
    args.push(filters.agentVersion);
  }
  if (filters.voiceName) {
    clauses.push("voice_name = ?");
    args.push(filters.voiceName);
  }
  let sql = `SELECT * FROM calls WHERE ${clauses.join(" AND ")} ORDER BY timestamp DESC`;
  if (filters.limit != null) {
    sql += ` LIMIT ?`;
    args.push(filters.limit);
  }
  const result = await db.execute({ sql, args });
  return result.rows.map((row) =>
    rowToCall(row as unknown as Record<string, unknown>)
  );
}

export interface CallGrade {
  call_id: string;
  workspace: Workspace;
  grade: number | null;
  applicable_count: number;
  passed_count: number;
  results: Record<string, unknown>;
  ai_callout: boolean;
  ai_callout_quote: string | null;
  rep_score: number | null;
  rep_scorecard: Record<string, unknown>;
  model: string | null;
  error: string | null;
  graded_at: number | null;
}

export interface UpsertCallGradeInput {
  callId: string;
  workspace: Workspace;
  grade?: number | null;
  applicableCount?: number;
  passedCount?: number;
  results?: Record<string, unknown>;
  aiCallout?: boolean;
  aiCalloutQuote?: string | null;
  repScore?: number | null;
  repScorecard?: Record<string, unknown>;
  model?: string | null;
  error?: string | null;
}

function rowToCallGrade(row: Record<string, unknown>): CallGrade {
  return {
    call_id: String(row.call_id),
    workspace: row.workspace as Workspace,
    grade: row.grade == null ? null : Number(row.grade),
    applicable_count: Number(row.applicable_count ?? 0),
    passed_count: Number(row.passed_count ?? 0),
    results: parseJson<Record<string, unknown>>(row.results, {}),
    ai_callout: Number(row.ai_callout) !== 0,
    ai_callout_quote: (row.ai_callout_quote as string) ?? null,
    rep_score: row.rep_score == null ? null : Number(row.rep_score),
    rep_scorecard: parseJson<Record<string, unknown>>(row.rep_scorecard, {}),
    model: (row.model as string) ?? null,
    error: (row.error as string) ?? null,
    graded_at: row.graded_at == null ? null : Number(row.graded_at),
  };
}

export async function upsertCallGrade(input: UpsertCallGradeInput): Promise<void> {
  const db = await getDb();
  await db.execute({
    sql: `INSERT INTO call_grades
            (call_id, workspace, grade, applicable_count, passed_count, results,
             ai_callout, ai_callout_quote, rep_score, rep_scorecard, model, error, graded_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(call_id) DO UPDATE SET
            grade            = excluded.grade,
            applicable_count = excluded.applicable_count,
            passed_count     = excluded.passed_count,
            results          = excluded.results,
            ai_callout       = excluded.ai_callout,
            ai_callout_quote = excluded.ai_callout_quote,
            rep_score        = excluded.rep_score,
            rep_scorecard    = excluded.rep_scorecard,
            model            = excluded.model,
            error            = excluded.error,
            graded_at        = excluded.graded_at`,
    args: [
      input.callId,
      input.workspace,
      input.grade ?? null,
      input.applicableCount ?? 0,
      input.passedCount ?? 0,
      JSON.stringify(input.results ?? {}),
      input.aiCallout ? 1 : 0,
      input.aiCalloutQuote ?? null,
      input.repScore ?? null,
      JSON.stringify(input.repScorecard ?? {}),
      input.model ?? null,
      input.error ?? null,
      Date.now(),
    ],
  });
}

export async function getCallGrade(
  workspace: Workspace,
  callId: string
): Promise<CallGrade | null> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM call_grades WHERE workspace = ? AND call_id = ?`,
    args: [workspace, callId],
  });
  if (result.rows.length === 0) return null;
  return rowToCallGrade(result.rows[0] as unknown as Record<string, unknown>);
}

/**
 * Bulk-fetch workspace-scoped `call_grades` for a set of Retell call ids,
 * keyed by `retell_call_id` (the id the /calls list works in). Joins through
 * `calls` because call_grades is keyed by the app `calls.id`, not the Retell
 * id. Mirrors getCallLogsByIds' chunked IN(...) pattern; reuses rowToCallGrade.
 */
export async function getCallGradesByIds(
  workspace: Workspace,
  retellCallIds: string[]
): Promise<Map<string, CallGrade>> {
  const map = new Map<string, CallGrade>();
  if (retellCallIds.length === 0) return map;

  const db = await getDb();
  // Chunk the IN (...) so a large window stays well under SQLite's bind-var cap.
  const CHUNK = 200;
  for (let i = 0; i < retellCallIds.length; i += CHUNK) {
    const batch = retellCallIds.slice(i, i + CHUNK);
    const placeholders = batch.map(() => "?").join(", ");
    const result = await db.execute({
      sql: `SELECT g.*, c.retell_call_id AS retell_call_id
              FROM call_grades g
              JOIN calls c ON c.id = g.call_id AND c.workspace = g.workspace
             WHERE g.workspace = ? AND c.retell_call_id IN (${placeholders})`,
      args: [workspace, ...batch],
    });
    for (const r of result.rows) {
      const row = r as unknown as Record<string, unknown>;
      map.set(String(row.retell_call_id), rowToCallGrade(row));
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Dashboard analytics — workspace-scoped read/aggregation helpers (Build 5).
// All left-join calls↔call_grades so ungraded calls still surface. Callers get
// the denormalized `call_grades` object (null when ungraded), matching the
// Lovable dashboard's row shape.
// ---------------------------------------------------------------------------

/** A call joined with its grade, in the shape the dashboard client expects. */
export interface DashboardCall {
  id: string;
  retell_call_id: string;
  timestamp: number | null;
  duration_seconds: number | null;
  phone_number: string | null;
  agent_name: string | null;
  agent_version: string | null;
  voice_id: string | null;
  voice_name: string | null;
  recording_url: string | null;
  call_grades: {
    grade: number | null;
    applicable_count: number;
    passed_count: number;
    results: Record<string, unknown>;
    ai_callout: boolean;
    rep_score: number | null;
    rep_scorecard: Record<string, unknown>;
  } | null;
}

/** Full call + grade for the detail view (includes transcript, variables, quote). */
export interface DashboardCallDetail extends DashboardCall {
  agent_id: string | null;
  transcript: unknown;
  dynamic_variables: Record<string, unknown> | null;
  call_grades:
    | (NonNullable<DashboardCall["call_grades"]> & {
        ai_callout_quote: string | null;
        model: string | null;
        error: string | null;
        graded_at: number | null;
      })
    | null;
}

function rowToDashboardGrade(
  row: Record<string, unknown>
): NonNullable<DashboardCall["call_grades"]> | null {
  // Left join → grade columns are NULL when there is no call_grades row.
  if (row.g_call_id == null) return null;
  return {
    grade: row.g_grade == null ? null : Number(row.g_grade),
    applicable_count: Number(row.g_applicable_count ?? 0),
    passed_count: Number(row.g_passed_count ?? 0),
    results: parseJson<Record<string, unknown>>(row.g_results, {}),
    ai_callout: Number(row.g_ai_callout) !== 0,
    rep_score: row.g_rep_score == null ? null : Number(row.g_rep_score),
    rep_scorecard: parseJson<Record<string, unknown>>(row.g_rep_scorecard, {}),
  };
}

/**
 * Calls (with grades) whose timestamp falls in [fromMs, toMs), newest first.
 * Powers the KPI cards, leaderboard, voice breakdown and calls table for a
 * window. Workspace-scoped on both tables via the join key.
 */
export async function listDashboardCallsInRange(
  workspace: Workspace,
  fromMs: number,
  toMs: number,
  limit: number
): Promise<DashboardCall[]> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT c.id, c.retell_call_id, c.timestamp, c.duration_seconds,
                 c.phone_number, c.agent_version, c.voice_id, c.voice_name,
                 c.recording_url, av.agent_name AS agent_name,
                 g.call_id AS g_call_id, g.grade AS g_grade,
                 g.applicable_count AS g_applicable_count,
                 g.passed_count AS g_passed_count, g.results AS g_results,
                 g.ai_callout AS g_ai_callout, g.rep_score AS g_rep_score,
                 g.rep_scorecard AS g_rep_scorecard
            FROM calls c
            LEFT JOIN call_grades g
              ON g.call_id = c.id AND g.workspace = c.workspace
            LEFT JOIN agent_voices av
              ON av.agent_id = c.agent_id AND av.workspace = c.workspace
           WHERE c.workspace = ? AND c.timestamp >= ? AND c.timestamp < ?
           ORDER BY c.timestamp DESC
           LIMIT ?`,
    args: [workspace, fromMs, toMs, limit],
  });
  return result.rows.map((r) => {
    const row = r as unknown as Record<string, unknown>;
    return {
      id: String(row.id),
      retell_call_id: String(row.retell_call_id),
      timestamp: row.timestamp == null ? null : Number(row.timestamp),
      duration_seconds:
        row.duration_seconds == null ? null : Number(row.duration_seconds),
      phone_number: (row.phone_number as string) ?? null,
      agent_name: (row.agent_name as string) ?? null,
      agent_version: (row.agent_version as string) ?? null,
      voice_id: (row.voice_id as string) ?? null,
      voice_name: (row.voice_name as string) ?? null,
      recording_url: (row.recording_url as string) ?? null,
      call_grades: rowToDashboardGrade(row),
    };
  });
}

/** Grade rows joined with their call's timestamp, since `sinceMs`. For trends. */
export async function listGradeTrendRows(
  workspace: Workspace,
  sinceMs: number,
  limit: number
): Promise<Array<{ grade: number | null; rep_score: number | null; ai_callout: boolean; timestamp: number }>> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT g.grade AS grade, g.rep_score AS rep_score,
                 g.ai_callout AS ai_callout, c.timestamp AS timestamp
            FROM call_grades g
            JOIN calls c ON c.id = g.call_id AND c.workspace = g.workspace
           WHERE g.workspace = ? AND c.timestamp >= ?
           LIMIT ?`,
    args: [workspace, sinceMs, limit],
  });
  return result.rows
    .map((r) => {
      const row = r as unknown as Record<string, unknown>;
      return {
        grade: row.grade == null ? null : Number(row.grade),
        rep_score: row.rep_score == null ? null : Number(row.rep_score),
        ai_callout: Number(row.ai_callout) !== 0,
        timestamp: row.timestamp == null ? null : Number(row.timestamp),
      };
    })
    .filter((r): r is { grade: number | null; rep_score: number | null; ai_callout: boolean; timestamp: number } =>
      r.timestamp != null
    );
}

/**
 * Calls eligible for the duration trend: duration ≥ MIN and a non-null
 * transcript, since `sinceMs`. Mirrors Lovable's fetchTrendCalls eligibility.
 */
export async function listDurationTrendRows(
  workspace: Workspace,
  sinceMs: number,
  minDuration: number,
  limit: number
): Promise<Array<{ timestamp: number; duration_seconds: number }>> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT timestamp, duration_seconds
            FROM calls
           WHERE workspace = ? AND timestamp >= ?
             AND duration_seconds >= ? AND transcript IS NOT NULL
           LIMIT ?`,
    args: [workspace, sinceMs, minDuration, limit],
  });
  return result.rows
    .map((r) => {
      const row = r as unknown as Record<string, unknown>;
      return {
        timestamp: row.timestamp == null ? null : Number(row.timestamp),
        duration_seconds:
          row.duration_seconds == null ? null : Number(row.duration_seconds),
      };
    })
    .filter((r): r is { timestamp: number; duration_seconds: number } =>
      r.timestamp != null && r.duration_seconds != null
    );
}

/** Full call + grade for the detail view (workspace-scoped). */
export async function getDashboardCallDetail(
  workspace: Workspace,
  id: string
): Promise<DashboardCallDetail | null> {
  const [call, grade] = await Promise.all([
    getCall(workspace, id),
    getCallGrade(workspace, id),
  ]);
  if (!call) return null;
  const voice = call.agent_id ? await getAgentVoice(workspace, call.agent_id) : null;
  return {
    id: call.id,
    retell_call_id: call.retell_call_id,
    timestamp: call.timestamp,
    duration_seconds: call.duration_seconds,
    phone_number: call.phone_number,
    agent_name: voice?.agent_name ?? null,
    agent_id: call.agent_id,
    agent_version: call.agent_version,
    voice_id: call.voice_id,
    voice_name: call.voice_name,
    recording_url: call.recording_url,
    transcript: call.transcript,
    dynamic_variables: call.dynamic_variables,
    call_grades: grade
      ? {
          grade: grade.grade,
          applicable_count: grade.applicable_count,
          passed_count: grade.passed_count,
          results: grade.results,
          ai_callout: grade.ai_callout,
          ai_callout_quote: grade.ai_callout_quote,
          rep_score: grade.rep_score,
          rep_scorecard: grade.rep_scorecard,
          model: grade.model,
          error: grade.error,
          graded_at: grade.graded_at,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Call grader — rubric (failure_classes + rep_dimensions), workspace-scoped
// ---------------------------------------------------------------------------

export interface RubricRow {
  key: string;
  name: string;
  definition: string;
  sort_order: number;
  active: boolean;
}

function rowToRubricRow(row: Record<string, unknown>): RubricRow {
  return {
    key: String(row.key),
    name: String(row.name ?? ""),
    definition: String(row.definition ?? ""),
    sort_order: Number(row.sort_order ?? 0),
    active: Number(row.active) !== 0,
  };
}

async function listRubric(
  workspace: Workspace,
  table: "failure_classes" | "rep_dimensions"
): Promise<RubricRow[]> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM ${table} WHERE workspace = ? ORDER BY sort_order ASC`,
    args: [workspace],
  });
  return result.rows.map((row) =>
    rowToRubricRow(row as unknown as Record<string, unknown>)
  );
}

export function listFailureClasses(workspace: Workspace): Promise<RubricRow[]> {
  return listRubric(workspace, "failure_classes");
}

export function listRepDimensions(workspace: Workspace): Promise<RubricRow[]> {
  return listRubric(workspace, "rep_dimensions");
}

export interface RubricUpsert {
  key: string;
  name: string;
  definition: string;
  sort_order: number;
  active: boolean;
}

/**
 * Upsert a rubric row (workspace-scoped). `key` is the immutable grader
 * contract and the conflict target — creation sets it, updates never change it
 * (only name/definition/sort_order/active). Mirrors setAppConfig's upsert style.
 */
async function upsertRubric(
  workspace: Workspace,
  table: "failure_classes" | "rep_dimensions",
  row: RubricUpsert
): Promise<void> {
  const db = await getDb();
  await db.execute({
    sql: `INSERT INTO ${table}
            (workspace, key, name, definition, sort_order, active, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(workspace, key) DO UPDATE SET
            name = excluded.name,
            definition = excluded.definition,
            sort_order = excluded.sort_order,
            active = excluded.active,
            updated_at = excluded.updated_at`,
    args: [
      workspace,
      row.key,
      row.name,
      row.definition,
      row.sort_order,
      row.active ? 1 : 0,
      Date.now(),
    ],
  });
}

export function upsertFailureClass(workspace: Workspace, row: RubricUpsert): Promise<void> {
  return upsertRubric(workspace, "failure_classes", row);
}

export function upsertRepDimension(workspace: Workspace, row: RubricUpsert): Promise<void> {
  return upsertRubric(workspace, "rep_dimensions", row);
}

/** True when a rubric key already exists for the workspace (uniqueness check on create). */
async function rubricKeyExists(
  workspace: Workspace,
  table: "failure_classes" | "rep_dimensions",
  key: string
): Promise<boolean> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT 1 FROM ${table} WHERE workspace = ? AND key = ? LIMIT 1`,
    args: [workspace, key],
  });
  return result.rows.length > 0;
}

export function failureClassKeyExists(workspace: Workspace, key: string): Promise<boolean> {
  return rubricKeyExists(workspace, "failure_classes", key);
}

export function repDimensionKeyExists(workspace: Workspace, key: string): Promise<boolean> {
  return rubricKeyExists(workspace, "rep_dimensions", key);
}

// ---------------------------------------------------------------------------
// Call grader — app_config (workspace-scoped key/value JSON store)
// ---------------------------------------------------------------------------

/** Read a config value, JSON-parsed. Returns null when the key is unset. */
export async function getAppConfig<T = unknown>(
  workspace: Workspace,
  key: string
): Promise<T | null> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT value FROM app_config WHERE workspace = ? AND key = ?`,
    args: [workspace, key],
  });
  if (result.rows.length === 0) return null;
  return parseJson<T | null>(result.rows[0].value, null);
}

/**
 * Read every config key for a workspace as a JSON-parsed key→value map. Used by
 * the admin config route to hydrate the editor in one round-trip.
 */
export async function getAppConfigMap(
  workspace: Workspace
): Promise<Record<string, unknown>> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT key, value FROM app_config WHERE workspace = ?`,
    args: [workspace],
  });
  const map: Record<string, unknown> = {};
  for (const row of result.rows) {
    map[String(row.key)] = parseJson<unknown>(row.value, null);
  }
  return map;
}

/** Write a config value (JSON-stringified). Upserts on (workspace, key). */
export async function setAppConfig(
  workspace: Workspace,
  key: string,
  value: unknown
): Promise<void> {
  const db = await getDb();
  await db.execute({
    sql: `INSERT INTO app_config (workspace, key, value, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(workspace, key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at`,
    args: [workspace, key, JSON.stringify(value), Date.now()],
  });
}

// ---------------------------------------------------------------------------
// Call grader — agent_voices (workspace-scoped agent → voice cache)
// ---------------------------------------------------------------------------

export interface AgentVoice {
  agent_id: string;
  voice_id: string | null;
  voice_name: string | null;
  agent_name: string | null;
  last_synced_at: number | null;
}

export interface UpsertAgentVoiceInput {
  workspace: Workspace;
  agentId: string;
  voiceId?: string | null;
  voiceName?: string | null;
  agentName?: string | null;
}

function rowToAgentVoice(row: Record<string, unknown>): AgentVoice {
  return {
    agent_id: String(row.agent_id),
    voice_id: (row.voice_id as string) ?? null,
    voice_name: (row.voice_name as string) ?? null,
    agent_name: (row.agent_name as string) ?? null,
    last_synced_at:
      row.last_synced_at == null ? null : Number(row.last_synced_at),
  };
}

export async function upsertAgentVoice(input: UpsertAgentVoiceInput): Promise<void> {
  const db = await getDb();
  await db.execute({
    sql: `INSERT INTO agent_voices
            (workspace, agent_id, voice_id, voice_name, agent_name, last_synced_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(workspace, agent_id) DO UPDATE SET
            voice_id       = excluded.voice_id,
            voice_name     = excluded.voice_name,
            agent_name     = excluded.agent_name,
            last_synced_at = excluded.last_synced_at`,
    args: [
      input.workspace,
      input.agentId,
      input.voiceId ?? null,
      input.voiceName ?? null,
      input.agentName ?? null,
      Date.now(),
    ],
  });
}

export async function listAgentVoices(
  workspace: Workspace
): Promise<AgentVoice[]> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM agent_voices WHERE workspace = ? ORDER BY agent_name ASC`,
    args: [workspace],
  });
  return result.rows.map((row) =>
    rowToAgentVoice(row as unknown as Record<string, unknown>)
  );
}

/** Single agent's cached voice for a workspace (indexed PK lookup). */
export async function getAgentVoice(
  workspace: Workspace,
  agentId: string
): Promise<AgentVoice | null> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM agent_voices WHERE workspace = ? AND agent_id = ?`,
    args: [workspace, agentId],
  });
  if (result.rows.length === 0) return null;
  return rowToAgentVoice(result.rows[0] as unknown as Record<string, unknown>);
}

/**
 * Propagate agent_voices into calls for rows missing voice info in a workspace.
 * Port of the client's `backfill_call_voices` SQL function. Returns the number
 * of call rows updated.
 */
export async function backfillCallVoices(workspace: Workspace): Promise<number> {
  const db = await getDb();
  const result = await db.execute({
    sql: `UPDATE calls
             SET voice_id = (
                   SELECT av.voice_id FROM agent_voices av
                    WHERE av.workspace = calls.workspace AND av.agent_id = calls.agent_id
                 ),
                 voice_name = (
                   SELECT av.voice_name FROM agent_voices av
                    WHERE av.workspace = calls.workspace AND av.agent_id = calls.agent_id
                 )
           WHERE calls.workspace = ?
             AND (calls.voice_id IS NULL OR calls.voice_name IS NULL)
             AND EXISTS (
                   SELECT 1 FROM agent_voices av
                    WHERE av.workspace = calls.workspace
                      AND av.agent_id = calls.agent_id
                      AND av.voice_id IS NOT NULL
                 )`,
    args: [workspace],
  });
  return Number(result.rowsAffected ?? 0);
}

/**
 * Ungraded calls in a workspace, newest first — a call with no matching
 * call_grades row. Powers grade-pending. Callers apply eligibility guards.
 */
export async function listUngradedCalls(
  workspace: Workspace,
  limit: number
): Promise<Call[]> {
  const db = await getDb();
  // Surface calls with no grade row AND calls whose only grade row is an error
  // (e.g. a transient OpenAI timeout / 429 / 5xx). Re-surfacing errored rows
  // gives the grade-pending runner automatic retry — addressing the Lovable
  // "fire-and-forget grading, no retry" gap (Phase 8) — while a successful grade
  // (error IS NULL, including a legitimate null-grade "no class applied") is
  // treated as done and never re-graded.
  const result = await db.execute({
    sql: `SELECT c.* FROM calls c
            LEFT JOIN call_grades g
              ON g.workspace = c.workspace AND g.call_id = c.id
           WHERE c.workspace = ?
             AND (g.call_id IS NULL OR g.error IS NOT NULL)
           ORDER BY c.timestamp DESC
           LIMIT ?`,
    args: [workspace, limit],
  });
  return result.rows.map((row) =>
    rowToCall(row as unknown as Record<string, unknown>)
  );
}

/**
 * Count of *gradeable* ungraded calls in a workspace, across all time — every
 * call with no successful grade (no grade row, or only an errored one) that
 * still clears the duration floor. Mirrors listUngradedCalls' ungraded
 * predicate but as an aggregate COUNT: no scan cap and no tracking-start
 * window, so it reflects the true all-time backlog rather than a bounded,
 * date-windowed slice. Powers the dashboard "Ungraded calls" stat.
 *
 * We deliberately omit a transcript check: ingestion drops empty-transcript
 * calls as a hard skip (even in manual bypass mode — see ingestion.ts), so no
 * stored call lacks one, and probing the wide `transcript` TEXT per row just to
 * re-confirm that would force overflow-page reads across the whole scan. The
 * duration floor stays — manual bypass-graded rows can be under the minimum.
 */
export async function countGradeableUngraded(
  workspace: Workspace,
  minDurationSeconds: number
): Promise<number> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM calls c
            LEFT JOIN call_grades g
              ON g.workspace = c.workspace AND g.call_id = c.id
           WHERE c.workspace = ?
             AND (g.call_id IS NULL OR g.error IS NOT NULL)
             AND (c.duration_seconds IS NULL OR c.duration_seconds >= ?)`,
    args: [workspace, minDurationSeconds],
  });
  return Number(result.rows[0]?.n ?? 0);
}

