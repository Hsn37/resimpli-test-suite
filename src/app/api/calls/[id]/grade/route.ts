import { NextResponse } from "next/server";
import { listFailureClasses } from "@/lib/db";
import { gradeRetellCall } from "@/lib/grading";
import { getServerWorkspace, retellKeyForWorkspace } from "@/lib/workspaceServer";
import { toCallRowGrade } from "@/lib/callGrade";

// Manual "Grade call" trigger. Runs the unified 0-100 grader (upsert into
// `calls` → OpenAI grade → `call_grades`), so a call graded here shows the same
// rep_score + grade breakdown as ingested/dashboard calls. Grading polls OpenAI,
// so give the route headroom before the platform kills it.
export const maxDuration = 30;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const workspace = await getServerWorkspace();
    const apiKey = retellKeyForWorkspace(workspace);

    const grade = await gradeRetellCall(workspace, id, apiKey);
    if (!grade) {
      return NextResponse.json(
        { error: "Grading failed — no transcript available yet, or the grader timed out." },
        { status: 422 }
      );
    }
    if (grade.error) {
      return NextResponse.json({ error: `Grader error: ${grade.error}` }, { status: 502 });
    }

    // Return the compact row fields (chips + note) the calls table merges in,
    // plus the full grade row for the modal breakdown.
    const failureClasses = await listFailureClasses(workspace).catch(() => []);
    const classNames = new Map(failureClasses.map((c) => [c.key, c.name]));
    return NextResponse.json(toCallRowGrade(grade, classNames));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to grade call";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
