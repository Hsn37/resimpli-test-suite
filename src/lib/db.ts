import "server-only";
import { createClient, type Client } from "@libsql/client";
import { starsToScore } from "./grade";
import type { TestCase } from "./testCase";

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

// Idempotent schema creation, run at most once per process.
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
    // Backfill columns on databases created before these were added.
    for (const col of ["agent_id TEXT", "duration INTEGER"]) {
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
    ]);
    await db.execute(
      `CREATE UNIQUE INDEX IF NOT EXISTS ai_grades_subject
       ON ai_grades (subject_type, subject_id)`
    );
  })();
  schemaReady = ready;
  return ready;
}

export async function getDb(): Promise<Client> {
  await ensureSchema();
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
            (call_id, agent_id, agent_name, version, direction, variables, user_email, timestamp, duration, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(call_id) DO UPDATE SET
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
  callId: string,
  grade?: number,
  note?: string
): Promise<void> {
  const db = await getDb();
  await db.execute({
    sql: `INSERT INTO call_logs (call_id, grade, note, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(call_id) DO UPDATE SET
            grade = excluded.grade,
            note = excluded.note,
            updated_at = excluded.updated_at`,
    args: [callId, starsToScore(grade), note ?? null, Date.now()],
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

/** Fetch call logs for a set of call ids, keyed by call_id. */
export async function getCallLogsByIds(
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
      sql: `SELECT * FROM call_logs WHERE call_id IN (${placeholders})`,
      args: batch,
    });
    for (const row of result.rows) {
      const log = rowToCallLog(row as unknown as Record<string, unknown>);
      map.set(log.call_id, log);
    }
  }
  return map;
}

/** Fetch a user's most recent call logs, newest first. */
export async function getRecentCallLogs(
  userEmail: string,
  limit = 20
): Promise<CallLog[]> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM call_logs
          WHERE user_email = ?
          ORDER BY timestamp DESC
          LIMIT ?`,
    args: [userEmail, limit],
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
