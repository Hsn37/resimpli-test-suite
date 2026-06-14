import "server-only";
import { createClient, type Client } from "@libsql/client";
import { starsToScore } from "./grade";

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
