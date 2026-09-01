import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { listTestPresetRecords } from "@/lib/db";
import { buildQaSheetCsv, toExchange } from "@/lib/presetImport";

const FORMAT_JSON = "json";
const FORMAT_CSV = "csv";

/**
 * Download the case library.
 *
 * ?format=json  the interchange shape — the same thing the import accepts, so
 *               an export can be committed as an archive and pasted back.
 * ?format=csv   the QA-sheet column layout the testers work in.
 * ?from= &to=   optional inclusive test-number range.
 */
export async function GET(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  try {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get("format") === FORMAT_CSV ? FORMAT_CSV : FORMAT_JSON;
    const from = Number(searchParams.get("from"));
    const to = Number(searchParams.get("to"));
    const includeRetired = searchParams.get("includeRetired") === "1";

    const records = (await listTestPresetRecords(includeRetired)).filter(
      (record) =>
        (!Number.isFinite(from) || record.test_no >= from) &&
        (!Number.isFinite(to) || record.test_no <= to)
    );

    const range =
      Number.isFinite(from) || Number.isFinite(to)
        ? `_T-${Number.isFinite(from) ? from : "start"}_to_T-${Number.isFinite(to) ? to : "end"}`
        : "";

    if (format === FORMAT_CSV) {
      return new NextResponse(buildQaSheetCsv(records), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="qa_sheet${range}.csv"`,
        },
      });
    }

    // group_order preserves first-appearance order, matching how the picker
    // groups the cases.
    const payload = {
      group_order: [...new Set(records.map((r) => r.group_name))],
      tests: records.map(toExchange),
    };
    return new NextResponse(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="test_cases${range}.json"`,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Export failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
