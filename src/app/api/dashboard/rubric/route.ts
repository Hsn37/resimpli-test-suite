import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  listFailureClasses,
  listRepDimensions,
  getAppConfig,
} from "@/lib/db";
import { getServerWorkspace } from "@/lib/workspaceServer";
import { APP_CONFIG_KEYS } from "@/lib/graderRubric";

// Failure classes + rep dimensions + tracking_start_date for the active
// workspace. Drives the dashboard's cycle anchor, leaderboard, filters and the
// call-detail scorecard. Read-only, any signed-in user.
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspace = await getServerWorkspace();
  const [failureClasses, repDimensions, trackingStartDate] = await Promise.all([
    listFailureClasses(workspace),
    listRepDimensions(workspace),
    getAppConfig<string>(workspace, APP_CONFIG_KEYS.trackingStartDate),
  ]);

  return NextResponse.json({
    failureClasses: failureClasses.filter((c) => c.active),
    repDimensions: repDimensions.filter((d) => d.active),
    trackingStartDate: trackingStartDate ?? null,
  });
}
