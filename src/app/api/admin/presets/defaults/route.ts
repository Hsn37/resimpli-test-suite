import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import {
  countPresetsOverriding,
  deletePresetDefault,
  listPresetDefaults,
  upsertPresetDefault,
} from "@/lib/db";
import { CALL_TYPES, validateDefaultKey } from "@/lib/testPreset";

/** Shared guard: a usable call type + variable name, or a 400 explaining why not. */
function checkTarget(callType: string, key: string) {
  if (!CALL_TYPES.includes(callType)) {
    return NextResponse.json(
      { error: `callType must be one of ${CALL_TYPES.join(", ")}` },
      { status: 400 }
    );
  }
  const problem = validateDefaultKey(key);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  return null;
}

// Add or edit one default variable. Every case for that call type picks the
// change up on its next read — presets store overrides, not composed variables,
// so there is nothing to backfill.
export async function PATCH(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const callType = String(body.callType ?? "");
    const key = String(body.key ?? "").trim();
    const value = typeof body.value === "string" ? body.value : "";

    const invalid = checkTarget(callType, key);
    if (invalid) return invalid;

    await upsertPresetDefault(callType, key, value);
    return NextResponse.json({ defaults: await listPresetDefaults() });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to save default";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Remove a default variable. Cases that override it would be left pointing at
// a key that no longer exists, so the count is reported first and the caller
// has to opt in with ?force=1.
export async function DELETE(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  try {
    const { searchParams } = new URL(request.url);
    const callType = searchParams.get("callType") ?? "";
    const key = (searchParams.get("key") ?? "").trim();
    const force = searchParams.get("force") === "1";

    const invalid = checkTarget(callType, key);
    if (invalid) return invalid;

    const overriding = await countPresetsOverriding(callType, key);
    if (overriding > 0 && !force) {
      return NextResponse.json(
        {
          error: `${overriding} active ${callType} case${overriding === 1 ? "" : "s"} override "${key}"`,
          overriding,
        },
        { status: 409 }
      );
    }

    await deletePresetDefault(callType, key);
    return NextResponse.json({ defaults: await listPresetDefaults(), overriding });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to remove default";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
