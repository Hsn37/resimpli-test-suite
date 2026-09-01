import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import {
  getTestPresetRecord,
  listPresetDefaults,
  setTestPresetActive,
  upsertTestPresetRecord,
} from "@/lib/db";
import { toTestPresetInput, validateTestPreset } from "@/lib/testPreset";

// Update a case. The id is derived from test_no, so renumbering is not an edit
// — a case keeps its number for life (QA sheets and call notes cite it).
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  try {
    const { id } = await params;
    const existing = await getTestPresetRecord(id);
    if (!existing) {
      return NextResponse.json({ error: `${id} not found` }, { status: 404 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    if (body.test_no !== undefined && Number(body.test_no) !== existing.test_no) {
      return NextResponse.json(
        { error: "test_no is immutable — retire this case and create a new one" },
        { status: 400 }
      );
    }

    const defaults = await listPresetDefaults();
    const input = toTestPresetInput(body, existing.test_no);
    const errors = validateTestPreset(input, defaults);
    if (errors.length > 0) {
      return NextResponse.json({ error: errors[0], errors }, { status: 400 });
    }

    const record = await upsertTestPresetRecord(
      { ...input, active: body.active !== false },
      admin.email,
      "update"
    );
    return NextResponse.json({ record });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update test preset";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Retire a case. Soft delete only — the row stays so its number is never
// reused and its revision history stays readable.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  try {
    const { id } = await params;
    const record = await setTestPresetActive(id, false, admin.email);
    if (!record) {
      return NextResponse.json({ error: `${id} not found` }, { status: 404 });
    }
    return NextResponse.json({ record });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retire test preset";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
