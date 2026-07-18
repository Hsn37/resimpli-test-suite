import { NextResponse, after } from "next/server";
import { listAgents, listCalls } from "@/lib/retell";
import {
  getAiGradesForSubjects,
  getCallGradesByIds,
  getCallLogsByIds,
  listFailureClasses,
  type CallGrade,
} from "@/lib/db";
import { getServerWorkspace, retellKeyForWorkspace } from "@/lib/workspaceServer";
import { scoreToStars } from "@/lib/grade";
import { ensureCallGraded } from "@/lib/grading";
import type { TranscriptTurn } from "@/lib/transcript";

interface RetellAgent {
  agent_id: string;
  agent_name?: string;
}

// A failure-class `results` entry (per-check applicability + pass/fail + quote).
interface FailureResult {
  applicable: boolean;
  passed: boolean;
  evidence: string;
}

// Default AI-note copy when a caller-suspected-AI callout carries no quote.
const DEFAULT_CALLOUT_NOTE = "Caller suspected AI";

/**
 * Compose the human-readable AI note from a full call_grades row:
 *   1. AI callout → its quote (or a short default),
 *   2. else the first applicable-but-failed class by its human `name`,
 *   3. else a compact "Passed X/Y checks" summary.
 * `classNames` maps failure-class key → display name (from listFailureClasses).
 */
function humanAiNote(
  grade: CallGrade,
  classNames: Map<string, string>
): string {
  if (grade.ai_callout) {
    return grade.ai_callout_quote?.trim() || DEFAULT_CALLOUT_NOTE;
  }
  const failed = Object.entries(grade.results as Record<string, FailureResult>).find(
    ([, r]) => r?.applicable && !r?.passed
  );
  if (failed) {
    const [key] = failed;
    return `Top issue: ${classNames.get(key) ?? key}`;
  }
  return `Passed ${grade.passed_count}/${grade.applicable_count} checks`;
}

// Cap on how many ungraded calls we'll kick off grading for per page load,
// so visiting the call history page after a long gap doesn't fire off a
// burst of grading chats and hit Retell's rate limits. The rest backfill
// gradually as the page is revisited.
const MAX_AUTO_GRADE_PER_LOAD = 5;

// Background auto-grading (see below) runs up to MAX_AUTO_GRADE_PER_LOAD
// gradings in parallel, each capped at ~15s, so give `after()` enough
// headroom to finish before the function is killed.
export const maxDuration = 30;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const parsedLimit = Number(searchParams.get("limit"));
    // Total number of recent calls to return. The /calls page loads this whole
    // window and filters/sorts/paginates over it client-side.
    const target =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, 5000)
        : 50;

    const workspace = await getServerWorkspace();
    const apiKey = retellKeyForWorkspace(workspace);

    // Kick off the agent-name lookup in parallel with paging through calls.
    const agentsPromise = listAgents(apiKey).catch(() => [] as RetellAgent[]);

    // Retell caps a single list-calls request at 1000, so page through it
    // (newest first) until we reach the target or run out of calls.
    const PER_REQUEST = 1000;
    const callList: Array<Record<string, unknown>> = [];
    let cursor = searchParams.get("pagination_key") || undefined;
    while (callList.length < target) {
      const batch = (await listCalls(
        {
          limit: Math.min(PER_REQUEST, target - callList.length),
          pagination_key: cursor,
        },
        apiKey
      )) as Array<Record<string, unknown>>;
      if (batch.length === 0) break;
      callList.push(...batch);
      if (batch.length < PER_REQUEST) break; // No more pages.
      cursor = String(batch[batch.length - 1].call_id);
    }

    const agents = await agentsPromise;
    const agentNames = new Map<string, string>(
      (agents as RetellAgent[]).map((a) => [a.agent_id, a.agent_name ?? a.agent_id])
    );

    // Enrich with our own call logs (grade/note/user) for calls placed from
    // within this tool. Degrades gracefully if the DB is unreachable.
    const callIds = callList.map((c) => String(c.call_id));
    // Also bulk-fetch the full 0-100 call_grades (workspace-scoped) + the
    // failure-class name map so /calls can lead with rep_score-as-stars and a
    // human note. All degrade gracefully so a DB hiccup never breaks the list.
    const [logs, aiGrades, callGrades, failureClasses] = await Promise.all([
      getCallLogsByIds(workspace, callIds).catch(() => new Map()),
      getAiGradesForSubjects("call", callIds).catch(() => new Map()),
      getCallGradesByIds(workspace, callIds).catch(() => new Map<string, CallGrade>()),
      listFailureClasses(workspace).catch(() => []),
    ]);
    const classNames = new Map<string, string>(
      failureClasses.map((c) => [c.key, c.name])
    );

    const enriched = callList.map((call) => {
      const log = logs.get(String(call.call_id));
      const aiGrade = aiGrades.get(String(call.call_id));
      const callGrade = callGrades.get(String(call.call_id)) as CallGrade | undefined;
      // Prefer our DB record; fall back to the user we stamped into the Retell
      // call metadata at creation time (covers calls placed from this tool).
      const metaUser = (call.metadata as { user?: string } | undefined)?.user;
      // DB stores the rating as a score out of 10; convert to a star count
      // for the UI, which renders star icons.
      const grade = log?.grade != null ? scoreToStars(log.grade) : null;
      return {
        ...call,
        agent_name: agentNames.get(call.agent_id as string) ?? null,
        grade,
        note: log?.note ?? null,
        user_email: log?.user_email ?? metaUser ?? null,
        // Full 0-100 grade (from call_grades) drives the headline rep-stars +
        // grade/100 chip + human note. Kept null when the call has no grade
        // row; the 0-10 ai_grade below is the dev fallback.
        rep_score: callGrade?.rep_score ?? null,
        grade100: callGrade?.grade ?? null,
        ai_callout: callGrade?.ai_callout ?? false,
        ai_note: callGrade ? humanAiNote(callGrade, classNames) : null,
        ai_grade: aiGrade ? { score: aiGrade.score, note: aiGrade.note } : null,
      };
    });

    // Auto-grade a handful of calls that don't have a cached grade yet,
    // regardless of how they were placed — covers calls that never went
    // through this tool's own "log on call end" path. Runs in the
    // background so it never delays the response.
    const ungraded = callList
      .filter((call) => {
        const transcript = call.transcript_object as TranscriptTurn[] | undefined;
        return !aiGrades.has(String(call.call_id)) && transcript && transcript.length > 0;
      })
      .slice(0, MAX_AUTO_GRADE_PER_LOAD);

    if (ungraded.length > 0) {
      after(() =>
        Promise.all(
          ungraded.map((call) =>
            ensureCallGraded(
              String(call.call_id),
              call.transcript_object as TranscriptTurn[] | undefined,
              call.retell_llm_dynamic_variables as Record<string, unknown> | undefined,
              workspace
            ).catch((err) =>
              console.error(`[grading] failed to auto-grade call ${call.call_id}:`, err)
            )
          )
        )
      );
    }

    return NextResponse.json(enriched);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to list calls";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
