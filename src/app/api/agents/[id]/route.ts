import { NextResponse } from "next/server";
import { getAgent, getAgentVersions } from "@/lib/retell";
import { getAgentSetting } from "@/lib/db";
import { ALL_AGENTS_TAG } from "@/lib/presets";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const [agent, versions, setting] = await Promise.all([
      getAgent(id),
      getAgentVersions(id).catch(() => []),
      // Fail open (treat as enabled/untagged) rather than 500ing this whole
      // endpoint if the settings DB has a transient hiccup — Retell, not this
      // table, is the source of truth for whether the agent itself exists.
      getAgentSetting(id).catch(() => ({ agent_id: id, enabled: true, tag: ALL_AGENTS_TAG })),
    ]);

    if (!setting.enabled) {
      return NextResponse.json({ error: "This agent is disabled" }, { status: 403 });
    }

    return NextResponse.json({ agent, versions, tag: setting.tag });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to get agent";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
