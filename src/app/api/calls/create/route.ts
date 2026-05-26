import { NextResponse } from "next/server";
import { createWebCall } from "@/lib/retell";

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
