import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import {
  listPresetDefaults,
  listTestPresetRecords,
  upsertTestPresetRecord,
} from "@/lib/db";
import { fromExchange } from "@/lib/presetImport";
import { presetId, validateTestPreset, type TestPresetInput } from "@/lib/testPreset";

interface RowResult {
  index: number;
  id: string;
  test_no: number;
  scenario: string;
  action: "create" | "update";
  errors: string[];
}

/**
 * Bulk import. Always validates every row and returns a per-row verdict;
 * `apply` is what turns the preview into writes. Rows with errors are never
 * written — the response names them so the caller can fix and re-paste.
 */
export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  try {
    const body = (await request.json()) as { tests?: unknown; apply?: boolean };
    if (!Array.isArray(body.tests)) {
      return NextResponse.json({ error: "tests must be an array" }, { status: 400 });
    }

    const [defaults, existing] = await Promise.all([
      listPresetDefaults(),
      listTestPresetRecords(true),
    ]);
    const existingNos = new Set(existing.map((r) => r.test_no));
    let nextNo = existing.reduce((max, r) => Math.max(max, r.test_no), 0) + 1;

    // Numbers claimed earlier in this batch, so two auto-allocated rows in the
    // same paste can't land on the same number.
    const claimed = new Set<number>();
    const results: RowResult[] = [];
    const inputs: TestPresetInput[] = [];

    body.tests.forEach((raw, index) => {
      const row = (raw ?? {}) as Record<string, unknown>;
      const requested = Number(row.test_no);
      const hasNumber = Number.isInteger(requested) && requested > 0;
      let testNo: number;
      if (hasNumber) {
        testNo = requested;
      } else {
        while (existingNos.has(nextNo) || claimed.has(nextNo)) nextNo++;
        testNo = nextNo;
      }
      const duplicate = claimed.has(testNo);
      claimed.add(testNo);

      const input = fromExchange(row, testNo);
      const errors = validateTestPreset(input, defaults);
      if (duplicate) {
        errors.push(`duplicate test_no ${testNo} within this import`);
      }
      inputs.push(input);
      results.push({
        index,
        id: presetId(testNo),
        test_no: testNo,
        scenario: input.scenario,
        action: existingNos.has(testNo) ? "update" : "create",
        errors,
      });
    });

    const valid = results.filter((r) => r.errors.length === 0);
    if (!body.apply) {
      return NextResponse.json({
        applied: false,
        results,
        validCount: valid.length,
        invalidCount: results.length - valid.length,
      });
    }

    for (const result of valid) {
      await upsertTestPresetRecord(
        { ...inputs[result.index], active: true },
        admin.email,
        "import"
      );
    }
    return NextResponse.json({
      applied: true,
      results,
      validCount: valid.length,
      invalidCount: results.length - valid.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Import failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
