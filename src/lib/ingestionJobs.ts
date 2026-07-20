import "server-only";
import { listCalls, listAgents } from "./retell";
import {
  setAppConfig,
  getAppConfig,
  upsertAgentVoice,
  backfillCallVoices,
  listUngradedCalls,
  countGradeableUngraded,
  type Call,
} from "./db";
import { APP_CONFIG_KEYS } from "./graderRubric";
import { MIN_DURATION_SECONDS } from "./dashboard";
import {
  getAgentAllowlist,
  getTrackingStartDate,
  ingestCall,
  displayVoiceName,
  retellCallId,
  type RetellCallPayload,
  type SkipReason,
} from "./ingestion";
import { gradeAndStoreCall } from "./grading";
import { BACKFILL_CURSOR_KEY, LAST_VOICE_SYNC_KEY } from "./automation";
import type { Workspace } from "./workspace";

// Workspace-scoped ingestion jobs — the core work behind the admin trigger
// routes AND the cron tick. Ports the client's backfill-calls / grade-pending /
// sync-agent-voices edge functions. Keeping the logic here (not in the route
// handlers) lets the cron loop reuse it directly without an HTTP hop or an admin
// session, while the routes stay thin (guard → call → JSON). DRY.

// ---------------------------------------------------------------------------
// Backfill
// ---------------------------------------------------------------------------
const BACKFILL_PAGE_SIZE = 100;
const MAX_CALLS_PER_INVOCATION = 200; // cap per run to stay under serverless timeouts
const BACKFILL_SOFT_DEADLINE_MS = 25_000; // stop starting new pages after ~25s

export interface BackfillCounters {
  fetched: number;
  ingested: number;
  graded: number;
  gradeErrors: number;
  failed: number;
  skipped: Record<SkipReason, number>;
}

export interface BackfillResult {
  ok: boolean;
  done: boolean;
  cursor: string | null;
  window?: { from: string; to: string };
  counters: BackfillCounters;
  error?: string;
}

function emptyBackfillCounters(): BackfillCounters {
  return {
    fetched: 0,
    ingested: 0,
    graded: 0,
    gradeErrors: 0,
    failed: 0,
    skipped: {
      missing_call_id: 0,
      agent_not_allowlisted: 0,
      not_inbound: 0,
      direction_missing: 0,
      before_tracking_start: 0,
      duration_too_short: 0,
      empty_transcript: 0,
    },
  };
}

async function fetchRetellPage(opts: {
  apiKey: string;
  agentIds: string[];
  fromMs: number;
  toMs: number;
  paginationKey?: string;
}): Promise<{ calls: RetellCallPayload[]; nextKey?: string }> {
  const filter_criteria: Record<string, unknown> = {
    start_timestamp: { lower_threshold: opts.fromMs, upper_threshold: opts.toMs },
  };
  if (opts.agentIds.length > 0) filter_criteria.agent_id = opts.agentIds;

  const data = await listCalls(
    {
      filter_criteria,
      sort_order: "descending",
      limit: BACKFILL_PAGE_SIZE,
      pagination_key: opts.paginationKey,
    },
    opts.apiKey
  );

  const calls: RetellCallPayload[] = Array.isArray(data)
    ? data
    : Array.isArray(data?.calls)
      ? data.calls
      : [];
  const explicit =
    data?.pagination_key ?? data?.next_pagination_key ?? data?.pagination?.next_cursor;
  const nextKey =
    typeof explicit === "string" && explicit
      ? explicit
      : calls.length === BACKFILL_PAGE_SIZE
        ? retellCallId(calls[calls.length - 1]) || undefined
        : undefined;
  return { calls, nextKey };
}

/**
 * Resumable Retell → Turso backfill for a workspace. Paginated list-calls with
 * the given key, same ingestion filters as the webhook, resumable cursor in
 * app_config.backfill_cursor, upsert + inline grade. Returns { done } — caller
 * loops until done.
 */
export async function runBackfill(opts: {
  workspace: Workspace;
  apiKey: string;
  reset?: boolean;
}): Promise<BackfillResult> {
  const { workspace, apiKey } = opts;
  const [allowlist, trackingStart] = await Promise.all([
    getAgentAllowlist(workspace),
    getTrackingStartDate(workspace),
  ]);
  if (!trackingStart) {
    return {
      ok: false,
      done: false,
      cursor: null,
      counters: emptyBackfillCounters(),
      error: "tracking_start_date not configured for this workspace",
    };
  }

  if (opts.reset) {
    await setAppConfig(workspace, BACKFILL_CURSOR_KEY, null);
    await setAppConfig(workspace, APP_CONFIG_KEYS.backfillComplete, false);
  }

  const cursorRaw = await getAppConfig<string>(workspace, BACKFILL_CURSOR_KEY);
  let paginationKey: string | undefined =
    !opts.reset && typeof cursorRaw === "string" && cursorRaw ? cursorRaw : undefined;

  const fromMs = trackingStart.getTime();
  const toMs = Date.now();
  const counters = emptyBackfillCounters();
  const startedAt = Date.now();
  let done = false;

  try {
    while (counters.fetched < MAX_CALLS_PER_INVOCATION) {
      if (Date.now() - startedAt > BACKFILL_SOFT_DEADLINE_MS) break;
      const page = await fetchRetellPage({ apiKey, agentIds: allowlist, fromMs, toMs, paginationKey });
      if (page.calls.length === 0) {
        done = true;
        break;
      }
      counters.fetched += page.calls.length;

      for (const call of page.calls) {
        const result = await ingestCall({
          workspace,
          call,
          allowlist,
          trackingStart,
          apiKey,
          rawPayload: { source: "backfill", call },
        });
        if (result.skip) {
          counters.skipped[result.skip] += 1;
          continue;
        }
        if (!result.callRowId) {
          counters.failed += 1;
          continue;
        }
        counters.ingested += 1;
        try {
          const grade = await gradeAndStoreCall(workspace, result.callRowId);
          if (grade?.error) counters.gradeErrors += 1;
          else counters.graded += 1;
        } catch (e) {
          counters.gradeErrors += 1;
          console.error("[backfill] grade failed", result.callRowId, e);
        }
      }

      if (!page.nextKey || page.nextKey === paginationKey) {
        done = true;
        break;
      }
      paginationKey = page.nextKey;
    }
  } catch (err) {
    await setAppConfig(workspace, BACKFILL_CURSOR_KEY, paginationKey ?? null);
    return {
      ok: false,
      done: false,
      cursor: paginationKey ?? null,
      counters,
      error: err instanceof Error ? err.message : "Backfill error",
    };
  }

  await setAppConfig(workspace, BACKFILL_CURSOR_KEY, done ? null : (paginationKey ?? null));
  if (done) await setAppConfig(workspace, APP_CONFIG_KEYS.backfillComplete, true);

  return {
    ok: true,
    done,
    cursor: done ? null : (paginationKey ?? null),
    window: { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() },
    counters,
  };
}

// ---------------------------------------------------------------------------
// Grade pending
// ---------------------------------------------------------------------------
const UNGRADED_SCAN_LIMIT = 1000;
const GRADE_BATCH_SIZE = 15;
const GRADE_CONCURRENCY = 3;

export interface GradePendingResult {
  ok: boolean;
  batch: number;
  graded: number;
  failed: number;
  failedIds: string[];
  remaining: number;
}

/** The eligible, still-ungraded calls in a workspace (capped at the scan limit). */
async function listEligibleUngraded(workspace: Workspace): Promise<Call[]> {
  const trackingStart = await getTrackingStartDate(workspace);
  const ungraded = await listUngradedCalls(workspace, UNGRADED_SCAN_LIMIT);
  return ungraded.filter((c) => isEligible(c, trackingStart));
}

/**
 * Count of gradeable ungraded calls across all time — the true backlog behind
 * the dashboard "Ungraded calls" stat. Unlike listEligibleUngraded (the grade
 * runner's view), this has no scan cap and no tracking-start window, so it
 * counts every ungraded call ever; it still honors the ≥MIN_DURATION_SECONDS
 * floor (the transcript check is redundant — ingestion never stores empty ones).
 */
export async function countPendingGrades(workspace: Workspace): Promise<number> {
  return countGradeableUngraded(workspace, MIN_DURATION_SECONDS);
}

/** Eligibility guard — mirrors ingestion filters so ungradeable rows drop out. */
function isEligible(call: Call, trackingStart: Date | null): boolean {
  if (call.duration_seconds != null && call.duration_seconds < MIN_DURATION_SECONDS) return false;
  const turns = Array.isArray(call.transcript) ? (call.transcript as { content?: unknown }[]) : [];
  const hasTranscript = turns.some(
    (t) => typeof t?.content === "string" && t.content.trim().length > 0
  );
  if (!hasTranscript) return false;
  if (trackingStart && call.timestamp != null && call.timestamp < trackingStart.getTime()) return false;
  return true;
}

async function runConcurrent<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  });
  await Promise.all(workers);
}

/**
 * Grade a bounded batch of ungraded, eligible calls in a workspace. Returns the
 * remaining eligible count so the caller can loop until 0. Graceful with an
 * empty OPENAI_API_KEY (each grade stores an error row, never throws).
 */
export async function runGradePending(workspace: Workspace): Promise<GradePendingResult> {
  const eligible = await listEligibleUngraded(workspace);
  const batch = eligible.slice(0, GRADE_BATCH_SIZE);

  let graded = 0;
  let failed = 0;
  const failedIds: string[] = [];

  await runConcurrent(batch, GRADE_CONCURRENCY, async (call) => {
    try {
      const result = await gradeAndStoreCall(workspace, call.id);
      if (result?.error) {
        failed += 1;
        failedIds.push(call.id);
      } else {
        graded += 1;
      }
    } catch (e) {
      failed += 1;
      failedIds.push(call.id);
      console.error("[grade-pending] grade failed", call.id, e);
    }
  });

  const remaining = Math.max(0, eligible.length - batch.length);
  return { ok: true, batch: batch.length, graded, failed, failedIds, remaining };
}

// ---------------------------------------------------------------------------
// Voice sync
// ---------------------------------------------------------------------------
export interface VoiceSyncResult {
  ok: boolean;
  agents_fetched: number;
  agents_upserted: number;
  calls_backfilled: number;
}

interface RetellAgent {
  agent_id?: string;
  voice_id?: string | null;
  agent_name?: string | null;
}

/**
 * Sync a workspace's Retell agents → agent_voices, then backfill missing
 * calls.voice_id / voice_name. Ports sync-agent-voices, workspace-scoped.
 */
export async function runVoiceSync(opts: {
  workspace: Workspace;
  apiKey: string;
}): Promise<VoiceSyncResult> {
  const { workspace, apiKey } = opts;
  const agents = (await listAgents(apiKey)) as RetellAgent[];
  const list = Array.isArray(agents) ? agents : [];

  const byId = new Map<string, RetellAgent>();
  for (const a of list) {
    if (a?.agent_id) byId.set(a.agent_id, a);
  }

  let upserted = 0;
  for (const a of byId.values()) {
    await upsertAgentVoice({
      workspace,
      agentId: a.agent_id!,
      voiceId: a.voice_id ?? null,
      voiceName: displayVoiceName(a.voice_id),
      agentName: a.agent_name ?? null,
    });
    upserted += 1;
  }

  const callsBackfilled = await backfillCallVoices(workspace);
  await setAppConfig(workspace, LAST_VOICE_SYNC_KEY, Date.now());

  return {
    ok: true,
    agents_fetched: list.length,
    agents_upserted: upserted,
    calls_backfilled: callsBackfilled,
  };
}
