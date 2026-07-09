import { NextResponse } from "next/server";
import { getAgentSetting, getTestCaseSet, insertBatchTestRun, listBatchTestRuns } from "@/lib/db";
import {
  createBatchTest,
  createTestCaseDefinition,
  type ResponseEngine,
} from "@/lib/retell";
import type { TestCase } from "@/lib/testCase";

type CaseInput = Omit<TestCase, "id">;

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
      set_name,
      agent_id,
      agent_name,
      version,
      response_engine,
      user_email,
      case_indices,
      cases: inlineCases,
    } = body as {
      set_id?: string;
      set_name?: string;
      agent_id?: string;
      agent_name?: string;
      version?: number;
      response_engine?: ResponseEngine;
      user_email?: string;
      /** Optional subset of the case list to run, by position (its current
       * order) rather than all of them. Omit to run every case. */
      case_indices?: number[];
      /** Run against these cases directly instead of the saved set — lets a
       * "run without saving" action test unsaved edits. `set_id` is still
       * required to attribute the run to a set in batch_test_runs. */
      cases?: CaseInput[];
    };

    if (!set_id || !agent_id || !agent_name || !response_engine) {
      return NextResponse.json(
        { error: "set_id, agent_id, agent_name, and response_engine are required" },
        { status: 400 }
      );
    }

    const setting = await getAgentSetting(agent_id).catch(() => ({
      agent_id,
      enabled: true,
      tag: "all",
    }));
    if (!setting.enabled) {
      return NextResponse.json(
        { error: "This agent is disabled and cannot be tested" },
        { status: 403 }
      );
    }

    let allCases: CaseInput[];
    let setName: string;
    if (inlineCases && inlineCases.length > 0) {
      allCases = inlineCases;
      setName = set_name ?? "Untitled set";
    } else {
      const set = await getTestCaseSet(set_id);
      if (!set || set.cases.length === 0) {
        return NextResponse.json(
          { error: "Test case set not found or has no cases" },
          { status: 400 }
        );
      }
      allCases = set.cases;
      setName = set.name;
    }

    const casesToRun = Array.isArray(case_indices)
      ? case_indices.map((i) => allCases[i]).filter((c): c is CaseInput => c != null)
      : allCases;
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
      setName,
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
