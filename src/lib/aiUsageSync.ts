import "server-only";
import { promises as dnsPromises } from "node:dns";
import { MongoClient, ObjectId } from "mongodb";
import { getDb } from "./db";
import { COST_HISTORY_START, COST_TIMEZONE, addDays, costDayStartMs, costToday } from "./costs";

// Backend AI usage → ai_usage_daily, for the Costs Dashboard's OpenAI tab when
// no OpenAI Admin key is available. The ReSimpli backend writes one
// AiAgentAudit document per OpenAI call (gptModel / smsGptModel helpers and a
// few direct calls) with the model, input/output token counts and the feature
// (`agentType`). We aggregate it per US Central day × feature × model; dollars
// are applied at read time from AI_MODEL_RATES.
//
// Read-only: one aggregate per window, nothing else. Configure with
// AI_AUDIT_MONGO_URL — ideally a read-only user limited to `aiagentaudits`.
//
// Two quirks of the source collection:
//   - Its createdAt default is `Date.now()` evaluated once at server start, so
//     every doc from one process shares a timestamp. We date by the ObjectId
//     (`_id`), which records the real insert time — and is the only index.
//   - Cached-input tokens aren't recorded, so estimates can't apply the cache
//     discount and lean slightly high.

export const AI_AUDIT_URL_ENV = "AI_AUDIT_MONGO_URL";
const COLLECTION = "aiagentaudits";
const SYNC_INTERVAL_MS = 30 * 60 * 1000;
const RECHECK_DAYS = 2; // late inserts / timezone edges
const WINDOW_DAYS = 31; // one aggregate per window, so a big backfill spreads over runs
const MIN_WINDOW_MS = 8_000;

export function aiAuditUrl(): string | null {
  return process.env[AI_AUDIT_URL_ENV] || null;
}

/** Database name from the connection string, for the "which data is this" label. */
export function aiAuditDatabase(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\//, "") || "default";
  } catch {
    return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Connection (one client per server process)
// ---------------------------------------------------------------------------

let clientPromise: Promise<MongoClient> | null = null;

const CLIENT_OPTIONS = {
  readPreference: "secondaryPreferred" as const,
  maxPoolSize: 2,
  serverSelectionTimeoutMS: 15_000,
  appName: "resimpli-test-suite-costs",
};

/**
 * mongodb+srv:// needs a DNS TXT lookup, which some networks block. If that's
 * what failed, expand the SRV record into a plain seed list (Atlas requires
 * TLS and authSource=admin, which the TXT record would otherwise supply).
 */
async function seedListUrl(srvUrl: string): Promise<string> {
  const u = new URL(srvUrl);
  const resolver = new dnsPromises.Resolver();
  resolver.setServers(["8.8.8.8", "1.1.1.1"]);
  const hosts = (await resolver.resolveSrv(`_mongodb._tcp.${u.hostname}`)).map((r) => `${r.name}:${r.port}`);
  const params = new URLSearchParams(u.search);
  if (!params.has("tls") && !params.has("ssl")) params.set("tls", "true");
  if (!params.has("authSource")) params.set("authSource", "admin");
  return `mongodb://${u.username}:${u.password}@${hosts.join(",")}${u.pathname}?${params}`;
}

function isTxtLookupFailure(err: unknown): boolean {
  const e = err as { syscall?: string; message?: string } | null;
  return e?.syscall === "queryTxt" || /queryTxt/.test(e?.message ?? "");
}

async function connect(url: string): Promise<MongoClient> {
  try {
    return await new MongoClient(url, CLIENT_OPTIONS).connect();
  } catch (err) {
    if (!url.startsWith("mongodb+srv://") || !isTxtLookupFailure(err)) throw err;
    return await new MongoClient(await seedListUrl(url), CLIENT_OPTIONS).connect();
  }
}

function client(url: string): Promise<MongoClient> {
  clientPromise ??= connect(url).catch((err) => {
    clientPromise = null; // let the next run retry from scratch
    throw err;
  });
  return clientPromise;
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export interface AiUsageSyncResult {
  skipped?: "no_url" | "throttled";
  days: number;
  rows: number;
  error?: string;
}

/** Claim this run: stamps last_run_at only if the last run is older than SYNC_INTERVAL_MS (or `force`). */
async function claimRun(force: boolean, database: string): Promise<boolean> {
  const db = await getDb();
  const now = Date.now();
  await db.execute(`INSERT OR IGNORE INTO ai_usage_sync (id) VALUES (1)`);
  const res = await db.execute({
    sql: `UPDATE ai_usage_sync SET last_run_at = ?, database = ?
          WHERE id = 1 AND (? OR last_run_at IS NULL OR last_run_at < ?)`,
    args: [now, database, force ? 1 : 0, now - SYNC_INTERVAL_MS],
  });
  return res.rowsAffected > 0;
}

type Group = { _id: { day: string; feature: string; model: string }; calls: number; input: number; output: number };

/** Aggregate one [fromDay, toDay) window and replace those days in Turso. */
async function syncWindow(url: string, fromDay: string, toDay: string, maxTimeMS: number): Promise<{ days: number; rows: number }> {
  const mongo = await client(url);
  const groups = await mongo
    .db()
    .collection(COLLECTION)
    .aggregate<Group>(
      [
        {
          $match: {
            _id: {
              $gte: ObjectId.createFromTime(Math.floor(costDayStartMs(fromDay) / 1000)),
              $lt: ObjectId.createFromTime(Math.floor(costDayStartMs(toDay) / 1000)),
            },
          },
        },
        {
          $group: {
            _id: {
              day: { $dateToString: { format: "%Y-%m-%d", date: { $toDate: "$_id" }, timezone: COST_TIMEZONE } },
              feature: { $ifNull: ["$agentType", ""] },
              model: { $ifNull: ["$model", ""] },
            },
            calls: { $sum: 1 },
            input: { $sum: { $ifNull: ["$inputTokens", 0] } },
            output: { $sum: { $ifNull: ["$outputTokens", 0] } },
          },
        },
      ],
      { maxTimeMS, allowDiskUse: true }
    )
    .toArray();

  const db = await getDb();
  const now = Date.now();
  await db.batch(
    [
      { sql: `DELETE FROM ai_usage_daily WHERE day >= ? AND day < ?`, args: [fromDay, toDay] },
      ...groups.map((g) => ({
        sql: `INSERT INTO ai_usage_daily (day, feature, model, calls, input_tokens, output_tokens, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [g._id.day, String(g._id.feature), String(g._id.model), g.calls, g.input, g.output, now],
      })),
    ],
    "write"
  );
  return { days: new Set(groups.map((g) => g._id.day)).size, rows: groups.length };
}

/**
 * One sync pass: from RECHECK_DAYS before the newest synced day (or the
 * history start) through today, a window at a time until the deadline. Each
 * window is written as it completes, so an interrupted backfill resumes where
 * it stopped. Never throws; the outcome is recorded for the page.
 */
export async function runAiUsageSync(opts: { deadline: number; force?: boolean }): Promise<AiUsageSyncResult> {
  const result: AiUsageSyncResult = { days: 0, rows: 0 };
  const url = aiAuditUrl();
  if (!url) return { ...result, skipped: "no_url" };

  const db = await getDb();
  try {
    if (!(await claimRun(opts.force ?? false, aiAuditDatabase(url)))) return { ...result, skipped: "throttled" };
    const newest = (await db.execute(`SELECT MAX(day) AS d FROM ai_usage_daily`)).rows[0]?.d as string | null;
    let from = newest ? addDays(newest, -RECHECK_DAYS) : COST_HISTORY_START;
    const end = addDays(costToday(), 1); // exclusive: through the end of today
    while (from < end) {
      const remaining = opts.deadline - Date.now();
      if (remaining < MIN_WINDOW_MS) throw new Error("out of time — resumes next run");
      const to = addDays(from, WINDOW_DAYS) < end ? addDays(from, WINDOW_DAYS) : end;
      const w = await syncWindow(url, from, to, remaining - 3_000);
      result.days += w.days;
      result.rows += w.rows;
      from = to;
    }
    await db.execute({ sql: `UPDATE ai_usage_sync SET last_ok_at = ?, last_error = NULL WHERE id = 1`, args: [Date.now()] });
  } catch (err) {
    result.error = err instanceof Error ? err.message : "AI usage sync failed";
    if (!result.error.startsWith("out of time")) {
      await db
        .execute({ sql: `UPDATE ai_usage_sync SET last_error = ? WHERE id = 1`, args: [result.error] })
        .catch(() => undefined);
    }
  }
  return result;
}

export async function getAiUsageSyncState(): Promise<{ lastOkAt: number | null; lastError: string | null; database: string | null }> {
  const db = await getDb();
  const row = (await db.execute(`SELECT last_ok_at, last_error, database FROM ai_usage_sync WHERE id = 1`)).rows[0];
  return {
    lastOkAt: row?.last_ok_at == null ? null : Number(row.last_ok_at),
    lastError: (row?.last_error as string | null) ?? null,
    database: (row?.database as string | null) ?? null,
  };
}
