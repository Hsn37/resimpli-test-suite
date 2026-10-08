import "server-only";
import { getDb } from "./db";
import { aiAuditDatabase, aiAuditUrl, getAiUsageSyncState } from "./aiUsageSync";
import {
  addDays,
  costToday,
  daysBetween,
  tokenCostCents,
  type DayRange,
  type OpenAiCostReport,
  type OpenAiDailyRow,
  type OpenAiLineItemRow,
  type OpenAiProjectRow,
} from "./costs";

// OpenAI-tab report built from the backend's AiAgentAudit token log
// (ai_usage_daily). Shaped as an OpenAiCostReport so the same view renders
// it: each backend FEATURE takes the place of an OpenAI project, and each
// model's input/output cost becomes a line item. Dollars are estimates —
// tokens × AI_MODEL_RATES — not OpenAI's invoice.

const n = (v: unknown): number => (v == null ? 0 : Number(v));

type Row = { day: string; feature: string; model: string; calls: number; input: number; output: number };

export async function getAiUsageReport(range: DayRange): Promise<OpenAiCostReport> {
  const db = await getDb();
  const url = aiAuditUrl();
  const sync = await getAiUsageSyncState();

  // Compare complete days only: today is still filling.
  const lastComplete = addDays(costToday(), -1);
  const compTo = range.to < lastComplete ? range.to : lastComplete;
  const compDays = compTo >= range.from ? daysBetween(range.from, compTo) : 0;
  const prevFrom = compDays ? addDays(range.from, -compDays) : range.from;

  const [inRange, allTime, previous, earliest] = await Promise.all([
    db.execute({
      sql: `SELECT day, feature, model, calls, input_tokens AS input, output_tokens AS output
            FROM ai_usage_daily WHERE day >= ? AND day <= ?`,
      args: [range.from, range.to],
    }),
    db.execute(
      `SELECT feature, model, SUM(input_tokens) AS input, SUM(output_tokens) AS output
       FROM ai_usage_daily GROUP BY feature, model`
    ),
    compDays
      ? db.execute({
          sql: `SELECT feature, model, SUM(input_tokens) AS input, SUM(output_tokens) AS output
                FROM ai_usage_daily WHERE day >= ? AND day < ? GROUP BY feature, model`,
          args: [prevFrom, range.from],
        })
      : null,
    db.execute(`SELECT MIN(day) AS d FROM ai_usage_daily`),
  ]);

  const rows: Row[] = inRange.rows.map((r) => ({
    day: String(r.day),
    feature: String(r.feature ?? ""),
    model: String(r.model ?? ""),
    calls: n(r.calls),
    input: n(r.input),
    output: n(r.output),
  }));
  const unpriced = new Set<string>();
  const cents = (model: string, input: number, output: number) => {
    const c = tokenCostCents(model, input, output);
    if (c == null) {
      if (input || output) unpriced.add(model || "unknown");
      return 0;
    }
    return c;
  };

  const daily = new Map<string, OpenAiDailyRow>();
  const features = new Map<string, OpenAiProjectRow>();
  const lineItems = new Map<string, OpenAiLineItemRow>();
  const comparable = new Map<string, number>();
  for (const r of rows) {
    const c = cents(r.model, r.input, r.output);
    const dk = `${r.day}|${r.feature}`;
    const d = daily.get(dk) ?? { day: r.day, projectId: r.feature, cents: 0, requests: 0 };
    d.cents += c;
    d.requests += r.calls;
    daily.set(dk, d);

    const f = features.get(r.feature) ?? {
      projectId: r.feature,
      name: r.feature || "Untagged",
      archived: false,
      cents: 0,
      allTimeCents: 0,
      requests: 0,
      inputTokens: 0,
      cachedTokens: 0, // not recorded by the audit log
      outputTokens: 0,
    };
    f.cents += c;
    f.requests += r.calls;
    f.inputTokens += r.input;
    f.outputTokens += r.output;
    features.set(r.feature, f);

    for (const [kind, tokens] of [
      ["input", r.input],
      ["output", r.output],
    ] as const) {
      const li = `${r.feature}|${r.model}|${kind}`;
      const e = lineItems.get(li) ?? { projectId: r.feature, lineItem: `${r.model}, ${kind}`, cents: 0 };
      e.cents += kind === "input" ? cents(r.model, tokens, 0) : cents(r.model, 0, tokens);
      lineItems.set(li, e);
    }
    if (r.day <= compTo) comparable.set(r.feature, (comparable.get(r.feature) ?? 0) + c);
  }

  // All-time cost per feature: fixes chart colours as the timeline changes.
  for (const r of allTime.rows) {
    const feature = String(r.feature ?? "");
    const c = tokenCostCents(String(r.model ?? ""), n(r.input), n(r.output)) ?? 0;
    const f = features.get(feature) ?? {
      projectId: feature,
      name: feature || "Untagged",
      archived: false,
      cents: 0,
      allTimeCents: 0,
      requests: 0,
      inputTokens: 0,
      cachedTokens: 0,
      outputTokens: 0,
    };
    f.allTimeCents += c;
    features.set(feature, f);
  }

  let comparison: OpenAiCostReport["comparison"] = null;
  if (previous) {
    const prevByFeature = new Map<string, number>();
    for (const r of previous.rows) {
      const feature = String(r.feature ?? "");
      prevByFeature.set(feature, (prevByFeature.get(feature) ?? 0) + (tokenCostCents(String(r.model ?? ""), n(r.input), n(r.output)) ?? 0));
    }
    const ids = new Set([...comparable.keys(), ...prevByFeature.keys()]);
    comparison = {
      days: compDays,
      byProject: [...ids].map((projectId) => ({
        projectId,
        comparable: comparable.get(projectId) ?? 0,
        previous: prevByFeature.get(projectId) ?? 0,
      })),
    };
  }

  return {
    configured: url != null,
    source: "backend_audit",
    fromDay: range.from,
    toDay: range.to,
    lastSyncOkAt: sync.lastOkAt,
    lastError: sync.lastError,
    earliestDay: (earliest.rows[0]?.d as string | null) ?? null,
    daily: [...daily.values()],
    projects: [...features.values()],
    lineItems: [...lineItems.values()],
    keys: [],
    comparison,
    promptLayer: null,
    audit: {
      database: sync.database ?? (url ? aiAuditDatabase(url) : "unknown"),
      unpricedModels: [...unpriced],
    },
  };
}
