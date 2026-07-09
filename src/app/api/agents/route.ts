import { NextResponse } from "next/server";
import { listAgents } from "@/lib/retell";
import { getAgentSettingsMap } from "@/lib/db";

export async function GET() {
  try {
    const agents = await listAgents();
    // Degrade to "everyone enabled" rather than failing the whole homepage
    // list if the settings DB has a transient hiccup — Retell is the source
    // of truth for which agents exist; this table only narrows that list.
    const settings = await getAgentSettingsMap().catch(() => new Map());
    const enabledAgents = agents.filter(
      (agent: { agent_id: string }) => settings.get(agent.agent_id)?.enabled !== false
    );
    return NextResponse.json(enabledAgents);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to list agents";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
