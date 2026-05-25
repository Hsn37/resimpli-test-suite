import { NextResponse } from "next/server";
import { listAgents } from "@/lib/retell";

export async function GET() {
  try {
    const agents = await listAgents();
    return NextResponse.json(agents);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to list agents";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
