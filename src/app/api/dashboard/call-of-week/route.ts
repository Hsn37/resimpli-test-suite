import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getAppConfig,
  getDashboardCallDetail,
  getWeeklyCallReview,
  listDashboardCallsInRange,
  upsertWeeklyCallReview,
} from "@/lib/db";
import { getServerWorkspace } from "@/lib/workspaceServer";
import { CALLS_WINDOW_LIMIT } from "@/lib/dashboard";
import {
  buildCallOfWeekPool,
  rankCallOfWeekCandidates,
  CALL_OF_WEEK_SHORTLIST_LIMIT,
  type CallOfWeekCandidate,
} from "@/lib/callOfWeek";
import {
  CALL_OF_WEEK_MAX_FINALISTS,
  callOfWeekFingerprint,
  judgeCallOfWeek,
  type CallOfWeekFinalist,
  type CallOfWeekRecommendation,
} from "@/lib/callOfWeekJudge";
import { APP_CONFIG_KEYS, DEFAULT_GRADER_MODEL } from "@/lib/graderRubric";

export const maxDuration = 120;

const MAX_WINDOW_MS = 8 * 24 * 60 * 60 * 1000;
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
  const [calls, model] = await Promise.all([
    listDashboardCallsInRange(
      workspace,
      window.from,
      window.to,
      CALLS_WINDOW_LIMIT
    ),
    getAppConfig<string>(workspace, APP_CONFIG_KEYS.graderModel).then(
      (value) => value || DEFAULT_GRADER_MODEL
    ),
  ]);
  const candidates = rankCallOfWeekCandidates(calls);
  const pool = buildCallOfWeekPool(calls, candidates);
  // Fingerprint the entire eligible queue—not only the first 20—because refill
  // batches can affect the finalists.
  const fingerprint = callOfWeekFingerprint(candidates, model);
  return { workspace, window, calls, candidates, pool, fingerprint, model };
}

function poolForReview(
  loaded: NonNullable<Awaited<ReturnType<typeof loadPool>>>,
  review: CallOfWeekRecommendation | null
) {
  if (!review?.evaluated_call_ids?.length) return loaded.pool;
  const evaluated = new Set(review.evaluated_call_ids);
  const displayed = loaded.candidates.filter((candidate) =>
    evaluated.has(candidate.retell_call_id)
  );
  return buildCallOfWeekPool(loaded.calls, loaded.candidates, displayed);
}

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const loaded = await loadPool(request);
  if (!loaded) {
    return NextResponse.json({ error: "A valid weekly from/to window is required" }, { status: 400 });
  }
  const cached = await getWeeklyCallReview<CallOfWeekRecommendation>(
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
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const loaded = await loadPool(request);
  if (!loaded) {
    return NextResponse.json({ error: "A valid weekly from/to window is required" }, { status: 400 });
  }
  // An empty week is normal, not an unprocessable request. Keep GET/POST
  // semantics consistent and let the UI render the funnel counts.
  if (loaded.candidates.length === 0) {
    return NextResponse.json({ ...loaded.pool, review: null });
  }

  const body = (await request.json().catch(() => ({}))) as { force?: unknown };
  const cached = await getWeeklyCallReview<CallOfWeekRecommendation>(
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
    const finalists: CallOfWeekFinalist[] = [];
    const evaluatedCallIds: string[] = [];
    const summaries: string[] = [];
    const seenFinalists = new Set<string>();

    for (
      let batchIndex = 0;
      batchIndex < MAX_JUDGE_BATCHES &&
      finalists.length < CALL_OF_WEEK_MAX_FINALISTS;
      batchIndex += 1
    ) {
      const start = batchIndex * CALL_OF_WEEK_SHORTLIST_LIMIT;
      const batch = loaded.candidates.slice(
        start,
        start + CALL_OF_WEEK_SHORTLIST_LIMIT
      );
      if (batch.length === 0) break;

      const details = await Promise.all(
        batch.map(async (candidate) => ({
          candidate,
          detail: await getDashboardCallDetail(loaded.workspace, candidate.id),
        }))
      );
      const judgeCandidates = details.filter(
        (
          row
        ): row is {
          candidate: CallOfWeekCandidate;
          detail: NonNullable<typeof row.detail>;
        } => row.detail != null
      );
      if (judgeCandidates.length === 0) continue;

      const batchReview = await judgeCallOfWeek({
        candidates: judgeCandidates,
        model: loaded.model,
        apiKey: process.env.OPENAI_API_KEY,
      });
      evaluatedCallIds.push(...batchReview.evaluated_call_ids);
      if (batchReview.summary) summaries.push(batchReview.summary);
      for (const finalist of batchReview.finalists) {
        if (seenFinalists.has(finalist.call_id)) continue;
        seenFinalists.add(finalist.call_id);
        finalists.push(finalist);
      }
    }

    finalists.sort((a, b) => b.marketing_score - a.marketing_score);
    const selectedFinalists = finalists.slice(0, CALL_OF_WEEK_MAX_FINALISTS);
    const recommendation: CallOfWeekRecommendation = {
      winner_call_id: selectedFinalists[0]?.call_id ?? "",
      summary:
        summaries.join(" ").slice(0, 800) ||
        "No call had both a verified appointment and sufficient marketing value.",
      finalists: selectedFinalists,
      evaluated_call_ids: Array.from(new Set(evaluatedCallIds)),
    };

    await upsertWeeklyCallReview({
      workspace: loaded.workspace,
      weekStart: loaded.window.from,
      weekEnd: loaded.window.to,
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
      { error: error instanceof Error ? error.message : "Call-of-the-week ranking failed" },
      { status: 500 }
    );
  }
}
