import "server-only";
import { getDb } from "./db";
import { COST_HISTORY_START, addDays, utcToday } from "./costs";

// OpenAI organization spend → openai_cost_daily / openai_usage_daily /
// openai_names, for the Costs Dashboard's OpenAI view. Uses an Admin key
// (OPENAI_API_ADMIN_KEY, scopes api.usage.read + api.management.read) — a
// project key (sk-proj-…) gets 403 from every endpoint here.
//
//   costs  — GET /organization/costs: billed dollars per UTC day, grouped by
//            project + line item. The truth for "how much".
//   usage  — GET /organization/usage/completions: requests + tokens per UTC
//            day, grouped by project + model + API key. OpenAI reports
//            dollars per project only, so per-key is usage, not spend.
//   names  — projects and their API keys, for display.
//
// Runs from the cron tick at most every SYNC_INTERVAL_MS. Each run re-reads
// the last RECHECK_DAYS (OpenAI keeps filling / revising recent buckets) and
// loads history from COST_HISTORY_START on the first run. Every fetched day
// is replaced whole, so overlapping or repeated runs are harmless.

const API = "https://api.openai.com/v1/organization";
const SYNC_INTERVAL_MS = 60 * 60 * 1000;
const RECHECK_DAYS = 3;
const DAYS_PER_PAGE = 31; // daily-bucket page size both endpoints accept
const REQUEST_TIMEOUT_MS = 20_000;
const MIN_REQUEST_MS = 5_000;

export const OPENAI_ADMIN_KEY_ENV = "OPENAI_API_ADMIN_KEY";

/**
 * The Admin key, or null when the variable is unset or holds something else.
 * Only Admin keys (sk-admin-…) can read organization spend; a project key
 * there would 403 every sync and hide the fallback sources, so it's ignored.
 */
export function openAiAdminKey(): string | null {
  const key = process.env[OPENAI_ADMIN_KEY_ENV]?.trim();
  return key && key.startsWith("sk-admin-") ? key : null;
}

export interface OpenAiSyncResult {
  skipped?: "no_key" | "throttled";
  costDays: number;
  usageDays: number;
  projects: number;
  apiKeys: number;
  error?: string;
}

class OutOfTime extends Error {}

async function get<T>(path: string, params: [string, string | number][], key: string, deadline: number): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining < MIN_REQUEST_MS) throw new OutOfTime();
  const qs = new URLSearchParams(params.map(([k, v]) => [k, String(v)]));
  const res = await fetch(`${API}/${path}?${qs}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, remaining - 1000)),
  });
  if (!res.ok) {
    const body = await res.text();
    let message = body.slice(0, 300);
    try {
      const parsed = JSON.parse(body) as { error?: string | { message?: string } };
      message = typeof parsed.error === "string" ? parsed.error : (parsed.error?.message ?? message);
    } catch {
      // Not JSON — keep the raw snippet.
    }
    throw new Error(`OpenAI ${path} ${res.status}: ${message}`);
  }
  return (await res.json()) as T;
}

interface Page<R> {
  data: { start_time: number; results: R[] }[];
  has_more?: boolean;
  next_page?: string | null;
}

interface CostResult {
  amount?: { value?: number | string; currency?: string };
  line_item?: string | null;
  project_id?: string | null;
}

interface UsageResult {
  num_model_requests?: number;
  input_tokens?: number;
  input_cached_tokens?: number;
  output_tokens?: number;
  project_id?: string | null;
  model?: string | null;
  api_key_id?: string | null;
}

const utcDay = (unixSeconds: number) => new Date(unixSeconds * 1000).toISOString().slice(0, 10);
const startOfUtcDay = (day: string) => Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000);
const n = (v: unknown) => {
  const x = typeof v === "string" ? Number(v) : v;
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
};

/** First day to (re)fetch for a table: RECHECK_DAYS before its newest day, or the history start. */
async function resumeDay(table: "openai_cost_daily" | "openai_usage_daily"): Promise<string> {
  const db = await getDb();
  const r = await db.execute(`SELECT MAX(day) AS d FROM ${table}`);
  const newest = r.rows[0]?.d as string | null;
  return newest ? addDays(newest, -RECHECK_DAYS) : COST_HISTORY_START;
}

/**
 * Page through a daily-bucket endpoint from `fromDay`, handing each page's
 * buckets to `write` as they arrive, so an interrupted run keeps what it got
 * and the next run resumes from the newest day written.
 */
async function syncBuckets<R>(
  path: string,
  groupBy: string[],
  fromDay: string,
  key: string,
  deadline: number,
  write: (buckets: { day: string; results: R[] }[]) => Promise<void>
): Promise<number> {
  let page: string | undefined;
  let days = 0;
  do {
    const params: [string, string | number][] = [
      ["start_time", startOfUtcDay(fromDay)],
      ["bucket_width", "1d"],
      ["limit", DAYS_PER_PAGE],
      ...groupBy.map((g): [string, string] => ["group_by", g]),
    ];
    if (page) params.push(["page", page]);
    const res = await get<Page<R>>(path, params, key, deadline);
    const buckets = (res.data ?? []).map((b) => ({ day: utcDay(b.start_time), results: b.results ?? [] }));
    await write(buckets);
    days += buckets.length;
    page = res.has_more && res.next_page ? res.next_page : undefined;
  } while (page);
  return days;
}

async function writeCostDays(buckets: { day: string; results: CostResult[] }[]): Promise<void> {
  if (buckets.length === 0) return;
  const db = await getDb();
  const now = Date.now();
  const stmts = [];
  for (const b of buckets) {
    stmts.push({ sql: `DELETE FROM openai_cost_daily WHERE day = ?`, args: [b.day] });
    // Several results can share project + line item (e.g. currency splits);
    // fold them so the primary key holds.
    const sums = new Map<string, { project: string; item: string; cents: number }>();
    for (const r of b.results) {
      const project = r.project_id ?? "";
      const item = r.line_item ?? "";
      const k = `${project}\u0000${item}`;
      const cur = sums.get(k) ?? { project, item, cents: 0 };
      cur.cents += n(r.amount?.value) * 100;
      sums.set(k, cur);
    }
    for (const s of sums.values()) {
      stmts.push({
        sql: `INSERT INTO openai_cost_daily (day, project_id, line_item, cost_cents, updated_at) VALUES (?, ?, ?, ?, ?)`,
        args: [b.day, s.project, s.item, s.cents, now],
      });
    }
  }
  await db.batch(stmts, "write");
}

async function writeUsageDays(buckets: { day: string; results: UsageResult[] }[]): Promise<void> {
  if (buckets.length === 0) return;
  const db = await getDb();
  const now = Date.now();
  const stmts = [];
  for (const b of buckets) {
    stmts.push({ sql: `DELETE FROM openai_usage_daily WHERE day = ?`, args: [b.day] });
    const sums = new Map<string, { project: string; model: string; key: string; req: number; inp: number; cached: number; out: number }>();
    for (const r of b.results) {
      const project = r.project_id ?? "";
      const model = r.model ?? "";
      const apiKey = r.api_key_id ?? "";
      const k = `${project}\u0000${model}\u0000${apiKey}`;
      const cur = sums.get(k) ?? { project, model, key: apiKey, req: 0, inp: 0, cached: 0, out: 0 };
      cur.req += n(r.num_model_requests);
      cur.inp += n(r.input_tokens);
      cur.cached += n(r.input_cached_tokens);
      cur.out += n(r.output_tokens);
      sums.set(k, cur);
    }
    for (const s of sums.values()) {
      stmts.push({
        sql: `INSERT INTO openai_usage_daily
                (day, project_id, model, api_key_id, requests, input_tokens, cached_tokens, output_tokens, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [b.day, s.project, s.model, s.key, s.req, s.inp, s.cached, s.out, now],
      });
    }
  }
  await db.batch(stmts, "write");
}

interface ListPage<T> {
  data: T[];
  has_more?: boolean;
  last_id?: string | null;
}

async function listAll<T extends { id: string }>(
  path: string,
  extra: [string, string | number][],
  key: string,
  deadline: number
): Promise<T[]> {
  const out: T[] = [];
  let after: string | undefined;
  do {
    const params: [string, string | number][] = [["limit", 100], ...extra];
    if (after) params.push(["after", after]);
    const res = await get<ListPage<T>>(path, params, key, deadline);
    out.push(...(res.data ?? []));
    after = res.has_more ? (res.last_id ?? res.data?.[res.data.length - 1]?.id) : undefined;
  } while (after);
  return out;
}

/** Refresh project and API-key display names. */
async function syncNames(key: string, deadline: number): Promise<{ projects: number; apiKeys: number }> {
  type Project = { id: string; name?: string; status?: string };
  type ApiKey = { id: string; name?: string | null; redacted_value?: string };
  const projects = await listAll<Project>("projects", [["include_archived", "true"]], key, deadline);
  const db = await getDb();
  const now = Date.now();
  const stmts = projects.map((p) => ({
    sql: `INSERT INTO openai_names (kind, id, name, project_id, status, updated_at) VALUES ('project', ?, ?, ?, ?, ?)
          ON CONFLICT(kind, id) DO UPDATE SET name = excluded.name, status = excluded.status, updated_at = excluded.updated_at`,
    args: [p.id, p.name ?? null, p.id, p.status ?? null, now],
  }));
  let apiKeys = 0;
  for (const p of projects) {
    const keys = await listAll<ApiKey>(`projects/${p.id}/api_keys`, [], key, deadline);
    apiKeys += keys.length;
    for (const k of keys) {
      stmts.push({
        sql: `INSERT INTO openai_names (kind, id, name, project_id, status, updated_at) VALUES ('api_key', ?, ?, ?, NULL, ?)
              ON CONFLICT(kind, id) DO UPDATE SET name = excluded.name, project_id = excluded.project_id, updated_at = excluded.updated_at`,
        args: [k.id, k.name || k.redacted_value || null, p.id, now],
      });
    }
  }
  if (stmts.length) await db.batch(stmts, "write");
  return { projects: projects.length, apiKeys };
}

/**
 * Claim this hour's run: stamps last_run_at only if the previous run is older
 * than SYNC_INTERVAL_MS (or `force`), in one statement, so concurrent ticks
 * can't both proceed.
 */
async function claimRun(force: boolean): Promise<boolean> {
  const db = await getDb();
  const now = Date.now();
  await db.execute(`INSERT OR IGNORE INTO openai_cost_sync (id) VALUES (1)`);
  const res = await db.execute({
    sql: `UPDATE openai_cost_sync SET last_run_at = ?
          WHERE id = 1 AND (? OR last_run_at IS NULL OR last_run_at < ?)`,
    args: [now, force ? 1 : 0, now - SYNC_INTERVAL_MS],
  });
  return res.rowsAffected > 0;
}

/** One OpenAI sync pass. Never throws; the outcome is recorded for the page. */
export async function runOpenAiCostSync(opts: { deadline: number; force?: boolean }): Promise<OpenAiSyncResult> {
  const result: OpenAiSyncResult = { costDays: 0, usageDays: 0, projects: 0, apiKeys: 0 };
  const key = openAiAdminKey();
  if (!key) return { ...result, skipped: "no_key" };

  const db = await getDb();
  try {
    if (!(await claimRun(opts.force ?? false))) return { ...result, skipped: "throttled" };
    const [costFrom, usageFrom] = await Promise.all([resumeDay("openai_cost_daily"), resumeDay("openai_usage_daily")]);
    const [costDays, usageDays, names] = await Promise.all([
      syncBuckets<CostResult>("costs", ["project_id", "line_item"], costFrom, key, opts.deadline, writeCostDays),
      syncBuckets<UsageResult>(
        "usage/completions",
        ["project_id", "model", "api_key_id"],
        usageFrom,
        key,
        opts.deadline,
        writeUsageDays
      ),
      syncNames(key, opts.deadline),
    ]);
    Object.assign(result, { costDays, usageDays, ...names });
    await db.execute({
      sql: `UPDATE openai_cost_sync SET last_ok_at = ?, last_error = NULL WHERE id = 1`,
      args: [Date.now()],
    });
  } catch (err) {
    result.error =
      err instanceof OutOfTime ? "out of time — resumes next run" : err instanceof Error ? err.message : "sync failed";
    // Either way the next run (an hour on) resumes from the newest day written;
    // out of time isn't recorded as an error the page should show.
    if (!(err instanceof OutOfTime)) {
      await db
        .execute({ sql: `UPDATE openai_cost_sync SET last_error = ? WHERE id = 1`, args: [result.error] })
        .catch(() => undefined);
    }
  }
  return result;
}

/** Last successful sync + last error, for the page's status line. */
export async function getOpenAiSyncState(): Promise<{ lastOkAt: number | null; lastError: string | null; today: string }> {
  const db = await getDb();
  const r = await db.execute(`SELECT last_ok_at, last_error FROM openai_cost_sync WHERE id = 1`);
  const row = r.rows[0];
  return {
    lastOkAt: row?.last_ok_at == null ? null : Number(row.last_ok_at),
    lastError: (row?.last_error as string | null) ?? null,
    today: utcToday(),
  };
}
