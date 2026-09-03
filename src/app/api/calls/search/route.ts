import { NextResponse } from "next/server";
import { getCall } from "@/lib/retell";
import { getAuthorizedWorkspaces, retellKeyForWorkspace } from "@/lib/workspaceServer";
import { WORKSPACE_META } from "@/lib/workspace";

// Up to one Retell get-call round-trip per workspace, fanned out in parallel.
export const maxDuration = 30;

/**
 * Locate a call by ID across every workspace the session may read — all of them
 * for an admin, "dev" alone for everyone else. Returns the owning workspace so
 * the caller can open the call against its true account (see sharePath).
 */
export async function GET(request: Request) {
  try {
    const callId = new URL(request.url).searchParams.get("call_id")?.trim();
    if (!callId) {
      return NextResponse.json({ error: "Missing call_id" }, { status: 400 });
    }

    // A Retell call ID only ever exists in the one account that produced it, so
    // the first hit (in WORKSPACES order) is the answer. A 404 and a missing
    // key both just rule a workspace out — one unconfigured key can't fail the
    // whole search.
    const workspaces = await getAuthorizedWorkspaces();
    const hits = await Promise.all(
      workspaces.map(async (workspace) => {
        try {
          const call = (await getCall(callId, retellKeyForWorkspace(workspace))) as Record<
            string,
            unknown
          >;
          return { workspace, call };
        } catch {
          return null;
        }
      })
    );
    const hit = hits.find((h) => h !== null);

    if (!hit) {
      const searched = workspaces.map((w) => WORKSPACE_META[w].label).join(", ");
      return NextResponse.json(
        { error: `No call with that ID in ${searched}.` },
        { status: 404 }
      );
    }

    return NextResponse.json({
      call_id: callId,
      workspace: hit.workspace,
      agent_name: (hit.call.agent_name as string | undefined) ?? null,
      start_timestamp: (hit.call.start_timestamp as number | undefined) ?? null,
      call_status: (hit.call.call_status as string | undefined) ?? null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to search for call";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
