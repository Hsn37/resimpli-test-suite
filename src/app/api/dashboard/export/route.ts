import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getDashboardCallDetail } from "@/lib/db";
import { getServerWorkspace } from "@/lib/workspaceServer";
import { EXPORT_BATCH } from "@/lib/dashboard";

// Full exported-call rows for a set of call ids (workspace-scoped), fetched in
// batches to avoid a single oversized query. The client already holds the
// window/filters/stats metadata and wraps these rows into the export payload.
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids) ? body.ids.filter((x): x is string => typeof x === "string") : [];
  if (ids.length === 0) return NextResponse.json({ calls: [] });

  const workspace = await getServerWorkspace();
  const calls: unknown[] = [];
  for (let i = 0; i < ids.length; i += EXPORT_BATCH) {
    const slice = ids.slice(i, i + EXPORT_BATCH);
    const batch = await Promise.all(
      slice.map((id) => getDashboardCallDetail(workspace, id))
    );
    for (const call of batch) {
      if (!call) continue;
      const g = call.call_grades;
      calls.push({
        id: call.id,
        retell_call_id: call.retell_call_id,
        timestamp: call.timestamp,
        duration_seconds: call.duration_seconds,
        agent_id: call.agent_id,
        agent_version: call.agent_version,
        voice_id: call.voice_id,
        voice_name: call.voice_name,
        phone_number: call.phone_number,
        recording_url: call.recording_url,
        appointment_booked: call.appointment_booked,
        transcript: call.transcript,
        dynamic_variables: call.dynamic_variables,
        grading: g
          ? {
              grade: g.grade,
              applicable_count: g.applicable_count,
              passed_count: g.passed_count,
              ai_callout: g.ai_callout,
              ai_callout_quote: g.ai_callout_quote,
              model: g.model,
              error: g.error,
              graded_at: g.graded_at,
              results: g.results,
              rep_score: g.rep_score,
              rep_scorecard: g.rep_scorecard,
            }
          : null,
      });
    }
  }
  // Preserve the caller's id order (the batched fetch may reorder).
  const byId = new Map(calls.map((c) => [(c as { id: string }).id, c]));
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
  return NextResponse.json({ calls: ordered });
}
