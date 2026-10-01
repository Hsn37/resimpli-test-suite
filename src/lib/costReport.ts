import "server-only";
import { getDb } from "./db";
import { getCostSyncStates } from "./costSync";
import {
  RAW_RETENTION_DAYS,
  addDays,
  costDayOf,
  costDayStartMs,
  costToday,
  daysBetween,
  isCostWorkspace,
  type CostAgentFilter,
  type CostAgentOption,
  type CostAgentRow,
  type CostDailyRow,
  type CostPrevRow,
  type CostProductRow,
  type CostReport,
  type DayRange,
} from "./costs";
import { WORKSPACES } from "./workspace";

// Aggregates the call_cost_daily roll-up for the /costs page (one row per
// workspace × day × agent, maintained by costSync.ts) — a few thousand rows
// for a month instead of every call. Returns every workspace at once, so the
// page filters workspace and re-buckets day/week/month without refetching.
// An optional agent filter narrows everything except agentOptions, which
// stays unfiltered so the agent dropdown keeps its full list.

const n = (v: unknown): number => (v == null ? 0 : Number(v));

export async function getCostReport(range: DayRange, agent: CostAgentFilter | null = null): Promise<CostReport> {
  const db = await getDb();
  const now = Date.now();
  const today = costToday(now);

  // Comparison window: the same number of days right before the range. If the
  // range runs through today, today is only partly over — so the previous
  // window's last day is cut at the same time of day, read from raw rows
  // (while they're still retained; past that, the full day is compared).
  // Callers clamp range.to to today.
  const span = daysBetween(range.from, range.to);
  const prevFrom = addDays(range.from, -span);
  const prevTo = addDays(range.to, -span);
  const rawCutoff = costDayOf(now - RAW_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const prevPartial = range.to >= today && prevTo >= rawCutoff;
  const partialEndMs = costDayStartMs(prevTo) + (now - costDayStartMs(today));

  const agentSql = agent ? ` AND workspace = ? AND agent_id = ?` : "";
  const agentArgs = agent ? [agent.workspace, agent.agentId] : [];
  const where = (from: string, to: string) => ({
    sql: `day >= ? AND day <= ?${agentSql}`,
    args: [from, to, ...agentArgs],
  });
  const cur = where(range.from, range.to);
  const prev = where(prevFrom, prevPartial ? addDays(prevTo, -1) : prevTo);
  // Raw rows are indexed on (workspace, start_ts): always lead with a
  // workspace predicate, or the partial-day read scans the whole index.
  const rawScope = agent
    ? { sql: `workspace = ? AND IFNULL(agent_id, '') = ?`, args: agentArgs }
    : { sql: `workspace IN (${WORKSPACES.map(() => "?").join(", ")})`, args: [...WORKSPACES] };

  const [agents, daily, products, previous, prevPartialRows, sync] = await Promise.all([
    // Unfiltered: agent table + dropdown options. The newest name wins
    // (MAX of "day|name" picks the latest day's name) — agents get renamed.
    db.execute({
      sql: `SELECT workspace, agent_id,
                   MAX(day || '|' || IFNULL(agent_name, '')) AS latest,
                   SUM(calls) AS calls, SUM(connected) AS connected,
                   SUM(billed_sec) AS billed, SUM(cost_cents) AS cents, SUM(conn_ms) AS conn_ms,
                   MIN(min_conn_ms) AS min_ms, MAX(max_conn_ms) AS max_ms
            FROM call_cost_daily
            WHERE day >= ? AND day <= ?
            GROUP BY workspace, agent_id`,
      args: [range.from, range.to],
    }),
    db.execute({
      sql: `SELECT day, workspace, SUM(calls) AS calls, SUM(cost_cents) AS cents, SUM(billed_sec) AS billed
            FROM call_cost_daily
            WHERE ${cur.sql}
            GROUP BY day, workspace`,
      args: cur.args,
    }),
    db.execute({
      sql: `SELECT d.workspace, p.key AS product, SUM(p.value) AS cents
            FROM call_cost_daily d, json_each(d.products) p
            WHERE ${cur.sql.replace(/\b(day|workspace|agent_id)\b/g, "d.$1")} AND d.products IS NOT NULL
            GROUP BY d.workspace, p.key`,
      args: cur.args,
    }),
    db.execute({
      sql: `SELECT workspace, SUM(calls) AS calls, SUM(cost_cents) AS cents
            FROM call_cost_daily
            WHERE ${prev.sql}
            GROUP BY workspace`,
      args: prev.args,
    }),
    prevPartial
      ? db.execute({
          sql: `SELECT workspace, COUNT(*) AS calls, SUM(cost_cents) AS cents
                FROM call_costs
                WHERE ${rawScope.sql} AND start_ts >= ? AND start_ts < ?
                GROUP BY workspace`,
          args: [...rawScope.args, costDayStartMs(prevTo), partialEndMs],
        })
      : null,
    getCostSyncStates(),
  ]);

  const agentOptions: CostAgentOption[] = [];
  const agentRows: CostAgentRow[] = [];
  for (const r of agents.rows) {
    const ws = String(r.workspace);
    if (!isCostWorkspace(ws)) continue;
    const agentId = String(r.agent_id ?? "");
    const latest = String(r.latest ?? "");
    const agentName = latest.slice(latest.indexOf("|") + 1) || null;
    const cents = n(r.cents);
    agentOptions.push({ workspace: ws, agentId, agentName, cents });
    if (agent && (agent.workspace !== ws || agent.agentId !== agentId)) continue;
    const connected = n(r.connected);
    const connSec = n(r.conn_ms) / 1000;
    agentRows.push({
      workspace: ws,
      agentId,
      agentName,
      calls: n(r.calls),
      connected,
      billedSec: n(r.billed),
      cents,
      connectedSec: connSec,
      avgSec: connected ? connSec / connected : null,
      minSec: r.min_ms == null ? null : n(r.min_ms) / 1000,
      maxSec: r.max_ms == null ? null : n(r.max_ms) / 1000,
    });
  }

  const dailyRows: CostDailyRow[] = [];
  for (const r of daily.rows) {
    const ws = String(r.workspace);
    if (!isCostWorkspace(ws)) continue;
    dailyRows.push({ day: String(r.day), workspace: ws, calls: n(r.calls), cents: n(r.cents), billedSec: n(r.billed) });
  }

  const productRows: CostProductRow[] = [];
  for (const r of products.rows) {
    const ws = String(r.workspace);
    if (!isCostWorkspace(ws)) continue;
    productRows.push({ workspace: ws, product: String(r.product), cents: n(r.cents) });
  }

  const prevByWs = new Map<string, CostPrevRow>();
  for (const r of [...previous.rows, ...(prevPartialRows?.rows ?? [])]) {
    const ws = String(r.workspace);
    if (!isCostWorkspace(ws)) continue;
    const p = prevByWs.get(ws) ?? { workspace: ws, calls: 0, cents: 0 };
    p.calls += n(r.calls);
    p.cents += n(r.cents);
    prevByWs.set(ws, p);
  }

  return {
    fromDay: range.from,
    toDay: range.to,
    today,
    prevFromDay: prevFrom,
    prevToDay: prevTo,
    prevPartial,
    agent,
    agentOptions,
    daily: dailyRows,
    agents: agentRows,
    products: productRows,
    previous: [...prevByWs.values()],
    sync,
  };
}
