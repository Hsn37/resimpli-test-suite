import { NextResponse } from "next/server";
import { createWebCall } from "@/lib/retell";
import { getAgentSetting } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { agent_id, dynamic_variables, metadata, first_speaker } = body;

    if (!agent_id) {
      return NextResponse.json(
        { error: "agent_id is required" },
        { status: 400 }
      );
    }

    // This is the actual enforcement point for the admin "disable agent"
    // toggle — hiding a disabled agent from the homepage list is only a
    // convenience; a caller could still know its agent_id directly.
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

    const payload: Parameters<typeof createWebCall>[0] = {
      agent_id,
      retell_llm_dynamic_variables: dynamic_variables,
      metadata,
    };

    if (first_speaker === "user") {
      payload.agent_override = {
        conversation_flow: { start_speaker: "user" },
      };
    }

    const result = await createWebCall(payload);

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create call";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
