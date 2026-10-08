// Shared cost-dashboard helpers: the report shape returned by /api/costs, the
// reporting-timezone day math, timeline presets, the day → week/month roll-up,
// product labels and formatters. NOT `server-only` — the /costs page imports
// it too.
//
// All money is Retell's own unit, CENTS (call_cost.combined_cost), until it
// is formatted for display. Twilio telephony is billed outside Retell and is
// not included anywhere here.
//
// Every "day" is a calendar day in COST_TIMEZONE, written YYYY-MM-DD. The sync
// assigns each call its day once (DST-correct, via Intl), the daily roll-ups
// are keyed by it, and the page's presets are computed in it — so every viewer
// sees the same numbers for "Sep 30" wherever they are.

import { DASHBOARD_DISPLAY_LOCALE } from "./dashboard";
import { WORKSPACES, WORKSPACE_META, type Workspace } from "./workspace";

// History the sync keeps. The backfill walks back to this date on first run;
// `scripts/backfill-costs.ts --since` can extend it further.
export const COST_HISTORY_START = "2026-01-01";

/** Reporting timezone: a US business day, like ReSimpli's own. */
export const COST_TIMEZONE = "America/Chicago";
export const COST_TIMEZONE_LABEL = "US Central";

/** Individual call rows older than this are pruned; daily roll-ups are kept forever. */
export const RAW_RETENTION_DAYS = 365;

// ---------------------------------------------------------------------------
// Day math (YYYY-MM-DD in COST_TIMEZONE)
// ---------------------------------------------------------------------------

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// en-CA formats as YYYY-MM-DD; the parts formatter recovers the wall clock.
const dayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: COST_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: COST_TIMEZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

export function isDay(v: unknown): v is string {
  return typeof v === "string" && DAY_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
}

/** The reporting-timezone day an instant falls on. */
export function costDayOf(ms: number): string {
  return dayFmt.format(ms);
}

/** Today in the reporting timezone. */
export function costToday(now = Date.now()): string {
  return costDayOf(now);
}

function utcOf(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

function dayFromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Calendar arithmetic on a day string (no timezone involved). */
export function addDays(day: string, n: number): string {
  return dayFromUtc(utcOf(day) + n * ONE_DAY_MS);
}

/** Inclusive day count from `from` to `to`. */
export function daysBetween(from: string, to: string): number {
  return Math.round((utcOf(to) - utcOf(from)) / ONE_DAY_MS) + 1;
}

// Offset (ms) of the reporting timezone from UTC at an instant.
function tzOffsetMs(ms: number): number {
  const p = Object.fromEntries(partsFmt.formatToParts(ms).map((x) => [x.type, x.value]));
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return wall - Math.floor(ms / 1000) * 1000;
}

/** Epoch ms of midnight starting `day` in the reporting timezone (DST-correct). */
export function costDayStartMs(day: string): number {
  const utcMidnight = utcOf(day);
  // Two passes: the offset at the guess can differ from the offset at midnight
  // on transition days. US transitions happen at 02:00, never at midnight.
  const guess = utcMidnight - tzOffsetMs(utcMidnight);
  return utcMidnight - tzOffsetMs(guess);
}

function mondayOf(day: string): string {
  const dow = new Date(utcOf(day)).getUTCDay(); // 0 = Sun
  return addDays(day, -((dow + 6) % 7));
}

function monthStartOf(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

// ---------------------------------------------------------------------------
// Report shape (GET /api/costs)
// ---------------------------------------------------------------------------

export interface CostDailyRow {
  day: string; // YYYY-MM-DD, reporting timezone
  workspace: Workspace;
  calls: number;
  cents: number;
  billedSec: number;
}

export interface CostAgentRow {
  workspace: Workspace;
  agentId: string;
  agentName: string | null;
  calls: number;
  connected: number; // call_status = ended
  billedSec: number;
  cents: number;
  // Duration stats cover connected calls only — a not_connected call is 0s and
  // would pin every minimum at zero.
  avgSec: number | null;
  minSec: number | null;
  maxSec: number | null;
  connectedSec: number;
}

export interface CostProductRow {
  workspace: Workspace;
  product: string;
  cents: number;
}

export interface CostPrevRow {
  workspace: Workspace;
  calls: number;
  cents: number;
}

export interface CostSyncState {
  workspace: Workspace;
  lastSyncAt: number | null;
  // Oldest start_ts the backfill has reached; data before it is missing.
  backfilledTo: number | null;
  backfillComplete: boolean;
}

// One entry per agent with calls in the window — always the UNFILTERED list,
// so the agent dropdown keeps its options while an agent is selected.
export interface CostAgentOption {
  workspace: Workspace;
  agentId: string;
  agentName: string | null;
  cents: number;
}

/** Agent filter as sent to /api/costs (`agent=<workspace>:<agentId>`). */
export interface CostAgentFilter {
  workspace: Workspace;
  agentId: string;
}

export function agentFilterKey(f: CostAgentFilter): string {
  return `${f.workspace}:${f.agentId}`;
}

export function parseAgentFilter(key: string | null | undefined): CostAgentFilter | null {
  if (!key) return null;
  const i = key.indexOf(":");
  if (i < 0) return null;
  const workspace = key.slice(0, i);
  if (!isCostWorkspace(workspace)) return null;
  return { workspace, agentId: key.slice(i + 1) };
}

export interface CostReport {
  fromDay: string; // inclusive
  toDay: string; // inclusive
  today: string;
  // Comparison window: the same number of days immediately before. When the
  // range ends today, its last day is cut at the current time of day so a
  // partial today is compared with an equally partial day.
  prevFromDay: string;
  prevToDay: string;
  prevPartial: boolean;
  agent: CostAgentFilter | null;
  agentOptions: CostAgentOption[];
  daily: CostDailyRow[];
  agents: CostAgentRow[];
  products: CostProductRow[];
  previous: CostPrevRow[];
  sync: CostSyncState[];
}

// ---------------------------------------------------------------------------
// Timeline presets (reporting-timezone days, both ends inclusive)
// ---------------------------------------------------------------------------

export const COST_PRESETS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "last_7", label: "Last 7 days" },
  { key: "last_30", label: "Last 30 days" },
  { key: "this_week", label: "This week" },
  { key: "last_week", label: "Last week" },
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "last_90", label: "Last 90 days" },
  { key: "this_year", label: "This year" },
  { key: "custom", label: "Custom range" },
] as const;
export type CostPreset = (typeof COST_PRESETS)[number]["key"];
export const DEFAULT_COST_PRESET: CostPreset = "last_30";

export interface DayRange {
  from: string;
  to: string;
}

export function presetRange(preset: CostPreset, today: string, custom?: Partial<DayRange>): DayRange {
  const week = mondayOf(today);
  const month = monthStartOf(today);
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday":
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case "last_7":
      return { from: addDays(today, -6), to: today };
    case "last_30":
      return { from: addDays(today, -29), to: today };
    case "this_week":
      return { from: week, to: today };
    case "last_week":
      return { from: addDays(week, -7), to: addDays(week, -1) };
    case "this_month":
      return { from: month, to: today };
    case "last_month":
      return { from: monthStartOf(addDays(month, -1)), to: addDays(month, -1) };
    case "last_90":
      return { from: addDays(today, -89), to: today };
    case "this_year":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case "custom":
      return {
        from: isDay(custom?.from) ? custom.from : addDays(today, -29),
        to: isDay(custom?.to) ? custom.to : today,
      };
  }
}

// ---------------------------------------------------------------------------
// Granularity (day / week / month roll-up of the daily rows)
// ---------------------------------------------------------------------------

export const COST_GRANULARITIES = ["day", "week", "month"] as const;
export type CostGranularity = (typeof COST_GRANULARITIES)[number];

/** Sensible default bucket for a window: daily up to a month, then weekly, then monthly. */
export function defaultGranularity(range: DayRange): CostGranularity {
  const days = daysBetween(range.from, range.to);
  if (days <= 31) return "day";
  if (days <= 120) return "week";
  return "month";
}

/** One day of spend for one chart series (a workspace, an OpenAI project…). */
export interface TrendRow {
  day: string;
  series: string;
  cents: number;
  count: number; // calls / requests
}

export interface CostTrendPoint {
  key: string;
  label: string;
  total: number; // cents across the shown series
  count: number;
  bySeries: Record<string, number>; // cents
}

function bucketStart(day: string, g: CostGranularity): string {
  if (g === "week") return mondayOf(day);
  if (g === "month") return monthStartOf(day);
  return day;
}

function bucketNext(start: string, g: CostGranularity): string {
  if (g === "day") return addDays(start, 1);
  if (g === "week") return addDays(start, 7);
  return monthStartOf(addDays(start, 31));
}

/**
 * Axis/tooltip label for a bucket. Months carry the full year ("Sep 2026") so
 * they can't be misread as a day ("Sep 26"); weeks are named by their Monday.
 */
export function costPeriodLabel(start: string, g: CostGranularity): string {
  const d = new Date(utcOf(start));
  const opts: Intl.DateTimeFormatOptions =
    g === "month" ? { month: "short", year: "numeric", timeZone: "UTC" } : { month: "short", day: "numeric", timeZone: "UTC" };
  const label = d.toLocaleDateString(DASHBOARD_DISPLAY_LOCALE, opts);
  return g === "week" ? `Week of ${label}` : label;
}

/**
 * Bucket daily rows at the chosen granularity, emitting every bucket in the
 * window (zero-filled) so gaps read as "no spend" rather than vanishing.
 */
export function buildCostTrend(
  rows: TrendRow[],
  range: DayRange,
  granularity: CostGranularity,
  series: readonly string[]
): CostTrendPoint[] {
  const points = new Map<string, CostTrendPoint>();
  for (let cur = bucketStart(range.from, granularity); cur <= range.to; cur = bucketNext(cur, granularity)) {
    points.set(cur, { key: cur, label: costPeriodLabel(cur, granularity), total: 0, count: 0, bySeries: {} });
  }
  const shown = new Set(series);
  for (const row of rows) {
    if (!shown.has(row.series)) continue;
    const p = points.get(bucketStart(row.day, granularity));
    if (!p) continue;
    p.total += row.cents;
    p.count += row.count;
    p.bySeries[row.series] = (p.bySeries[row.series] ?? 0) + row.cents;
  }
  return [...points.values()];
}

/** A chart series: its key in the trend rows, legend label and colour. */
export interface ChartSeries {
  key: string;
  label: string;
  color: string;
}

export function workspaceSeries(workspaces: readonly Workspace[]): ChartSeries[] {
  return workspaces.map((ws) => ({ key: ws, label: workspaceLabel(ws), color: WORKSPACE_COLOR_VAR[ws] }));
}

/** "Sep 1 – Sep 30, 2026" for a day range. */
export function fmtDayRange(range: DayRange): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" };
  const a = new Date(utcOf(range.from)).toLocaleDateString(DASHBOARD_DISPLAY_LOCALE, opts);
  const b = new Date(utcOf(range.to)).toLocaleDateString(DASHBOARD_DISPLAY_LOCALE, opts);
  return a === b ? a : `${a} – ${b}`;
}

// ---------------------------------------------------------------------------
// Workspace ordering + colours
// ---------------------------------------------------------------------------

// Production accounts first (biggest spend), dev last. Each workspace keeps a
// fixed categorical slot so filtering never repaints the survivors; the hues
// live as CSS variables in globals.css so dark mode gets its own steps.
export const COST_WORKSPACES: readonly Workspace[] = ["outbound", "prod", "stl", "dev"];
export const WORKSPACE_COLOR_VAR: Record<Workspace, string> = {
  outbound: "var(--series-1)",
  prod: "var(--series-2)",
  stl: "var(--series-3)",
  dev: "var(--series-4)",
};

export function workspaceLabel(ws: Workspace): string {
  return WORKSPACE_META[ws].label;
}

export function isCostWorkspace(v: string): v is Workspace {
  return (WORKSPACES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Products (Retell call_cost.product_costs[].product)
// ---------------------------------------------------------------------------

const PRODUCT_LABELS: Record<string, string> = {
  llm_token_surcharge: "LLM token surcharge",
  retell_voice_engine: "Retell voice engine",
  short_call_surcharge: "Short-call surcharge",
  background_voice_cancellation: "Background voice cancellation",
  knowledge_base_usage: "Knowledge base",
  guardrail: "Guardrail",
};

// Explanatory hints shown under the biggest line items.
export const PRODUCT_HINTS: Record<string, string> = {
  llm_token_surcharge: "Charged on large prompts — scales with prompt size and LLM turns per call.",
};

/** Human label for a Retell product key, e.g. gpt_5_4 → "LLM · GPT-5.4". */
export function productLabel(product: string): string {
  if (PRODUCT_LABELS[product]) return PRODUCT_LABELS[product];
  if (product.startsWith("elevenlabs_tts")) return "Voice · ElevenLabs TTS";
  if (product.startsWith("openai_tts") || product.startsWith("cartesia") || product.endsWith("_tts"))
    return `Voice · ${product.replace(/_/g, " ")}`;
  const gpt = product.match(/^gpt_(\d+)(?:_(\d+))?(.*)$/);
  if (gpt) {
    const ver = gpt[2] ? `${gpt[1]}.${gpt[2]}` : gpt[1];
    const rest = gpt[3].replace(/_/g, " ").trim();
    return `LLM · GPT-${ver}${rest ? ` (${rest})` : ""}`;
  }
  if (/^(claude|gemini)/.test(product)) return `LLM · ${product.replace(/_/g, " ")}`;
  return product.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

/** Cents → "$1,234" (≥ $100) or "$12.34". */
export function fmtUsd(cents: number | null | undefined, opts?: { precise?: boolean }): string {
  if (cents == null) return "—";
  const dollars = cents / 100;
  const digits = opts?.precise || Math.abs(dollars) < 100 ? 2 : 0;
  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Cents per billed minute → "$0.32". */
export function fmtPerMin(cents: number, billedSec: number): string {
  if (!billedSec) return "—";
  return fmtUsd(cents / (billedSec / 60), { precise: true });
}

export function fmtMinutes(seconds: number): string {
  return Math.round(seconds / 60).toLocaleString("en-US");
}

export function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
}

// ---------------------------------------------------------------------------
// OpenAI (GET /api/costs/openai) — organization Costs + Usage APIs
// ---------------------------------------------------------------------------
// OpenAI buckets by UTC day, so its days are UTC calendar days, compared
// against the same YYYY-MM-DD range strings as Retell's US Central days.

export interface OpenAiDailyRow {
  day: string; // YYYY-MM-DD, UTC
  projectId: string;
  cents: number;
  requests: number;
}

export interface OpenAiProjectRow {
  projectId: string; // '' = usage OpenAI attributes to no project
  name: string | null;
  archived: boolean;
  cents: number;
  allTimeCents: number; // colour order: stable across timeline changes
  requests: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
}

export interface OpenAiLineItemRow {
  projectId: string;
  lineItem: string; // e.g. "gpt-5.4-mini, input"
  cents: number;
}

export interface OpenAiKeyRow {
  projectId: string;
  apiKeyId: string; // '' = not attributed to a key
  apiKeyName: string | null;
  model: string;
  requests: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
}

export interface OpenAiCostReport {
  configured: boolean; // an Admin key, the backend audit log or PromptLayer is available
  // openai_admin   — OpenAI's own billing (Costs/Usage APIs); projects are OpenAI projects.
  // backend_audit  — the backend's AiAgentAudit token log × model rates; "projects" are features.
  // promptlayer    — PromptLayer's observed stage activity.
  source: "openai_admin" | "backend_audit" | "promptlayer" | "none";
  fromDay: string;
  toDay: string;
  lastSyncOkAt: number | null;
  lastError: string | null;
  earliestDay: string | null; // first day the sync has loaded
  daily: OpenAiDailyRow[];
  projects: OpenAiProjectRow[];
  lineItems: OpenAiLineItemRow[];
  keys: OpenAiKeyRow[];
  // Comparison on COMPLETE days only (today's UTC bucket is still filling):
  // `comparable` = this range's complete days, `previous` = the same number of
  // days right before. Per project so a project filter can reuse it.
  comparison: { days: number; byProject: { projectId: string; comparable: number; previous: number }[] } | null;
  promptLayer: PromptLayerCostReport | null;
  audit: AiAuditMeta | null; // set when source = backend_audit
}

/** Context for an estimate built from the backend's AiAgentAudit log. */
export interface AiAuditMeta {
  database: string; // which backend database was read, e.g. "stage_resimpli"
  unpricedModels: string[]; // models with calls but no rate below (tokens shown, $ excluded)
}

// ---------------------------------------------------------------------------
// Model rates (USD per 1M tokens) for token-based estimates
// ---------------------------------------------------------------------------
// The backend's models, at the effective standard rates PromptLayer priced
// this workspace's requests at (verified to floating-point precision on
// 2026-10-08). Matched by prefix, so dated snapshots ("gpt-5.4-nano-2026-03-17")
// resolve; longest prefix wins. Cached-input discounts aren't applied — the
// audit log doesn't record cached tokens — so estimates lean high.
export const AI_MODEL_RATES: readonly { prefix: string; input: number; output: number }[] = [
  { prefix: "gpt-5.4-mini", input: 0.75, output: 4.5 },
  { prefix: "gpt-5.4-nano", input: 0.2, output: 1.25 },
];

export function modelRate(model: string): { input: number; output: number } | null {
  let best: (typeof AI_MODEL_RATES)[number] | null = null;
  for (const r of AI_MODEL_RATES) {
    if (model.startsWith(r.prefix) && (!best || r.prefix.length > best.prefix.length)) best = r;
  }
  return best;
}

/** Estimated cents for a token count on a model, or null when the model has no rate. */
export function tokenCostCents(model: string, inputTokens: number, outputTokens: number): number | null {
  const r = modelRate(model);
  if (!r) return null;
  return ((inputTokens * r.input + outputTokens * r.output) * 100) / 1_000_000;
}

export interface PromptLayerDailyRow {
  day: string; // YYYY-MM-DD, UTC
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  thinkingTokens: number;
  cents: number;
}

export interface PromptLayerModelRow {
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cents: number;
}

export interface PromptLayerPromptRow {
  templateId: string;
  name: string;
  requests: number;
  tokens: number;
  cents: number;
}

export interface PromptLayerTemplateEstimate {
  templateId: string;
  feature: string;
  name: string;
  version: number | null;
  model: string;
  staticInputTokens: number;
  maxOutputTokens: number;
  lowerBoundCents: number | null;
  error: string | null;
}

/**
 * PromptLayer fallback for the OpenAI tab. Observed rows are exact for calls
 * logged in this PromptLayer workspace. Template estimates are deliberately a
 * lower bound: they count static instructions, not runtime CRM/transcript data.
 */
export interface PromptLayerCostReport {
  workspace: "stage";
  requestedFromDay: string;
  observedFromDay: string;
  toDay: string;
  analyticsStartDay: string;
  fetchedAt: number;
  stale: boolean;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  thinkingTokens: number;
  cents: number;
  daily: PromptLayerDailyRow[];
  models: PromptLayerModelRow[];
  prompts: PromptLayerPromptRow[];
  templates: PromptLayerTemplateEstimate[];
  history: {
    fromDay: string;
    toDay: string;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    cents: number;
  } | null;
  warning: string | null;
}

/** Split a Costs API line item ("gpt-5.4-mini, input") into model + charge kind. */
export function splitLineItem(lineItem: string): { model: string; kind: string } {
  const i = lineItem.lastIndexOf(",");
  return i < 0 ? { model: lineItem, kind: "" } : { model: lineItem.slice(0, i).trim(), kind: lineItem.slice(i + 1).trim() };
}

/** Today as a UTC day — the OpenAI side's "today". */
export function utcToday(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

// Projects get categorical slots 1–6 by all-time spend; the rest fold into
// "Other" so a chart never needs a generated 9th hue.
export const OPENAI_SERIES_SLOTS = 6;
export const SERIES_COLOR_VARS = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
];
export const OTHER_SERIES_COLOR = "var(--series-other)";
export const OTHER_SERIES_KEY = "__other__";

export function openAiProjectLabel(p: { projectId: string; name: string | null }): string {
  if (!p.projectId) return "No project";
  return p.name || p.projectId;
}
