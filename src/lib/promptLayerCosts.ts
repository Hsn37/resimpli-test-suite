import "server-only";

import { getEncoding } from "js-tiktoken";
import { getDb } from "./db";
import { addDays, modelRate, type DayRange, type PromptLayerCostReport, type PromptLayerTemplateEstimate } from "./costs";

// PromptLayer fallback for /costs when an OpenAI organization Admin key is not
// available. It reports exact usage for calls observed by the stage
// PromptLayer workspace, then inventories the prompt templates referenced by
// the backend's origin/stage-review branch. It is intentionally not presented
// as an OpenAI invoice total: direct SDK calls are only included when they were
// separately logged to PromptLayer.

const API = "https://api.promptlayer.com";
const REQUEST_TIMEOUT_MS = 25_000;
const ANALYTICS_TTL_MS = 15 * 60 * 1000;
const TEMPLATES_TTL_MS = 6 * 60 * 60 * 1000;

// This workspace's v2 analytics index rejects ranges beginning before its
// OpenSearch cutover. Template inventory remains available for earlier ranges.
export const PROMPTLAYER_ANALYTICS_START = "2026-05-01";
export const PROMPTLAYER_KEY_ENV = "PROMPTLAYER_API_KEY";

type TemplateSpec = {
  feature: string;
  stageId: number;
  backendModel: "gpt-5.4-mini" | "gpt-5.4-nano";
  maxOutputTokens: number;
};

// Derived from resimpli-api-fork-hisan origin/stage-review. Most flows use the
// shared gptModel/smsGptModel defaults (gpt-5.4-nano); explicit backend model
// and max-output overrides are recorded here so stale PromptLayer playground
// model settings do not drive the estimate.
const TEMPLATE_SPECS: readonly TemplateSpec[] = [
  { feature: "conversationalAi", stageId: 181301, backendModel: "gpt-5.4-nano", maxOutputTokens: 600 },
  { feature: "aiFieldsExtractor", stageId: 181389, backendModel: "gpt-5.4-nano", maxOutputTokens: 4096 },
  { feature: "buyerAiFieldsExtractor", stageId: 181392, backendModel: "gpt-5.4-nano", maxOutputTokens: 4096 },
  { feature: "buyerPreCallBrief", stageId: 181439, backendModel: "gpt-5.4-nano", maxOutputTokens: 4096 },
  { feature: "buyerPsychology", stageId: 181444, backendModel: "gpt-5.4-nano", maxOutputTokens: 8192 },
  { feature: "buyerSummary", stageId: 181445, backendModel: "gpt-5.4-nano", maxOutputTokens: 2000 },
  { feature: "leadAcquisitionSummary", stageId: 181446, backendModel: "gpt-5.4-nano", maxOutputTokens: 2000 },
  { feature: "leadTransactionSummary", stageId: 181447, backendModel: "gpt-5.4-nano", maxOutputTokens: 2000 },
  { feature: "leadDispoSummary", stageId: 181448, backendModel: "gpt-5.4-nano", maxOutputTokens: 2000 },
  { feature: "leadScore", stageId: 181451, backendModel: "gpt-5.4-nano", maxOutputTokens: 2000 },
  { feature: "leadScoreUc", stageId: 181453, backendModel: "gpt-5.4-nano", maxOutputTokens: 2000 },
  { feature: "objectionPreparation", stageId: 181454, backendModel: "gpt-5.4-nano", maxOutputTokens: 2000 },
  { feature: "openingAngle", stageId: 181455, backendModel: "gpt-5.4-nano", maxOutputTokens: 2000 },
  { feature: "preCallBrief", stageId: 181456, backendModel: "gpt-5.4-nano", maxOutputTokens: 2000 },
  { feature: "brainAi", stageId: 181457, backendModel: "gpt-5.4-nano", maxOutputTokens: 2000 },
  { feature: "sellerPsychology", stageId: 181458, backendModel: "gpt-5.4-nano", maxOutputTokens: 2000 },
  { feature: "smsAssist", stageId: 181459, backendModel: "gpt-5.4-nano", maxOutputTokens: 600 },
  { feature: "voicemailScript", stageId: 181461, backendModel: "gpt-5.4-nano", maxOutputTokens: 2000 },
  { feature: "smsIntentClassifier", stageId: 183449, backendModel: "gpt-5.4-nano", maxOutputTokens: 600 },
  { feature: "inboundCallIntentClassifier", stageId: 183457, backendModel: "gpt-5.4-nano", maxOutputTokens: 600 },
  { feature: "incomingCallClassifier", stageId: 182955, backendModel: "gpt-5.4-nano", maxOutputTokens: 1800 },
  { feature: "outboundCallClassifier", stageId: 182957, backendModel: "gpt-5.4-nano", maxOutputTokens: 2000 },
  { feature: "vendorAiSummary", stageId: 187824, backendModel: "gpt-5.4-mini", maxOutputTokens: 400 },
  { feature: "agentAiSummary", stageId: 187822, backendModel: "gpt-5.4-mini", maxOutputTokens: 400 },
  { feature: "inventoryAiSummary", stageId: 187060, backendModel: "gpt-5.4-nano", maxOutputTokens: 2000 },
  { feature: "soldAiSummary", stageId: 187064, backendModel: "gpt-5.4-nano", maxOutputTokens: 2000 },
  { feature: "rentalAiSummary", stageId: 187063, backendModel: "gpt-5.4-nano", maxOutputTokens: 2000 },
  { feature: "chatComp", stageId: 190149, backendModel: "gpt-5.4-nano", maxOutputTokens: 2000 },
  { feature: "fillSubjectFromCRM", stageId: 190150, backendModel: "gpt-5.4-mini", maxOutputTokens: 700 },
  { feature: "leadNextStep", stageId: 190151, backendModel: "gpt-5.4-mini", maxOutputTokens: 200 },
  { feature: "letAiPickComps", stageId: 190152, backendModel: "gpt-5.4-nano", maxOutputTokens: 700 },
  { feature: "repairCategorization", stageId: 190153, backendModel: "gpt-5.4-nano", maxOutputTokens: 700 },
  { feature: "suggestMao", stageId: 190156, backendModel: "gpt-5.4-nano", maxOutputTokens: 400 },
  { feature: "enrichLeadBrain", stageId: 190462, backendModel: "gpt-5.4-mini", maxOutputTokens: 600 },
] as const;

export function promptLayerApiKey(): string | null {
  return process.env[PROMPTLAYER_KEY_ENV] || null;
}

type CacheRow<T> = { value: T; fetchedAt: number };

async function readCache<T>(key: string): Promise<CacheRow<T> | null> {
  try {
    const db = await getDb();
    const result = await db.execute({
      sql: `SELECT payload, fetched_at FROM promptlayer_cache WHERE cache_key = ?`,
      args: [key],
    });
    const row = result.rows[0];
    if (!row) return null;
    return { value: JSON.parse(String(row.payload)) as T, fetchedAt: Number(row.fetched_at) };
  } catch {
    return null;
  }
}

async function writeCache(key: string, value: unknown, fetchedAt: number): Promise<void> {
  const db = await getDb();
  await db.execute({
    sql: `INSERT INTO promptlayer_cache (cache_key, payload, fetched_at) VALUES (?, ?, ?)
          ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`,
    args: [key, JSON.stringify(value), fetchedAt],
  });
}

async function promptLayerJson<T>(path: string, key: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "X-API-KEY": key,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = (await response.json()) as { success?: boolean; message?: string; error?: string } & T;
  if (!response.ok || body.success === false) {
    throw new Error(body.message || body.error || `PromptLayer ${response.status}`);
  }
  return body;
}

type AnalyticsPayload = Omit<
  PromptLayerCostReport,
  "workspace" | "requestedFromDay" | "analyticsStartDay" | "templates" | "history"
>;

type AnalyticsResponse = {
  totalCost?: number;
  totalRequests?: number;
  totalCachedTokens?: number;
  totalThinkingTokens?: number;
  stats?: Array<{
    date?: string | number;
    requests?: number;
    inputTokens?: number;
    outputTokens?: number;
    cachedTokens?: number;
    thinkingTokens?: number;
    cost?: number;
  }>;
  mostUsedModels?: Array<[string, number]>;
  promptBreakdown?: Array<{ promptId?: string; promptName?: string; requests?: number; cost?: number; tokens?: number }>;
  providerBreakdown?: Array<{
    provider?: string;
    inputTokens?: number;
    outputTokens?: number;
    cost?: number;
    requests?: number;
  }>;
};

type ChartResponse = {
  customCharts?: Array<{ id?: string; data?: Array<{ label?: string; value?: number }> }>;
};

const finite = (value: unknown): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

function dayOf(value: string | number | undefined): string | null {
  if (value == null) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(Number(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function chartMap(response: ChartResponse, id: string): Map<string, number> {
  const chart = response.customCharts?.find((item) => item.id === id);
  return new Map((chart?.data ?? []).map((item) => [String(item.label ?? ""), finite(item.value)]));
}

async function fetchAnalytics(range: DayRange, key: string): Promise<AnalyticsPayload> {
  const observedFromDay = range.from < PROMPTLAYER_ANALYTICS_START ? PROMPTLAYER_ANALYTICS_START : range.from;
  const now = Date.now();
  if (range.to < observedFromDay) {
    return {
      observedFromDay,
      toDay: range.to,
      fetchedAt: now,
      stale: false,
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      thinkingTokens: 0,
      cents: 0,
      daily: [],
      models: [],
      prompts: [],
      warning: `PromptLayer analytics for this workspace starts ${PROMPTLAYER_ANALYTICS_START}.`,
    };
  }

  const filter_group = {
    logic: "AND",
    filters: [
      {
        field: "request_start_time",
        operator: "between",
        value: [`${observedFromDay}T00:00:00Z`, `${addDays(range.to, 1)}T00:00:00Z`],
      },
    ],
  };
  const customCharts = [
    { id: "cost", title: "Cost by model", chartType: "bar", metric: "sum", metricField: "cost", groupByField: "engine", limit: 30 },
    { id: "input", title: "Input by model", chartType: "bar", metric: "sum", metricField: "input_tokens", groupByField: "engine", limit: 30 },
    { id: "output", title: "Output by model", chartType: "bar", metric: "sum", metricField: "output_tokens", groupByField: "engine", limit: 30 },
  ];

  const [analytics, charts] = await Promise.all([
    promptLayerJson<AnalyticsResponse>("/api/public/v2/requests/analytics", key, {
      method: "POST",
      body: JSON.stringify({ filter_group }),
    }),
    promptLayerJson<ChartResponse>("/api/public/v2/requests/analytics/custom-analytics", key, {
      method: "POST",
      body: JSON.stringify({ filter_group, customCharts }),
    }),
  ]);

  const provider = analytics.providerBreakdown?.find((row) => row.provider === "openai") ?? analytics.providerBreakdown?.[0];
  const requestMap = new Map((analytics.mostUsedModels ?? []).map(([model, requests]) => [model, finite(requests)]));
  const costMap = chartMap(charts, "cost");
  const inputMap = chartMap(charts, "input");
  const outputMap = chartMap(charts, "output");
  const modelNames = new Set([...requestMap.keys(), ...costMap.keys(), ...inputMap.keys(), ...outputMap.keys()]);
  const models = [...modelNames]
    .filter(Boolean)
    .map((model) => ({
      model,
      requests: requestMap.get(model) ?? 0,
      inputTokens: inputMap.get(model) ?? 0,
      outputTokens: outputMap.get(model) ?? 0,
      cents: (costMap.get(model) ?? 0) * 100,
    }))
    .sort((a, b) => b.cents - a.cents || b.requests - a.requests);

  return {
    observedFromDay,
    toDay: range.to,
    fetchedAt: now,
    stale: false,
    requests: finite(analytics.totalRequests ?? provider?.requests),
    inputTokens: finite(provider?.inputTokens),
    outputTokens: finite(provider?.outputTokens),
    cachedTokens: finite(analytics.totalCachedTokens),
    thinkingTokens: finite(analytics.totalThinkingTokens),
    cents: finite(analytics.totalCost ?? provider?.cost) * 100,
    daily: (analytics.stats ?? [])
      .map((row) => ({
        day: dayOf(row.date),
        requests: finite(row.requests),
        inputTokens: finite(row.inputTokens),
        outputTokens: finite(row.outputTokens),
        cachedTokens: finite(row.cachedTokens),
        thinkingTokens: finite(row.thinkingTokens),
        cents: finite(row.cost) * 100,
      }))
      .filter((row): row is Omit<typeof row, "day"> & { day: string } => row.day != null),
    models,
    prompts: (analytics.promptBreakdown ?? [])
      .map((row) => ({
        templateId: String(row.promptId ?? "none"),
        name: row.promptName || "Unknown / unlinked",
        requests: finite(row.requests),
        tokens: finite(row.tokens),
        cents: finite(row.cost) * 100,
      }))
      .sort((a, b) => b.cents - a.cents || b.requests - a.requests),
    warning:
      range.from < PROMPTLAYER_ANALYTICS_START
        ? `Observed activity is available from ${PROMPTLAYER_ANALYTICS_START}; the earlier part of this range is not covered.`
        : null,
  };
}

type RawTemplate = {
  prompt_name?: string;
  version?: number;
  prompt_template?: {
    messages?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
};

async function fetchTemplates(key: string): Promise<PromptLayerTemplateEstimate[]> {
  const encoding = getEncoding("o200k_base");
  const estimates: PromptLayerTemplateEstimate[] = [];
  for (let offset = 0; offset < TEMPLATE_SPECS.length; offset += 8) {
    const batch = TEMPLATE_SPECS.slice(offset, offset + 8);
    estimates.push(
      ...(await Promise.all(
        batch.map(async (spec): Promise<PromptLayerTemplateEstimate> => {
          try {
            const template = await promptLayerJson<RawTemplate>(
              `/prompt-templates/${spec.stageId}?include_llm_kwargs=true`,
              key
            );
            // The backend promptBuilder deliberately uses the first message's
            // text only, so count the same bytes instead of every editor message.
            const text = (template.prompt_template?.messages?.[0]?.content ?? [])
              .filter((block) => block.type === "text" && typeof block.text === "string")
              .map((block) => block.text ?? "")
              .join("\n");
            const staticInputTokens = encoding.encode(text).length;
            const rate = modelRate(spec.backendModel);
            return {
              templateId: String(spec.stageId),
              feature: spec.feature,
              name: template.prompt_name || spec.feature,
              version: template.version ?? null,
              model: spec.backendModel,
              staticInputTokens,
              maxOutputTokens: spec.maxOutputTokens,
              // Static prompt input only: runtime fields and all output are
              // excluded, making this an honest floor rather than a forecast.
              lowerBoundCents: rate ? (staticInputTokens * rate.input * 100) / 1_000_000 : null,
              error: null,
            };
          } catch (error) {
            return {
              templateId: String(spec.stageId),
              feature: spec.feature,
              name: spec.feature,
              version: null,
              model: spec.backendModel,
              staticInputTokens: 0,
              maxOutputTokens: spec.maxOutputTokens,
              lowerBoundCents: null,
              error: error instanceof Error ? error.message : "Template fetch failed",
            };
          }
        })
      ))
    );
  }
  return estimates.sort((a, b) => b.staticInputTokens - a.staticInputTokens || a.name.localeCompare(b.name));
}

async function cachedAnalytics(range: DayRange, key: string): Promise<AnalyticsPayload> {
  const cacheKey = `analytics:${range.from}:${range.to}`;
  const cached = await readCache<AnalyticsPayload>(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < ANALYTICS_TTL_MS) return cached.value;
  try {
    const value = await fetchAnalytics(range, key);
    await writeCache(cacheKey, value, value.fetchedAt).catch(() => undefined);
    return value;
  } catch (error) {
    if (cached) {
      return {
        ...cached.value,
        stale: true,
        warning: `Showing cached PromptLayer activity. ${error instanceof Error ? error.message : "Refresh failed."}`,
      };
    }
    const observedFromDay = range.from < PROMPTLAYER_ANALYTICS_START ? PROMPTLAYER_ANALYTICS_START : range.from;
    return {
      observedFromDay,
      toDay: range.to,
      fetchedAt: Date.now(),
      stale: true,
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      thinkingTokens: 0,
      cents: 0,
      daily: [],
      models: [],
      prompts: [],
      warning: error instanceof Error ? error.message : "PromptLayer analytics failed.",
    };
  }
}

async function cachedTemplates(key: string): Promise<{ templates: PromptLayerTemplateEstimate[]; stale: boolean; warning: string | null }> {
  const cacheKey = "templates:stage-review";
  const cached = await readCache<PromptLayerTemplateEstimate[]>(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < TEMPLATES_TTL_MS) {
    return { templates: cached.value, stale: false, warning: null };
  }
  try {
    const templates = await fetchTemplates(key);
    const now = Date.now();
    await writeCache(cacheKey, templates, now).catch(() => undefined);
    return { templates, stale: false, warning: null };
  } catch (error) {
    if (cached) {
      return {
        templates: cached.value,
        stale: true,
        warning: `Template estimates are cached. ${error instanceof Error ? error.message : "Refresh failed."}`,
      };
    }
    return {
      templates: [],
      stale: true,
      warning: error instanceof Error ? error.message : "PromptLayer templates failed.",
    };
  }
}

export async function getPromptLayerCostReport(range: DayRange): Promise<PromptLayerCostReport> {
  const key = promptLayerApiKey();
  if (!key) throw new Error(`${PROMPTLAYER_KEY_ENV} is not set`);
  const [analytics, templateResult] = await Promise.all([cachedAnalytics(range, key), cachedTemplates(key)]);
  let history: PromptLayerCostReport["history"] = null;
  if (analytics.requests === 0 && range.from > PROMPTLAYER_ANALYTICS_START && range.to >= PROMPTLAYER_ANALYTICS_START) {
    const allObserved = await cachedAnalytics({ from: PROMPTLAYER_ANALYTICS_START, to: range.to }, key);
    const activeDays = allObserved.daily.filter((row) => row.requests > 0);
    if (allObserved.requests > 0 && activeDays.length > 0) {
      history = {
        fromDay: activeDays[0].day,
        toDay: activeDays[activeDays.length - 1].day,
        requests: allObserved.requests,
        inputTokens: allObserved.inputTokens,
        outputTokens: allObserved.outputTokens,
        cents: allObserved.cents,
      };
    }
  }
  return {
    workspace: "stage",
    requestedFromDay: range.from,
    analyticsStartDay: PROMPTLAYER_ANALYTICS_START,
    ...analytics,
    stale: analytics.stale || templateResult.stale,
    templates: templateResult.templates,
    history,
    warning: [analytics.warning, templateResult.warning].filter(Boolean).join(" ") || null,
  };
}
