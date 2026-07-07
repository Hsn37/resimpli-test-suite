import { NextRequest, NextResponse, after } from "next/server";
import { insertCallLog, updateCallGrade } from "@/lib/db";
import { gradeCallWhenReady } from "@/lib/grader";

// Record a call when it ends. Grade/note are added later via PATCH.
export async function POST(req: NextRequest) {
  try {
    const {
      callId,
      agentId,
      agentName,
      version,
      direction,
      user,
      timestamp,
      duration,
      variables,
    } = await req.json();

    if (!callId) {
      return NextResponse.json({ error: "callId is required" }, { status: 400 });
    }

    await insertCallLog({
      callId,
      agentId,
      agentName,
      version,
      direction,
      variables,
      userEmail: user,
      timestamp,
      duration,
    });

    // AI grading runs eagerly in the background: Retell's transcript isn't
    // ready the instant the call ends, so this polls until it is, then
    // grades and caches it — no one needs to open the call for it to happen.
    after(() => gradeCallWhenReady(callId).catch(() => undefined));

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to log call";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Update grade + note for an existing call.
export async function PATCH(req: NextRequest) {
  try {
    const { callId, grade, note } = await req.json();

    if (!callId) {
      return NextResponse.json({ error: "callId is required" }, { status: 400 });
    }

    await updateCallGrade(callId, grade, note);

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update call";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
