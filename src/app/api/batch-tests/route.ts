import { NextResponse } from "next/server";
import { getTestCaseSet, insertBatchTestRun, listBatchTestRuns } from "@/lib/db";
import {
  createBatchTest,
  createTestCaseDefinition,
  type ResponseEngine,
} from "@/lib/retell";

export async function GET() {
  try {
    const runs = await listBatchTestRuns();
    return NextResponse.json(runs);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to list batch tests";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      set_id,
      agent_id,
      agent_name,
      version,
      response_engine,
      user_email,
      case_indices,
    } = body as {
      set_id?: string;
      agent_id?: string;
      agent_name?: string;
      version?: number;
      response_engine?: ResponseEngine;
      user_email?: string;
      /** Optional subset of `set.cases` to run, by position (its current
       * save order) rather than all of them. Omit to run every case. */
      case_indices?: number[];
    };

    if (!set_id || !agent_id || !agent_name || !response_engine) {
      return NextResponse.json(
        { error: "set_id, agent_id, agent_name, and response_engine are required" },
        { status: 400 }
      );
    }

    const set = await getTestCaseSet(set_id);
    if (!set || set.cases.length === 0) {
      return NextResponse.json(
        { error: "Test case set not found or has no cases" },
        { status: 400 }
      );
    }

    const casesToRun = Array.isArray(case_indices)
      ? case_indices.map((i) => set.cases[i]).filter((c): c is (typeof set.cases)[number] => c != null)
      : set.cases;
    if (casesToRun.length === 0) {
      return NextResponse.json(
        { error: "No valid test cases selected to run" },
        { status: 400 }
      );
    }

    const definitionIds: string[] = [];
    for (const c of casesToRun) {
      const result = await createTestCaseDefinition({
        response_engine,
        name: c.name,
        user_prompt: c.user_prompt,
        metrics: c.metrics,
        dynamic_variables: c.dynamic_variables,
        tool_mocks: c.tool_mocks,
        llm_model: c.llm_model,
      });
      const definitionId = result.test_case_definition_id || result.id;
      if (!definitionId) {
        throw new Error(`No test_case_definition_id returned for case "${c.name}"`);
      }
      definitionIds.push(definitionId);
    }

    const batch = await createBatchTest({
      response_engine,
      test_case_definition_ids: definitionIds,
    });
    const batchId: string = batch.test_case_batch_job_id || batch.id;
    if (!batchId) {
      throw new Error("No test_case_batch_job_id returned from create-batch-test");
    }

    await insertBatchTestRun({
      id: batchId,
      setId: set_id,
      setName: set.name,
      agentId: agent_id,
      agentName: agent_name,
      version,
      responseEngine: response_engine,
      userEmail: user_email,
    });

    return NextResponse.json({ id: batchId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to start batch test";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
