import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getDashboardCallDetail } from "@/lib/db";
import { getServerWorkspace } from "@/lib/workspaceServer";

// Full call + grade for the detail view (workspace-scoped). Any signed-in user.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const workspace = await getServerWorkspace();
  const call = await getDashboardCallDetail(workspace, id);
  if (!call) return NextResponse.json({ error: "Call not found" }, { status: 404 });
  return NextResponse.json(call);
}
