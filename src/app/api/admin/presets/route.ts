import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import {
  getTestPresetRecord,
  listPresetDefaults,
  listTestPresetRecords,
  nextTestNo,
  upsertTestPresetRecord,
} from "@/lib/db";
import { presetId, toTestPresetInput, validateTestPreset } from "@/lib/testPreset";

// Raw records (overrides, not composed variables) plus the defaults they
// compose against — what the admin editor needs to render and diff a case.
export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  try {
    const [defaults, records] = await Promise.all([
      listPresetDefaults(),
      listTestPresetRecords(true),
    ]);
    return NextResponse.json({ records, defaults });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load test presets";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Create a case. `test_no` is optional — omit it and the next free number is
// allocated. Numbers are never reused, so old QA sheets keep resolving.
export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const requested = Number(body.test_no);
    const testNo =
      Number.isInteger(requested) && requested > 0 ? requested : await nextTestNo();

    if (await getTestPresetRecord(presetId(testNo))) {
      return NextResponse.json({ error: `${presetId(testNo)} already exists` }, { status: 409 });
    }

    const defaults = await listPresetDefaults();
    const input = toTestPresetInput(body, testNo);
    const errors = validateTestPreset(input, defaults);
    if (errors.length > 0) {
      return NextResponse.json({ error: errors[0], errors }, { status: 400 });
    }

    const record = await upsertTestPresetRecord(
      { ...input, active: true },
      admin.email,
      "create"
    );
    return NextResponse.json({ record });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create test preset";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
