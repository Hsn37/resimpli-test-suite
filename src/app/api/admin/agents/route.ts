import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { listAgents } from "@/lib/retell";
import { getAgentSettingsMap, setAgentsEnabled, setAgentsTag } from "@/lib/db";
import { AGENT_TAGS, ALL_AGENTS_TAG } from "@/lib/presets";

const MAX_BULK_AGENTS = 500;
const VALID_TAGS = new Set<string>([ALL_AGENTS_TAG, ...AGENT_TAGS]);

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  try {
    const [agents, settings] = await Promise.all([listAgents(), getAgentSettingsMap()]);
    const agentList = agents.map((agent: { agent_id: string; agent_name: string }) => {
      const setting = settings.get(agent.agent_id);
      return {
        agent_id: agent.agent_id,
        agent_name: agent.agent_name,
        enabled: setting?.enabled ?? true,
        tag: setting?.tag ?? ALL_AGENTS_TAG,
      };
    });
    return NextResponse.json({ agents: agentList });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to list agents";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  try {
    const body = await request.json();
    const { agentIds, enabled, tag } = body as {
      agentIds?: string[];
      enabled?: boolean;
      tag?: string;
    };

    if (!Array.isArray(agentIds) || agentIds.length === 0) {
      return NextResponse.json({ error: "agentIds is required" }, { status: 400 });
    }
    if (agentIds.length > MAX_BULK_AGENTS) {
      return NextResponse.json(
        { error: `Cannot update more than ${MAX_BULK_AGENTS} agents at once` },
        { status: 400 }
      );
    }
    if (typeof enabled !== "boolean" && typeof tag !== "string") {
      return NextResponse.json({ error: "enabled or tag is required" }, { status: 400 });
    }
    if (typeof tag === "string" && !VALID_TAGS.has(tag)) {
      return NextResponse.json({ error: "Invalid tag" }, { status: 400 });
    }

    if (typeof enabled === "boolean") await setAgentsEnabled(agentIds, enabled);
    if (typeof tag === "string") await setAgentsTag(agentIds, tag);

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update agent";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
