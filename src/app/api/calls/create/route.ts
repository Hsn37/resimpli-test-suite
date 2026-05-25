import { NextResponse } from "next/server";
import { createWebCall } from "@/lib/retell";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { agent_id, dynamic_variables, metadata } = body;

    if (!agent_id) {
      return NextResponse.json(
        { error: "agent_id is required" },
        { status: 400 }
      );
    }

    const result = await createWebCall({
      agent_id,
      retell_llm_dynamic_variables: dynamic_variables,
      metadata,
    });

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create call";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
