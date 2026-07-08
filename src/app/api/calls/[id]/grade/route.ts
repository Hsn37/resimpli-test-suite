import { NextResponse } from "next/server";
import { getCall } from "@/lib/retell";
import { ensureCallGraded } from "@/lib/grader";

// Manual "Grade call" trigger. Grading itself polls for up to ~15s, so give
// this route enough headroom to finish before the platform kills it.
export const maxDuration = 20;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const call = await getCall(id);
    const aiGrade = await ensureCallGraded(
      id,
      call.transcript_object,
      call.retell_llm_dynamic_variables
    );

    if (!aiGrade) {
      return NextResponse.json(
        { error: "Grading failed — no transcript available yet, or the grader timed out." },
        { status: 422 }
      );
    }

    return NextResponse.json({ ai_grade: aiGrade });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to grade call";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
