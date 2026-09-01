import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { listPresetDefaults, listTestPresetRecords } from "@/lib/db";
import { composePreset } from "@/lib/testPreset";

// Composed, active test presets for the Call Setup picker: base defaults for
// each case's call type plus its overrides. Open to every signed-in tester —
// only writes are admin-gated, over in /api/admin/presets.
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [defaults, records] = await Promise.all([
      listPresetDefaults(),
      listTestPresetRecords(),
    ]);
    return NextResponse.json({
      presets: records.map((record) => composePreset(record, defaults)),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load test presets";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
