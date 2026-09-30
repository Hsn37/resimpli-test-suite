import "server-only";
import { getAppConfig, getDb, setAppConfig } from "./db";
import { listCallsV3 } from "./retell";
import {
  COST_HISTORY_START,
  RAW_RETENTION_DAYS,
  addDays,
  costDayOf,
  costDayStartMs,
  costToday,
  type CostSyncState,
} from "./costs";
import { WORKSPACES, type Workspace } from "./workspace";

// Retell → call_costs → call_cost_daily, for the cost dashboard. Runs for
// EVERY workspace (not just DASHBOARD_WORKSPACES) from the cron tick, plus the
// one-off scripts/backfill-costs.ts. Per workspace, in app_config:
//
//   forward  — cost_sync_hwm: how far the sync is caught up. Each run re-reads
//              from hwm - LOOKBACK. The hwm never passes a call that is still
//              in progress (or ended without a cost yet), so those are re-read
//              until they are final.
//   backward — cost_backfill_cursor: walks from "now at first sync" back to
//              cost_backfill_floor (COST_HISTORY_START by default), resumable.
//   roll-ups — cost_rollup_pending: reporting-timezone days whose raw rows
//              changed; each is rebuilt into call_cost_daily. Today is
//              rebuilt at most every ROLLUP_TODAY_INTERVAL_MS.
//   prune    — call rows older than RAW_RETENTION_DAYS are deleted daily,
//              only once every pending roll-up is built.
//
// Retell's v3 start_timestamp range filter is inclusive at both ends, so the
// backfill resumes from the oldest start_ts it has seen; the boundary rows are
// simply re-upserted.

const LOOKBACK_MS = 20 * 60 * 1000;
// An unfinished call holds the hwm back at most this long (Retell's default
// max call duration is 1h), so a call stuck "ongoing" can't pin it forever.
const MAX_PIN_MS = 2 * 60 * 60 * 1000;
// Don't start a Retell page with less time than this left before the deadline.
const MIN_PAGE_MS = 12_000;
const REQUEST_TIMEOUT_MS = 20_000;
const FETCH_ATTEMPTS = 3;
const ROLLUP_TODAY_INTERVAL_MS = 5 * 60 * 1000;
// Bump to rebuild every roll-up day still covered by raw rows (e.g. after
// changing what a roll-up row holds).
const ROLLUP_VERSION = 1;
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const PRUNE_BATCH = 5000;

// Calls without a final cost yet — not stored; the forward sync re-reads them.
const UNFINISHED_STATUSES = new Set(["registered", "ongoing"]);

const KEYS = {
  hwm: "cost_sync_hwm",
  lastSyncAt: "cost_last_sync_at",
  backfillCursor: "cost_backfill_cursor",
  backfillFloor: "cost_backfill_floor",
  backfillComplete: "cost_backfill_complete",
  rollupPending: "cost_rollup_pending",
  rollupVersion: "cost_rollup_version",
  rollupTodayAt: "cost_rollup_today_at",
  pruneAt: "cost_prune_at",
} as const;

type RetellCall = Record<string, unknown>;

interface CostRow {
  call_id: string;
  agent_id: string | null;
  agent_name: string | null;
  agent_version: number | null;
  direction: string | null;
  call_status: string | null;
  disconnection_reason: string | null;
  start_ts: number;
  duration_ms: number | null;
  billed_sec: number | null;
  cost_cents: number | null;
  products: string | null;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Normalize one list-calls item into a call_costs row, or null to skip it. */
export function toCostRow(call: RetellCall): CostRow | null {
  const callId = str(call.call_id);
  const start = num(call.start_timestamp);
  const status = str(call.call_status);
  if (!callId || start == null) return null;
  if (status && UNFINISHED_STATUSES.has(status)) return null;

  const cost =
    call.call_cost && typeof call.call_cost === "object"
      ? (call.call_cost as Record<string, unknown>)
      : null;
  const products: Record<string, number> = {};
  if (Array.isArray(cost?.product_costs)) {
    for (const p of cost.product_costs as Record<string, unknown>[]) {
      const name = str(p?.product);
      const cents = num(p?.cost);
      if (name && cents != null) products[name] = (products[name] ?? 0) + cents;
    }
  }
  const end = num(call.end_timestamp);
  const durationMs = num(call.duration_ms) ?? (end != null ? Math.max(0, end - start) : null);

  return {
    call_id: callId,
    agent_id: str(call.agent_id),
    agent_name: str(call.agent_name),
    agent_version: num(call.agent_version),
    direction: str(call.direction) ?? str(call.call_type),
    call_status: status,
    disconnection_reason: str(call.disconnection_reason),
    start_ts: start,
    duration_ms: durationMs,
    billed_sec: num(cost?.total_duration_seconds),
    cost_cents: num(cost?.combined_cost),
    products: Object.keys(products).length ? JSON.stringify(products) : null,
  };
}

/** A call the forward sync must see again: still running, or ended without a cost yet. */
function awaitingFinalCost(call: RetellCall, row: CostRow | null): boolean {
  if (!row) return UNFINISHED_STATUSES.has(str(call.call_status) ?? "");
  return row.call_status === "ended" && row.cost_cents == null;
}

/**
 * Upsert rows in one batch and return the ones that actually changed. The DO
 * UPDATE is guarded so re-reading an unchanged call (every lookback / boundary
 * overlap) costs no row write — and reports rowsAffected = 0, which is how we
 * know which days' roll-ups need rebuilding.
 */
async function upsertCostRows(workspace: Workspace, rows: CostRow[]): Promise<CostRow[]> {
  if (rows.length === 0) return [];
  const db = await getDb();
  const now = Date.now();
  const results = await db.batch(
    rows.map((r) => ({
      sql: `INSERT INTO call_costs
              (call_id, workspace, agent_id, agent_name, agent_version, direction, call_status,
               disconnection_reason, start_ts, duration_ms, billed_sec, cost_cents, products, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(call_id) DO UPDATE SET
              agent_name = excluded.agent_name,
              call_status = excluded.call_status,
              disconnection_reason = excluded.disconnection_reason,
              duration_ms = excluded.duration_ms,
              billed_sec = excluded.billed_sec,
              cost_cents = excluded.cost_cents,
              products = excluded.products,
              updated_at = excluded.updated_at
            WHERE call_costs.cost_cents IS NOT excluded.cost_cents
               OR call_costs.call_status IS NOT excluded.call_status
               OR call_costs.products IS NOT excluded.products
               OR call_costs.agent_name IS NOT excluded.agent_name
               OR call_costs.duration_ms IS NOT excluded.duration_ms
               OR call_costs.billed_sec IS NOT excluded.billed_sec
               OR call_costs.disconnection_reason IS NOT excluded.disconnection_reason`,
      args: [
        r.call_id,
        workspace,
        r.agent_id,
        r.agent_name,
        r.agent_version,
        r.direction,
        r.call_status,
        r.disconnection_reason,
        r.start_ts,
        r.duration_ms,
        r.billed_sec,
        r.cost_cents,
        r.products,
        now,
      ],
    })),
    "write"
  );
  return rows.filter((_, i) => results[i].rowsAffected > 0);
}

// ---------------------------------------------------------------------------
// Retell paging with a hard time budget
// ---------------------------------------------------------------------------

/**
 * One list-calls page, or null when there isn't time left to fetch one. Each
 * request is capped by a timeout that never runs past the deadline; Retell
 * drops the connection now and then on these multi-MB pages, so network
 * failures and timeouts are retried while time remains. HTTP errors are not.
 */
async function fetchPage(
  body: Parameters<typeof listCallsV3>[0],
  apiKey: string,
  deadline: number
): Promise<Awaited<ReturnType<typeof listCallsV3>> | null> {
  for (let attempt = 1; ; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining < MIN_PAGE_MS) return null;
    try {
      return await listCallsV3(body, apiKey, AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, remaining - 2000)));
    } catch (err) {
      const retriable =
        (err instanceof TypeError && err.message === "fetch failed") ||
        (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError"));
      if (!retriable || attempt >= FETCH_ATTEMPTS) throw err;
      await new Promise((res) => setTimeout(res, attempt * 1000));
    }
  }
}

function rangeFilter(lo: number, hi: number) {
  return { start_timestamp: { type: "range", op: "bt", value: [lo, hi] } };
}

function historyFloorMs(): number {
  return costDayStartMs(COST_HISTORY_START);
}

export interface CostSyncResult {
  workspace: Workspace;
  forward: { fetched: number; done: boolean };
  backfill: { fetched: number; done: boolean; cursor: number | null };
  rollups: { rebuilt: number; pending: number };
  pruned: number;
  error?: string;
}

interface SyncOpts {
  deadline: number;
  pageSize: number;
}

/** Forward sync: everything since hwm - LOOKBACK, oldest first. */
async function syncForward(
  workspace: Workspace,
  apiKey: string,
  opts: SyncOpts,
  dirty: Set<string>
): Promise<CostSyncResult["forward"]> {
  const now = Date.now();
  const hwm = (await getAppConfig<number>(workspace, KEYS.hwm)) ?? now;
  let newest = hwm;
  let oldestUnfinished = Infinity;
  let fetched = 0;
  let paginationKey: string | undefined;

  // Never advance past a call that still needs a final read (bounded by MAX_PIN_MS).
  const nextHwm = () =>
    Math.min(newest, oldestUnfinished === Infinity ? newest : Math.max(oldestUnfinished, now - MAX_PIN_MS));

  do {
    const page = await fetchPage(
      {
        limit: opts.pageSize,
        sort_order: "ascending",
        filter_criteria: rangeFilter(hwm - LOOKBACK_MS, now),
        ...(paginationKey ? { pagination_key: paginationKey } : {}),
      },
      apiKey,
      opts.deadline
    );
    if (!page) {
      await setAppConfig(workspace, KEYS.hwm, nextHwm());
      return { fetched, done: false };
    }
    fetched += page.items.length;
    const rows: CostRow[] = [];
    for (const call of page.items) {
      const row = toCostRow(call);
      const start = num(call.start_timestamp);
      if (start != null && awaitingFinalCost(call, row)) oldestUnfinished = Math.min(oldestUnfinished, start);
      if (row) {
        rows.push(row);
        newest = Math.max(newest, row.start_ts);
      }
    }
    for (const r of await upsertCostRows(workspace, rows)) dirty.add(costDayOf(r.start_ts));
    paginationKey = page.has_more ? page.pagination_key : undefined;
  } while (paginationKey);

  await setAppConfig(workspace, KEYS.hwm, nextHwm());
  await setAppConfig(workspace, KEYS.lastSyncAt, Date.now());
  return { fetched, done: true };
}

/** Backfill: walk backward from the cursor to the floor, one page per step. */
async function syncBackfill(
  workspace: Workspace,
  apiKey: string,
  opts: SyncOpts,
  dirty: Set<string>
): Promise<CostSyncResult["backfill"]> {
  const [complete, cursorRaw, floorRaw] = await Promise.all([
    getAppConfig<boolean>(workspace, KEYS.backfillComplete),
    getAppConfig<number>(workspace, KEYS.backfillCursor),
    getAppConfig<number>(workspace, KEYS.backfillFloor),
  ]);
  if (complete === true) return { fetched: 0, done: true, cursor: null };

  let floor = floorRaw ?? historyFloorMs();
  if (floorRaw == null) await setAppConfig(workspace, KEYS.backfillFloor, floor);
  let cursor = cursorRaw ?? Date.now();
  let fetched = 0;

  for (;;) {
    const page = await fetchPage(
      { limit: opts.pageSize, sort_order: "descending", filter_criteria: rangeFilter(floor, cursor) },
      apiKey,
      opts.deadline
    );
    if (!page) return { fetched, done: false, cursor };
    fetched += page.items.length;
    const rows = page.items.map(toCostRow).filter((r): r is CostRow => r != null);
    for (const r of await upsertCostRows(workspace, rows)) dirty.add(costDayOf(r.start_ts));

    if (!page.has_more || page.items.length === 0) {
      // Compare-and-set: `--since` may have moved the floor earlier while this
      // run was walking. If so, keep going from the old floor instead of
      // declaring the (now longer) history complete.
      const floorNow = await getAppConfig<number>(workspace, KEYS.backfillFloor);
      if (floorNow != null && floorNow < floor) {
        cursor = floor;
        floor = floorNow;
        await setAppConfig(workspace, KEYS.backfillCursor, cursor);
        continue;
      }
      await setAppConfig(workspace, KEYS.backfillCursor, null);
      await setAppConfig(workspace, KEYS.backfillComplete, true);
      return { fetched, done: true, cursor: null };
    }
    // Inclusive range: resume AT the oldest start_ts. Only a full page sharing
    // one millisecond could stall this; step past it rather than loop.
    const starts = page.items.map((c) => num(c.start_timestamp)).filter((t): t is number => t != null);
    const oldest = starts.length ? Math.min(...starts) : floor;
    cursor = oldest < cursor ? oldest : cursor - 1;
    await setAppConfig(workspace, KEYS.backfillCursor, cursor);
  }
}

// ---------------------------------------------------------------------------
// Daily roll-ups (call_cost_daily)
// ---------------------------------------------------------------------------

function retentionCutoffDay(now = Date.now()): string {
  return costDayOf(now - RAW_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Rebuild one workspace-day of roll-ups from its raw call rows. A day older
 * than raw retention with no raw rows left is skipped, not wiped — its
 * roll-up is the only record of it.
 */
async function rebuildDay(workspace: Workspace, day: string): Promise<void> {
  const db = await getDb();
  const res = await db.execute({
    sql: `SELECT agent_id, agent_name, call_status, duration_ms, billed_sec, cost_cents, products, start_ts
          FROM call_costs
          WHERE workspace = ? AND start_ts >= ? AND start_ts < ?`,
    args: [workspace, costDayStartMs(day), costDayStartMs(addDays(day, 1))],
  });
  if (res.rows.length === 0 && day < retentionCutoffDay()) return;

  type Agg = {
    name: string | null;
    nameTs: number;
    calls: number;
    connected: number;
    billedSec: number;
    cents: number;
    connMs: number;
    minMs: number | null;
    maxMs: number | null;
    products: Record<string, number>;
  };
  const byAgent = new Map<string, Agg>();
  for (const r of res.rows) {
    const agentId = (r.agent_id as string | null) ?? "";
    let a = byAgent.get(agentId);
    if (!a) {
      a = { name: null, nameTs: -1, calls: 0, connected: 0, billedSec: 0, cents: 0, connMs: 0, minMs: null, maxMs: null, products: {} };
      byAgent.set(agentId, a);
    }
    const ts = Number(r.start_ts);
    if (ts > a.nameTs && r.agent_name != null) {
      a.name = String(r.agent_name);
      a.nameTs = ts;
    }
    a.calls += 1;
    a.billedSec += Number(r.billed_sec ?? 0);
    a.cents += Number(r.cost_cents ?? 0);
    if (r.call_status === "ended") {
      const ms = Number(r.duration_ms ?? 0);
      a.connected += 1;
      a.connMs += ms;
      a.minMs = a.minMs == null ? ms : Math.min(a.minMs, ms);
      a.maxMs = a.maxMs == null ? ms : Math.max(a.maxMs, ms);
    }
    if (typeof r.products === "string") {
      try {
        for (const [k, v] of Object.entries(JSON.parse(r.products) as Record<string, number>)) {
          a.products[k] = (a.products[k] ?? 0) + Number(v);
        }
      } catch {
        // Malformed products JSON — the call's total still counts.
      }
    }
  }

  const now = Date.now();
  await db.batch(
    [
      { sql: `DELETE FROM call_cost_daily WHERE day = ? AND workspace = ?`, args: [day, workspace] },
      ...[...byAgent.entries()].map(([agentId, a]) => ({
        sql: `INSERT INTO call_cost_daily
                (day, workspace, agent_id, agent_name, calls, connected, billed_sec, cost_cents,
                 conn_ms, min_conn_ms, max_conn_ms, products, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          day,
          workspace,
          agentId,
          a.name,
          a.calls,
          a.connected,
          a.billedSec,
          a.cents,
          a.connMs,
          a.minMs,
          a.maxMs,
          Object.keys(a.products).length ? JSON.stringify(a.products) : null,
          now,
        ],
      })),
    ],
    "write"
  );
}

/**
 * Queue `dirty` days and rebuild as many pending days as time allows, newest
 * first. The merged queue is saved BEFORE rebuilding, so a failure part-way
 * never loses a day that still needs rebuilding.
 */
async function refreshRollups(
  workspace: Workspace,
  dirty: Set<string>,
  deadline: number,
  rebuildTodayNow: boolean
): Promise<CostSyncResult["rollups"]> {
  const [pendingRaw, version, todayAt, floorRaw] = await Promise.all([
    getAppConfig<string[]>(workspace, KEYS.rollupPending),
    getAppConfig<number>(workspace, KEYS.rollupVersion),
    getAppConfig<number>(workspace, KEYS.rollupTodayAt),
    getAppConfig<number>(workspace, KEYS.backfillFloor),
  ]);
  const pending = new Set([...(Array.isArray(pendingRaw) ? pendingRaw : []), ...dirty]);
  const today = costToday();

  // First run (or a ROLLUP_VERSION bump): queue every day raw rows can cover.
  if (version !== ROLLUP_VERSION) {
    const floorDay = costDayOf(floorRaw ?? historyFloorMs());
    const cutoff = retentionCutoffDay();
    for (let d = floorDay < cutoff ? cutoff : floorDay; d <= today; d = addDays(d, 1)) pending.add(d);
    await setAppConfig(workspace, KEYS.rollupVersion, ROLLUP_VERSION);
  }
  await setAppConfig(workspace, KEYS.rollupPending, [...pending]);

  const todayDue = rebuildTodayNow || !todayAt || Date.now() - todayAt >= ROLLUP_TODAY_INTERVAL_MS;
  let rebuilt = 0;
  for (const day of [...pending].sort().reverse()) {
    if (day === today && !todayDue) continue;
    if (Date.now() > deadline - 3000) break;
    await rebuildDay(workspace, day);
    pending.delete(day);
    rebuilt += 1;
    if (day === today) await setAppConfig(workspace, KEYS.rollupTodayAt, Date.now());
  }
  if (rebuilt > 0) await setAppConfig(workspace, KEYS.rollupPending, [...pending]);
  return { rebuilt, pending: pending.size };
}

/**
 * Delete call rows past RAW_RETENTION_DAYS, at most once a day and only when
 * no roll-up day is still waiting to be built from them.
 */
async function pruneRawRows(workspace: Workspace, deadline: number): Promise<number> {
  const [lastAt, pending] = await Promise.all([
    getAppConfig<number>(workspace, KEYS.pruneAt),
    getAppConfig<string[]>(workspace, KEYS.rollupPending),
  ]);
  if (lastAt && Date.now() - lastAt < PRUNE_INTERVAL_MS) return 0;
  if (Array.isArray(pending) && pending.length > 0) return 0;

  const db = await getDb();
  const cutoffMs = costDayStartMs(retentionCutoffDay());
  let pruned = 0;
  for (;;) {
    if (Date.now() > deadline - 3000) return pruned;
    const res = await db.execute({
      sql: `DELETE FROM call_costs WHERE call_id IN (
              SELECT call_id FROM call_costs WHERE workspace = ? AND start_ts < ? LIMIT ?)`,
      args: [workspace, cutoffMs, PRUNE_BATCH],
    });
    pruned += res.rowsAffected;
    if (res.rowsAffected < PRUNE_BATCH) break;
  }
  await setAppConfig(workspace, KEYS.pruneAt, Date.now());
  return pruned;
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/**
 * One sync pass for a workspace: forward first (freshness wins), then the
 * backfill, then roll-ups for every day that changed, then the daily prune.
 * Never throws — errors are reported, and changed days are always queued.
 */
export async function runCostSync(
  workspace: Workspace,
  apiKey: string,
  // pageSize: Retell page (500 keeps a cron page ~3.5 MB; the script uses 1000).
  // rebuildTodayNow: skip today's roll-up throttle (the script, which runs until
  // nothing is pending).
  opts: { deadline: number; pageSize?: number; rebuildTodayNow?: boolean }
): Promise<CostSyncResult> {
  const sync: SyncOpts = { deadline: opts.deadline, pageSize: opts.pageSize ?? 500 };
  const dirty = new Set<string>();
  const result: CostSyncResult = {
    workspace,
    forward: { fetched: 0, done: false },
    backfill: { fetched: 0, done: false, cursor: null },
    rollups: { rebuilt: 0, pending: 0 },
    pruned: 0,
  };
  const describe = (err: unknown) => {
    // Undici's bare "fetch failed" hides the real reason in `cause`.
    const cause = err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : "";
    return err instanceof Error ? `${err.message}${cause}` : "cost sync failed";
  };

  try {
    // First sync ever: pin the backfill's starting point before the forward
    // cursor exists, so the two walks meet with no gap.
    if ((await getAppConfig<number>(workspace, KEYS.hwm)) == null) {
      const now = Date.now();
      await setAppConfig(workspace, KEYS.hwm, now);
      if ((await getAppConfig<number>(workspace, KEYS.backfillCursor)) == null) {
        await setAppConfig(workspace, KEYS.backfillCursor, now);
      }
    }
    result.forward = await syncForward(workspace, apiKey, sync, dirty);
    result.backfill = await syncBackfill(workspace, apiKey, sync, dirty);
  } catch (err) {
    result.error = describe(err);
  }
  try {
    result.rollups = await refreshRollups(workspace, dirty, opts.deadline, opts.rebuildTodayNow ?? false);
    result.pruned = await pruneRawRows(workspace, opts.deadline);
  } catch (err) {
    result.error ??= describe(err);
  }
  return result;
}

/**
 * Move the backfill floor earlier (e.g. `--since 2025-06-01`). Reopens the
 * backfill from wherever it stopped; a later floor is ignored. Note that rows
 * older than RAW_RETENTION_DAYS are rolled up and then pruned.
 */
export async function extendCostHistory(workspace: Workspace, sinceMs: number): Promise<void> {
  const floor = (await getAppConfig<number>(workspace, KEYS.backfillFloor)) ?? historyFloorMs();
  if (sinceMs >= floor) return;
  const complete = (await getAppConfig<boolean>(workspace, KEYS.backfillComplete)) === true;
  await setAppConfig(workspace, KEYS.backfillFloor, sinceMs);
  if (complete) {
    await setAppConfig(workspace, KEYS.backfillComplete, false);
    await setAppConfig(workspace, KEYS.backfillCursor, floor);
  }
}

/** Freshness + coverage for every workspace, in one app_config read. */
export async function getCostSyncStates(): Promise<CostSyncState[]> {
  const db = await getDb();
  const keys = [KEYS.lastSyncAt, KEYS.backfillComplete, KEYS.backfillCursor, KEYS.backfillFloor];
  const res = await db.execute({
    sql: `SELECT workspace, key, value FROM app_config WHERE key IN (${keys.map(() => "?").join(", ")})`,
    args: keys,
  });
  const cfg = new Map<string, unknown>();
  for (const r of res.rows) {
    try {
      cfg.set(`${r.workspace}|${r.key}`, JSON.parse(String(r.value)));
    } catch {
      // Unparseable value — treat as unset.
    }
  }
  const get = (ws: Workspace, key: string) => cfg.get(`${ws}|${key}`);
  return WORKSPACES.map((workspace) => {
    const complete = get(workspace, KEYS.backfillComplete) === true;
    const cursor = get(workspace, KEYS.backfillCursor);
    const floor = get(workspace, KEYS.backfillFloor);
    const lastSyncAt = get(workspace, KEYS.lastSyncAt);
    return {
      workspace,
      lastSyncAt: typeof lastSyncAt === "number" ? lastSyncAt : null,
      backfilledTo: complete
        ? typeof floor === "number"
          ? floor
          : historyFloorMs()
        : typeof cursor === "number"
          ? cursor
          : null,
      backfillComplete: complete,
    };
  });
}
