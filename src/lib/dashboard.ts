// Shared analytics-dashboard helpers: 7-day cycle math, grade bands, formatters,
// KPI stats, trend bucketing, and the constants (targets / granularities /
// filter keys) used by both the dashboard client pages and the API routes.
//
// Ported from the Lovable "Call Grader Insights" grading.ts + dashboard route,
// with all cycle/bucket math reimplemented on native `Date` (no date-fns) and
// the grade-good/warn/bad + callout semantics mapped onto our zinc/blue theme.
// NOT `server-only` — imported by client components too.

import {
  DEFAULT_TRACKING_START_DATE,
} from "./graderRubric";

// ---------------------------------------------------------------------------
// Targets & thresholds (no magic numbers downstream)
// ---------------------------------------------------------------------------

/** North-star target for grade / % ≥ 80 / rep score. */
export const GRADE_TARGET = 80;
/** Grade band lower bound for "warn" (below this is "bad"). */
export const WARN_THRESHOLD = 50;
/** Calls shorter than this (seconds) are excluded from avg-duration. */
export const MIN_DURATION_SECONDS = 10;
/** Default "hide short calls" cutoff (seconds) for the calls table. */
export const SHORT_CALL_SECONDS = 30;
// Max calls loaded into a single dashboard window. Kept in step with the
// trends query's GRADE_ROW_LIMIT (10k) so the KPI cards + counts cover the same
// full range the trend chart already does — a 1k cap silently under-counted
// wide custom ranges (e.g. 984/1473 graded). For volumes beyond this the right
// fix is server-side aggregate KPIs rather than a larger client payload.
export const CALLS_WINDOW_LIMIT = 10000;
/** Batch size for the JSON export server fetch. */
export const EXPORT_BATCH = 100;

// ---------------------------------------------------------------------------
// 7-day cycle math (anchored at app_config.tracking_start_date)
// ---------------------------------------------------------------------------

export const FALLBACK_CYCLE_ANCHOR = new Date(
  `${DEFAULT_TRACKING_START_DATE}T00:00:00.000Z`
);
export const CYCLE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
export const CYCLE_MS = CYCLE_DAYS * DAY_MS;
// Dashboard labels are rendered during SSR and then hydrated in the browser.
// Never use the runtime-default locale here: a server using en-GB ("7 Aug")
// and a browser using en-US ("Aug 7") produce different HTML and trigger a
// hydration recovery. Keep the display locale explicit across both runtimes.
export const DASHBOARD_DISPLAY_LOCALE = "en-US";

export interface Cycle {
  index: number; // 0 = first cycle starting at anchor
  start: Date;
  end: Date; // exclusive
  label: string;
}

/** Parse a tracking_start_date value (YYYY-MM-DD or full ISO) to a Date. */
export function parseTrackingStart(v: unknown): Date {
  if (typeof v === "string" && v) {
    const d = new Date(v.length === 10 ? `${v}T00:00:00.000Z` : v);
    if (!isNaN(d.getTime())) return d;
  }
  return FALLBACK_CYCLE_ANCHOR;
}

export function cycleForDate(d: Date, anchor: Date = FALLBACK_CYCLE_ANCHOR): Cycle {
  const diff = d.getTime() - anchor.getTime();
  const index = Math.max(0, Math.floor(diff / CYCLE_MS));
  return cycleByIndex(index, anchor);
}

export function cycleByIndex(index: number, anchor: Date = FALLBACK_CYCLE_ANCHOR): Cycle {
  const start = new Date(anchor.getTime() + index * CYCLE_MS);
  const end = new Date(start.getTime() + CYCLE_MS);
  return {
    index,
    start,
    end,
    label: `Cycle ${index + 1}: ${fmtDate(start)} – ${fmtDate(
      new Date(end.getTime() - DAY_MS)
    )}`,
  };
}

export function currentCycle(anchor: Date = FALLBACK_CYCLE_ANCHOR): Cycle {
  return cycleForDate(new Date(), anchor);
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

export function fmtDate(d: Date): string {
  return d.toLocaleDateString(DASHBOARD_DISPLAY_LOCALE, {
    month: "short",
    day: "numeric",
  });
}

/** Format a timestamp (Date | ISO string | epoch ms) as "Mon d, h:mm AM". */
export function fmtDateTime(d: Date | string | number): string {
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleString(DASHBOARD_DISPLAY_LOCALE, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Format a whole-second duration as "m:ss" (padded); "—" when null. */
export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Like fmtDuration but rounds fractional seconds — used for averages/axes. */
export function fmtSeconds(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Grade bands — mapped onto OUR zinc/blue theme (green / amber / red + callout)
// ---------------------------------------------------------------------------

export type GradeBand = "good" | "warn" | "bad" | "none";

export function gradeBand(grade: number | null | undefined): GradeBand {
  if (grade == null) return "none";
  if (grade >= GRADE_TARGET) return "good";
  if (grade >= WARN_THRESHOLD) return "warn";
  return "bad";
}

/** Semantic badge classes for a grade band, in our zinc/blue theme palette. */
export function gradeBandClasses(band: GradeBand): string {
  switch (band) {
    case "good":
      return "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400";
    case "warn":
      return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400";
    case "bad":
      return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400";
    default:
      return "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400";
  }
}

/** Text colour for a delta trend (up = good, down = bad), in our palette. */
export const GOOD_TEXT = "text-green-600 dark:text-green-400";
export const BAD_TEXT = "text-red-600 dark:text-red-400";

// Callout accent (AI-detected) — amber, distinct from the pass/fail greens/reds.
export const CALLOUT_TEXT = "text-amber-600 dark:text-amber-400";
export const CALLOUT_BADGE =
  "bg-amber-500 text-white dark:bg-amber-600";
export const CALLOUT_CARD =
  "border-amber-300 dark:border-amber-800/60 bg-amber-50/60 dark:bg-amber-950/20";

// Recharts stroke colours (concrete values — recharts can't read Tailwind classes).
export const CHART_PRIMARY = "#2563eb"; // blue-600
export const CHART_CALLOUT = "#d97706"; // amber-600
export const CHART_GRID = "#e4e4e7"; // zinc-200
export const CHART_AXIS = "#a1a1aa"; // zinc-400
export const CHART_REF = "#a1a1aa"; // zinc-400

// ---------------------------------------------------------------------------
// KPI stats (exact parity with Lovable computeStats)
// ---------------------------------------------------------------------------

export interface DashCallGrade {
  grade: number | null;
  applicable_count: number;
  passed_count: number;
  results: Record<string, { applicable: boolean; violated?: boolean; passed?: boolean; evidence: string }>;
  ai_callout: boolean;
  rep_score: number | null;
  rep_scorecard: Record<string, { applicable: boolean; score: number | null; evidence: string }>;
}

export interface DashCall {
  id: string;
  retell_call_id: string;
  timestamp: number | null; // epoch ms
  duration_seconds: number | null;
  phone_number: string | null;
  agent_name: string | null;
  agent_version: string | null;
  voice_id: string | null;
  voice_name: string | null;
  recording_url: string | null;
  appointment_booked: boolean | null;
  call_grades: DashCallGrade | null;
}

export interface Stats {
  total: number;
  gradedCount: number;
  avgGrade: number | null;
  pctAtTarget: number | null;
  pctAiCallout: number | null;
  repGradedCount: number;
  avgRepScore: number | null;
  repPctAtTarget: number | null;
  durationCount: number;
  avgDuration: number | null;
}

export function computeStats(calls: DashCall[]): Stats {
  const total = calls.length;
  let graded = 0,
    sum = 0,
    atTarget = 0,
    callout = 0;
  let repGraded = 0,
    repSum = 0,
    repAtTarget = 0;
  let durCount = 0,
    durSum = 0;
  for (const c of calls) {
    const g = c.call_grades?.grade;
    if (g != null) {
      graded += 1;
      sum += Number(g);
      if (Number(g) >= GRADE_TARGET) atTarget += 1;
    }
    const rs = c.call_grades?.rep_score;
    if (rs != null) {
      repGraded += 1;
      repSum += Number(rs);
      if (Number(rs) >= GRADE_TARGET) repAtTarget += 1;
    }
    if (c.call_grades?.ai_callout) callout += 1;
    const d = c.duration_seconds;
    if (d != null && d >= MIN_DURATION_SECONDS) {
      durCount += 1;
      durSum += d;
    }
  }
  return {
    total,
    gradedCount: graded,
    avgGrade: graded ? sum / graded : null,
    pctAtTarget: graded ? (atTarget / graded) * 100 : null,
    pctAiCallout: total ? (callout / total) * 100 : null,
    repGradedCount: repGraded,
    avgRepScore: repGraded ? repSum / repGraded : null,
    repPctAtTarget: repGraded ? (repAtTarget / repGraded) * 100 : null,
    durationCount: durCount,
    avgDuration: durCount ? durSum / durCount : null,
  };
}

export function deltaOf(now: number | null, prev: number | null): number | null {
  if (now == null || prev == null) return null;
  return now - prev;
}

// ---------------------------------------------------------------------------
// Filter keys / options (no magic strings in the pages)
// ---------------------------------------------------------------------------

export const DATE_PRESETS = ["today", "this_cycle", "last_cycle", "custom"] as const;
export type Preset = (typeof DATE_PRESETS)[number];

export const BAND_FILTERS = ["all", "good", "warn", "bad"] as const;
export const CALLOUT_FILTERS = ["all", "yes", "no"] as const;

// ---------------------------------------------------------------------------
// Trends — granularity buckets (native Date)
// ---------------------------------------------------------------------------

export const GRANULARITIES = ["day", "week", "month", "quarter"] as const;
export type Granularity = (typeof GRANULARITIES)[number];

export function periodStart(d: Date, g: Granularity): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  if (g === "day") return x;
  if (g === "week") {
    const day = x.getDay(); // 0 = Sun
    const diff = (day + 6) % 7; // week starts Monday
    x.setDate(x.getDate() - diff);
    return x;
  }
  if (g === "month") return new Date(x.getFullYear(), x.getMonth(), 1);
  const qMonth = Math.floor(x.getMonth() / 3) * 3; // quarter
  return new Date(x.getFullYear(), qMonth, 1);
}

export function periodNext(d: Date, g: Granularity): Date {
  const x = new Date(d);
  if (g === "day") x.setDate(x.getDate() + 1);
  else if (g === "week") x.setDate(x.getDate() + 7);
  else if (g === "month") x.setMonth(x.getMonth() + 1);
  else x.setMonth(x.getMonth() + 3);
  return x;
}

export function periodLabel(d: Date, g: Granularity): string {
  if (g === "day") return d.toLocaleDateString(DASHBOARD_DISPLAY_LOCALE, { month: "short", day: "numeric" });
  if (g === "week") return `Wk ${fmtDate(d)}`;
  if (g === "month") return d.toLocaleDateString(DASHBOARD_DISPLAY_LOCALE, { month: "short", year: "2-digit" });
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `Q${q} ${String(d.getFullYear()).slice(2)}`;
}

export interface TrendGradeRow {
  grade: number | null;
  rep_score: number | null;
  ai_callout: boolean;
  timestamp: number; // epoch ms of the parent call
}
export interface TrendDurationRow {
  timestamp: number; // epoch ms
  duration_seconds: number;
}

export interface TrendPoint {
  key: string;
  label: string;
  avgGrade: number | null;
  pctAtTarget: number | null;
  avgRepScore: number | null;
  pctAiCallout: number | null;
  avgDuration: number | null;
}

/** Bucket grade + duration rows into trend points at the chosen granularity. */
export function buildTrendPoints(
  gradeRows: TrendGradeRow[],
  durationRows: TrendDurationRow[],
  anchor: Date,
  granularity: Granularity
): TrendPoint[] {
  const now = new Date();
  const startAnchor = periodStart(anchor, granularity);
  type Bucket = { start: Date; g: number[]; r: number[]; ai: number; total: number; d: number[] };
  const buckets = new Map<string, Bucket>();
  const order: string[] = [];
  for (
    let cur = new Date(startAnchor);
    cur.getTime() <= now.getTime();
    cur = periodNext(cur, granularity)
  ) {
    const key = cur.toISOString();
    buckets.set(key, { start: new Date(cur), g: [], r: [], ai: 0, total: 0, d: [] });
    order.push(key);
  }
  const bucketFor = (ts: Date): Bucket | undefined => {
    const start = periodStart(ts, granularity);
    if (start.getTime() < startAnchor.getTime()) return undefined;
    return buckets.get(start.toISOString());
  };
  for (const row of gradeRows) {
    const b = bucketFor(new Date(row.timestamp));
    if (!b) continue;
    b.total += 1;
    if (row.grade != null) b.g.push(Number(row.grade));
    if (row.rep_score != null) b.r.push(Number(row.rep_score));
    if (row.ai_callout) b.ai += 1;
  }
  for (const row of durationRows) {
    if (row.duration_seconds == null) continue;
    const b = bucketFor(new Date(row.timestamp));
    if (!b) continue;
    b.d.push(row.duration_seconds);
  }
  const out: TrendPoint[] = [];
  for (const key of order) {
    const b = buckets.get(key)!;
    const hasG = b.g.length > 0;
    const hasR = b.r.length > 0;
    const hasT = b.total > 0;
    const hasD = b.d.length > 0;
    out.push({
      key,
      label: periodLabel(b.start, granularity),
      avgGrade: hasG ? b.g.reduce((a, x) => a + x, 0) / b.g.length : null,
      pctAtTarget: hasG ? (b.g.filter((x) => x >= GRADE_TARGET).length / b.g.length) * 100 : null,
      avgRepScore: hasR ? b.r.reduce((a, x) => a + x, 0) / b.r.length : null,
      pctAiCallout: hasT ? (b.ai / b.total) * 100 : null,
      avgDuration: hasD ? b.d.reduce((a, x) => a + x, 0) / b.d.length : null,
    });
  }
  return out;
}
