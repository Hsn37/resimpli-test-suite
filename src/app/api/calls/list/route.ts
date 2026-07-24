import { NextResponse, after } from "next/server";
import { getCall, listAgents, listCalls } from "@/lib/retell";
import {
  getCallGradesByIds,
  getCallLogsByIds,
  listFailureClasses,
  type CallGrade,
} from "@/lib/db";
import { getServerWorkspace, retellKeyForWorkspace } from "@/lib/workspaceServer";
import { scoreToStars } from "@/lib/grade";
import { gradeRetellCall } from "@/lib/grading";
import { humanAiNote } from "@/lib/callGrade";
import type { TranscriptTurn } from "@/lib/transcript";

interface RetellAgent {
  agent_id: string;
  agent_name?: string;
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
    // Total number of recent calls to return. Capped at one Retell page (1000):
    // list-calls is ~5s/page, so multi-page fetches blow past this route's 30s
    // budget (a 5000 request 500'd). The /calls page loads this window and
    // filters/sorts/paginates over it client-side; full history lives on the
    // dashboard's own date-range query.
    const MAX_LIMIT = 1000;
    const target =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, MAX_LIMIT)
        : 50;

    const workspace = await getServerWorkspace();
    const apiKey = retellKeyForWorkspace(workspace);

    // Optional refinements over the default recent window:
    //  • call_id — fetch that one call straight from Retell, so an ID outside
    //    the loaded window (or from an old date) is still reachable.
    //  • from/to (epoch ms) — narrow the list to a start_timestamp window via
    //    Retell's filter_criteria, still capped at one 1000-call page.
    const callIdParam = searchParams.get("call_id")?.trim();
    const fromParam = Number(searchParams.get("from"));
    const toParam = Number(searchParams.get("to"));
    const rangeFilter =
      Number.isFinite(fromParam) && Number.isFinite(toParam)
        ? { start_timestamp: { lower_threshold: fromParam, upper_threshold: toParam } }
        : undefined;

    // Kick off the agent-name lookup in parallel with paging through calls.
    const agentsPromise = listAgents(apiKey).catch(() => [] as RetellAgent[]);

    const callList: Array<Record<string, unknown>> = [];
    if (callIdParam) {
      // Direct lookup — a single call (empty list if Retell 404s). The shared
      // enrichment below still attaches agent name / grades / logs.
      const one = await getCall(callIdParam, apiKey).catch(() => null);
      if (one) callList.push(one as Record<string, unknown>);
    } else {
      // Recent window, or a date-range window when from/to are set. Retell caps
      // a single list-calls request at 1000, so page through it (newest first)
      // until we reach the target or run out of calls.
      const PER_REQUEST = 1000;
      let cursor = searchParams.get("pagination_key") || undefined;
      while (callList.length < target) {
        const batch = (await listCalls(
          {
            limit: Math.min(PER_REQUEST, target - callList.length),
            pagination_key: cursor,
            ...(rangeFilter ? { filter_criteria: rangeFilter } : {}),
          },
          apiKey
        )) as Array<Record<string, unknown>>;
        if (batch.length === 0) break;
        callList.push(...batch);
        if (batch.length < PER_REQUEST) break; // No more pages.
        cursor = String(batch[batch.length - 1].call_id);
      }
    }

    const agents = await agentsPromise;
    const agentNames = new Map<string, string>(
      (agents as RetellAgent[]).map((a) => [a.agent_id, a.agent_name ?? a.agent_id])
    );

    // Enrich with our own call logs (grade/note/user) for calls placed from
    // within this tool. Degrades gracefully if the DB is unreachable.
    const callIds = callList.map((c) => String(c.call_id));
    // Also bulk-fetch the full 0-100 call_grades (workspace-scoped) + the
    // failure-class name map so /calls can lead with the rep_score + grade
    // chips and a human note. All degrade gracefully so a DB hiccup never
    // breaks the list.
    const [logs, callGrades, failureClasses] = await Promise.all([
      getCallLogsByIds(workspace, callIds).catch(() => new Map()),
      getCallGradesByIds(workspace, callIds).catch(() => new Map<string, CallGrade>()),
      listFailureClasses(workspace).catch(() => []),
    ]);
    const classNames = new Map<string, string>(
      failureClasses.map((c) => [c.key, c.name])
    );

    const enriched = callList.map((call) => {
      const log = logs.get(String(call.call_id));
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
        // Full 0-100 grade (from call_grades) drives the rep_score + grade
        // chips + human note. Kept null when the call has no grade row (the
        // row shows a "Grade call" button until then).
        rep_score: callGrade?.rep_score ?? null,
        grade100: callGrade?.grade ?? null,
        ai_callout: callGrade?.ai_callout ?? false,
        ai_note: callGrade ? humanAiNote(callGrade, classNames) : null,
      };
    });

    // Auto-grade a handful of calls that don't have a full grade yet, via the
    // unified 0-100 path (upsert into `calls` → OpenAI → call_grades) so every
    // call shows a consistent rep_score + grade. Runs in the background so it
    // never delays the response.
    const ungraded = callList
      .filter((call) => {
        const transcript = call.transcript_object as TranscriptTurn[] | undefined;
        return !callGrades.has(String(call.call_id)) && transcript && transcript.length > 0;
      })
      .slice(0, MAX_AUTO_GRADE_PER_LOAD);

    if (ungraded.length > 0) {
      after(() =>
        Promise.all(
          ungraded.map((call) =>
            gradeRetellCall(workspace, String(call.call_id), apiKey, call).catch((err) =>
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
