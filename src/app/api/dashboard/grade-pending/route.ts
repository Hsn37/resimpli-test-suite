import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { getServerWorkspace } from "@/lib/workspaceServer";
import { runGradePending } from "@/lib/ingestionJobs";

// Grade a batch of ungraded, eligible calls in the active workspace (admin).
// Thin wrapper over runGradePending; returns `remaining` so the client loops
// until 0. Graceful with an empty OPENAI_API_KEY (error row per call).
export async function POST() {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const workspace = await getServerWorkspace();
  try {
    const result = await runGradePending(workspace);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Grade-pending failed" },
      { status: 500 }
    );
  }
}
