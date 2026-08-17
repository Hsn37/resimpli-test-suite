import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireAdmin } from "@/lib/admin";
import {
  getCallTranscriptsByIds,
  getCycleCallReview,
  listDashboardCallsInRange,
  upsertCycleCallReview,
} from "@/lib/db";
import { getServerWorkspace } from "@/lib/workspaceServer";
import { CALLS_WINDOW_LIMIT, CYCLE_MS, DAY_MS } from "@/lib/dashboard";
import {
  buildTopCallsPool,
  rankTopCallsCandidates,
  TOP_CALLS_MAX_WINDOW_DAYS,
  TOP_CALLS_SHORTLIST_LIMIT,
} from "@/lib/topCalls";
import {
  TOP_CALLS_MAX_FINALISTS,
  TOP_CALLS_MODEL,
  topCallsFingerprint,
  judgeTopCalls,
  selectFinalists,
  type TopCallsFinalist,
  type TopCallsRecommendation,
} from "@/lib/topCallsJudge";

export const maxDuration = 120;

// Never below one cycle, which is the panel's own default range.
const MAX_WINDOW_MS = Math.max(TOP_CALLS_MAX_WINDOW_DAYS * DAY_MS, CYCLE_MS + DAY_MS);
// Refill at most two additional batches when legacy calls are rejected. This
// bounds request time/cost while preventing a weak first batch from crowding out
// later candidates.
const MAX_JUDGE_BATCHES = 3;

function readWindow(request: Request): { from: number; to: number } | null {
  const { searchParams } = new URL(request.url);
  const from = Number(searchParams.get("from"));
  const to = Number(searchParams.get("to"));
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
  if (to - from > MAX_WINDOW_MS) return null;
  return { from, to };
}

async function loadPool(request: Request) {
  const window = readWindow(request);
  if (!window) return null;
  const workspace = await getServerWorkspace();
  const model = TOP_CALLS_MODEL;
  const calls = await listDashboardCallsInRange(
    workspace,
    window.from,
    window.to,
    CALLS_WINDOW_LIMIT
  );
  const candidates = rankTopCallsCandidates(calls);
  const pool = buildTopCallsPool(calls, candidates);
  // Fingerprint the entire eligible queue—not only the first 20—because refill
  // batches can affect the finalists.
  const fingerprint = topCallsFingerprint(candidates, model);
  return { workspace, window, calls, candidates, pool, fingerprint, model };
}

function poolForReview(
  loaded: NonNullable<Awaited<ReturnType<typeof loadPool>>>,
  review: TopCallsRecommendation | null
) {
  if (!review?.evaluated_call_ids?.length) return loaded.pool;
  const evaluated = new Set(review.evaluated_call_ids);
  const displayed = loaded.candidates.filter((candidate) =>
    evaluated.has(candidate.retell_call_id)
  );
  return buildTopCallsPool(loaded.calls, loaded.candidates, displayed);
}

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const loaded = await loadPool(request);
  if (!loaded) {
    return NextResponse.json({ error: `A valid from/to window of at most ${TOP_CALLS_MAX_WINDOW_DAYS} days is required` }, { status: 400 });
  }
  const cached = await getCycleCallReview<TopCallsRecommendation>(
    loaded.workspace,
    loaded.window.from
  );
  const cachedRecommendation =
    cached?.candidate_fingerprint === loaded.fingerprint ? cached.result : null;
  const currentReview = cachedRecommendation
    ? {
        recommendation: cachedRecommendation,
        model: cached!.model,
        generated_at: cached!.generated_at,
      }
    : null;

  return NextResponse.json({
    ...poolForReview(loaded, cachedRecommendation),
    review: currentReview,
  });
}

export async function POST(request: Request) {
  // Ranking spends OpenAI credits and `force` bypasses the cache, so this
  // matches the other spend-triggering routes (backfill, grade-pending).
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const loaded = await loadPool(request);
  if (!loaded) {
    return NextResponse.json({ error: `A valid from/to window of at most ${TOP_CALLS_MAX_WINDOW_DAYS} days is required` }, { status: 400 });
  }
  // An empty cycle is normal, not an unprocessable request. Keep GET/POST
  // semantics consistent and let the UI render the funnel counts.
  if (loaded.candidates.length === 0) {
    return NextResponse.json({ ...loaded.pool, review: null });
  }

  const body = (await request.json().catch(() => ({}))) as { force?: unknown };
  const cached = await getCycleCallReview<TopCallsRecommendation>(
    loaded.workspace,
    loaded.window.from
  );
  if (body.force !== true && cached?.candidate_fingerprint === loaded.fingerprint) {
    return NextResponse.json({
      ...poolForReview(loaded, cached.result),
      review: {
        recommendation: cached.result,
        model: cached.model,
        generated_at: cached.generated_at,
      },
    });
  }

  try {
    const finalists: TopCallsFinalist[] = [];
    const evaluatedCallIds: string[] = [];
    const summaries: string[] = [];
    const seenFinalists = new Set<string>();
    // Each batch nominates its own podium; the merge below picks between them
    // instead of silently discarding every nomination. Earlier batches hold the
    // stronger candidates, so their picks are considered first.
    const batchNominations: string[] = [];

    for (
      let batchIndex = 0;
      batchIndex < MAX_JUDGE_BATCHES &&
      finalists.length < TOP_CALLS_MAX_FINALISTS;
      batchIndex += 1
    ) {
      const start = batchIndex * TOP_CALLS_SHORTLIST_LIMIT;
      const batch = loaded.candidates.slice(
        start,
        start + TOP_CALLS_SHORTLIST_LIMIT
      );
      if (batch.length === 0) break;

      // One query per batch instead of three per candidate. Fetching per batch
      // (not for every candidate up front) keeps refill batches from reading
      // transcripts the judge may never see.
      const transcripts = await getCallTranscriptsByIds(
        loaded.workspace,
        batch.map((candidate) => candidate.id)
      );
      const judgeCandidates = batch
        .filter((candidate) => transcripts.has(candidate.id))
        .map((candidate) => ({
          candidate,
          transcript: transcripts.get(candidate.id),
        }));
      if (judgeCandidates.length === 0) continue;

      const batchReview = await judgeTopCalls({
        candidates: judgeCandidates,
        model: loaded.model,
        apiKey: process.env.OPENAI_API_KEY,
      });
      evaluatedCallIds.push(...batchReview.evaluated_call_ids);
      if (batchReview.summary) summaries.push(batchReview.summary);
      batchNominations.push(...batchReview.podium_call_ids);
      for (const finalist of batchReview.finalists) {
        if (seenFinalists.has(finalist.call_id)) continue;
        seenFinalists.add(finalist.call_id);
        finalists.push(finalist);
      }
    }

    const selected = selectFinalists(finalists, batchNominations);
    const recommendation: TopCallsRecommendation = {
      podium_call_ids: selected.podiumCallIds,
      summary:
        summaries.join(" ").slice(0, 800) ||
        "No call in this range had enough marketing value to publish.",
      finalists: selected.finalists,
      evaluated_call_ids: Array.from(new Set(evaluatedCallIds)),
    };

    await upsertCycleCallReview({
      workspace: loaded.workspace,
      cycleStart: loaded.window.from,
      cycleEnd: loaded.window.to,
      candidateFingerprint: loaded.fingerprint,
      result: recommendation,
      model: loaded.model,
    });
    return NextResponse.json({
      ...poolForReview(loaded, recommendation),
      review: { recommendation, model: loaded.model, generated_at: Date.now() },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Top-calls ranking failed" },
      { status: 500 }
    );
  }
}
