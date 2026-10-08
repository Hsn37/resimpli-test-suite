import "server-only";
import { getDb } from "./db";
import { getOpenAiSyncState, openAiAdminKey } from "./openaiCosts";
import { getPromptLayerCostReport, promptLayerApiKey } from "./promptLayerCosts";
import { aiAuditUrl } from "./aiUsageSync";
import { getAiUsageReport } from "./aiUsageReport";
import {
  addDays,
  daysBetween,
  type DayRange,
  type OpenAiCostReport,
  type OpenAiDailyRow,
  type OpenAiKeyRow,
  type OpenAiLineItemRow,
  type OpenAiProjectRow,
} from "./costs";

// Aggregates the synced OpenAI tables for the Costs Dashboard's OpenAI view.
// Everything is returned unfiltered by project (a few hundred rows at most),
// so the page filters by project without refetching.

const n = (v: unknown): number => (v == null ? 0 : Number(v));

export async function getOpenAiCostReport(range: DayRange): Promise<OpenAiCostReport> {
  // Without an organization Admin key, use PromptLayer's observed stage
  // activity plus tokenized template floors. This path intentionally returns a
  // single synthetic "project" only so the shared page header can include its
  // observed spend; the PromptLayer UI explains the narrower coverage.
  // An Admin key that has never synced successfully (wrong scopes, revoked…)
  // shouldn't blank the tab while another source has data.
  const adminUsable = openAiAdminKey() != null && ((await getOpenAiSyncState()).lastOkAt != null || !aiAuditUrl());
  if (!adminUsable) {
    // Next best: the backend's own per-call token log, priced per model.
    if (aiAuditUrl()) return getAiUsageReport(range);
    if (promptLayerApiKey()) {
      const promptLayer = await getPromptLayerCostReport(range);
      const projectId = "promptlayer-stage";
      return {
        configured: true,
        source: "promptlayer",
        fromDay: range.from,
        toDay: range.to,
        lastSyncOkAt: promptLayer.fetchedAt,
        lastError: promptLayer.warning,
        earliestDay: promptLayer.daily.find((row) => row.requests > 0)?.day ?? null,
        daily: promptLayer.daily.map((row) => ({
          day: row.day,
          projectId,
          cents: row.cents,
          requests: row.requests,
        })),
        projects: [
          {
            projectId,
            name: "PromptLayer stage workspace",
            archived: false,
            cents: promptLayer.cents,
            allTimeCents: promptLayer.cents,
            requests: promptLayer.requests,
            inputTokens: promptLayer.inputTokens,
            cachedTokens: promptLayer.cachedTokens,
            outputTokens: promptLayer.outputTokens,
          },
        ],
        lineItems: promptLayer.models.map((row) => ({
          projectId,
          lineItem: `${row.model}, observed`,
          cents: row.cents,
        })),
        keys: [],
        comparison: null,
        promptLayer,
        audit: null,
      };
    }
    return {
      configured: false,
      source: "none",
      fromDay: range.from,
      toDay: range.to,
      lastSyncOkAt: null,
      lastError: null,
      earliestDay: null,
      daily: [],
      projects: [],
      lineItems: [],
      keys: [],
      comparison: null,
      promptLayer: null,
      audit: null,
    };
  }

  const db = await getDb();
  const sync = await getOpenAiSyncState();

  // Compare complete days only: today's UTC bucket is still filling.
  const lastComplete = addDays(sync.today, -1);
  const compTo = range.to < lastComplete ? range.to : lastComplete;
  const compDays = compTo >= range.from ? daysBetween(range.from, compTo) : 0;

  const [daily, requests, projects, allTime, lineItems, keys, earliest, comparable, previous] = await Promise.all([
    db.execute({
      sql: `SELECT day, project_id, SUM(cost_cents) AS cents FROM openai_cost_daily
            WHERE day >= ? AND day <= ? GROUP BY day, project_id`,
      args: [range.from, range.to],
    }),
    db.execute({
      sql: `SELECT day, project_id, SUM(requests) AS requests FROM openai_usage_daily
            WHERE day >= ? AND day <= ? GROUP BY day, project_id`,
      args: [range.from, range.to],
    }),
    db.execute({
      sql: `SELECT project_id, SUM(requests) AS requests, SUM(input_tokens) AS inp,
                   SUM(cached_tokens) AS cached, SUM(output_tokens) AS outp
            FROM openai_usage_daily WHERE day >= ? AND day <= ? GROUP BY project_id`,
      args: [range.from, range.to],
    }),
    db.execute(`SELECT project_id, SUM(cost_cents) AS cents FROM openai_cost_daily GROUP BY project_id`),
    db.execute({
      sql: `SELECT project_id, line_item, SUM(cost_cents) AS cents FROM openai_cost_daily
            WHERE day >= ? AND day <= ? GROUP BY project_id, line_item`,
      args: [range.from, range.to],
    }),
    db.execute({
      sql: `SELECT u.project_id, u.api_key_id, u.model, n.name AS key_name,
                   SUM(u.requests) AS requests, SUM(u.input_tokens) AS inp,
                   SUM(u.cached_tokens) AS cached, SUM(u.output_tokens) AS outp
            FROM openai_usage_daily u
            LEFT JOIN openai_names n ON n.kind = 'api_key' AND n.id = u.api_key_id
            WHERE u.day >= ? AND u.day <= ?
            GROUP BY u.project_id, u.api_key_id, u.model`,
      args: [range.from, range.to],
    }),
    db.execute(`SELECT MIN(day) AS d FROM openai_cost_daily`),
    compDays
      ? db.execute({
          sql: `SELECT project_id, SUM(cost_cents) AS cents FROM openai_cost_daily
                WHERE day >= ? AND day <= ? GROUP BY project_id`,
          args: [range.from, compTo],
        })
      : null,
    compDays
      ? db.execute({
          sql: `SELECT project_id, SUM(cost_cents) AS cents FROM openai_cost_daily
                WHERE day >= ? AND day <= ? GROUP BY project_id`,
          args: [addDays(range.from, -compDays), addDays(range.from, -1)],
        })
      : null,
  ]);

  const names = await db.execute(`SELECT id, name, status FROM openai_names WHERE kind = 'project'`);
  const nameOf = new Map(names.rows.map((r) => [String(r.id), { name: (r.name as string) ?? null, status: r.status }]));

  // Daily spend, joined with daily requests per project.
  const dailyMap = new Map<string, OpenAiDailyRow>();
  for (const r of daily.rows) {
    const projectId = String(r.project_id ?? "");
    dailyMap.set(`${r.day}|${projectId}`, { day: String(r.day), projectId, cents: n(r.cents), requests: 0 });
  }
  for (const r of requests.rows) {
    const projectId = String(r.project_id ?? "");
    const k = `${r.day}|${projectId}`;
    const row = dailyMap.get(k) ?? { day: String(r.day), projectId, cents: 0, requests: 0 };
    row.requests += n(r.requests);
    dailyMap.set(k, row);
  }

  // Projects: anything with spend in range, usage in range, or spend ever.
  const allTimeOf = new Map(allTime.rows.map((r) => [String(r.project_id ?? ""), n(r.cents)]));
  const usageOf = new Map(projects.rows.map((r) => [String(r.project_id ?? ""), r]));
  const centsOf = new Map<string, number>();
  for (const row of dailyMap.values()) centsOf.set(row.projectId, (centsOf.get(row.projectId) ?? 0) + row.cents);
  const ids = new Set([...centsOf.keys(), ...usageOf.keys(), ...allTimeOf.keys()]);
  const projectRows: OpenAiProjectRow[] = [...ids].map((projectId) => {
    const u = usageOf.get(projectId);
    const meta = nameOf.get(projectId);
    return {
      projectId,
      name: meta?.name ?? null,
      archived: meta?.status === "archived",
      cents: centsOf.get(projectId) ?? 0,
      allTimeCents: allTimeOf.get(projectId) ?? 0,
      requests: n(u?.requests),
      inputTokens: n(u?.inp),
      cachedTokens: n(u?.cached),
      outputTokens: n(u?.outp),
    };
  });

  const lineItemRows: OpenAiLineItemRow[] = lineItems.rows.map((r) => ({
    projectId: String(r.project_id ?? ""),
    lineItem: String(r.line_item ?? ""),
    cents: n(r.cents),
  }));

  const keyRows: OpenAiKeyRow[] = keys.rows.map((r) => ({
    projectId: String(r.project_id ?? ""),
    apiKeyId: String(r.api_key_id ?? ""),
    apiKeyName: (r.key_name as string) ?? null,
    model: String(r.model ?? ""),
    requests: n(r.requests),
    inputTokens: n(r.inp),
    cachedTokens: n(r.cached),
    outputTokens: n(r.outp),
  }));

  let comparison: OpenAiCostReport["comparison"] = null;
  if (comparable && previous) {
    const byProject = new Map<string, { projectId: string; comparable: number; previous: number }>();
    const entry = (id: string) => byProject.get(id) ?? { projectId: id, comparable: 0, previous: 0 };
    for (const r of comparable.rows) {
      const e = entry(String(r.project_id ?? ""));
      e.comparable += n(r.cents);
      byProject.set(e.projectId, e);
    }
    for (const r of previous.rows) {
      const e = entry(String(r.project_id ?? ""));
      e.previous += n(r.cents);
      byProject.set(e.projectId, e);
    }
    comparison = { days: compDays, byProject: [...byProject.values()] };
  }

  return {
    configured: openAiAdminKey() != null,
    source: "openai_admin",
    fromDay: range.from,
    toDay: range.to,
    lastSyncOkAt: sync.lastOkAt,
    lastError: sync.lastError,
    earliestDay: (earliest.rows[0]?.d as string | null) ?? null,
    daily: [...dailyMap.values()],
    projects: projectRows,
    lineItems: lineItemRows,
    keys: keyRows,
    comparison,
    promptLayer: null,
    audit: null,
  };
}
