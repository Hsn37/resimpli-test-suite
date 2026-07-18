import { NextResponse } from "next/server";
import { getAiGradesForSubjects, insertAiGrade, updateBatchTestRunCounts } from "@/lib/db";
import { getBatchTest, listAllTestRuns } from "@/lib/retell";
import { gradeTranscript } from "@/lib/grading";
import { getServerWorkspace } from "@/lib/workspaceServer";
import type { TranscriptTurn } from "@/lib/transcript";

const TERMINAL_RUN_STATUSES = new Set(["pass", "fail", "error"]);
const GRADING_CONCURRENCY = 4;

interface TestRunRaw {
  test_case_job_id?: string;
  status?: string;
  transcript_snapshot?: {
    transcript?: TranscriptTurn[];
    dynamicVariables?: Record<string, unknown>;
  };
  [key: string]: unknown;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const workspace = await getServerWorkspace();
    const [batch, testRunsRaw] = await Promise.all([
      getBatchTest(id),
      listAllTestRuns(id),
    ]);
    const testRuns = testRunsRaw as TestRunRaw[];

    // Keep local run history counts fresh without a separate poll-writer.
    await updateBatchTestRunCounts(id, {
      status: batch.status,
      pass_count: batch.pass_count,
      fail_count: batch.fail_count,
      error_count: batch.error_count,
      total_count: batch.total_count,
    }).catch(() => undefined);

    const jobIds = testRuns
      .map((r) => r.test_case_job_id)
      .filter((jobId): jobId is string => Boolean(jobId));
    const cachedGrades = await getAiGradesForSubjects("test_run", jobIds);

    const graded = await mapLimit(testRuns, GRADING_CONCURRENCY, async (run) => {
      const jobId = run.test_case_job_id;
      if (!jobId) return run;

      const cached = cachedGrades.get(jobId);
      if (cached) {
        return { ...run, ai_grade: { score: cached.score, note: cached.note } };
      }

      const status = (run.status ?? "").toLowerCase();
      const transcript = run.transcript_snapshot?.transcript;
      if (!TERMINAL_RUN_STATUSES.has(status) || !transcript || transcript.length === 0) {
        return run;
      }

      try {
        const result = await gradeTranscript(
          workspace,
          transcript,
          run.transcript_snapshot?.dynamicVariables ?? {}
        );
        if (!result) return run;
        await insertAiGrade({
          subjectType: "test_run",
          subjectId: jobId,
          score: result.score,
          note: result.note,
        });
        return { ...run, ai_grade: { score: result.score, note: result.note } };
      } catch {
        return run;
      }
    });

    return NextResponse.json({ batch, test_runs: graded });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to get batch test";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
