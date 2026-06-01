import { NextRequest, NextResponse } from "next/server";
import { google, sheets_v4 } from "googleapis";
import { getCall } from "@/lib/retell";
import { gradeToScore } from "@/lib/grade";

// Columns: A=time B=call_id C=agent D=direction E=variables F=recording G=transcript H=grade I=notes J=user

const SHEET_NAME = "Sheet1";
const MAX_CELL_CHARS = 49000; // Google Sheets hard limit is 50,000 per cell

// Resolve the sheets client + spreadsheet id, or null if env config is missing.
function getSheetsClient(): { sheets: sheets_v4.Sheets; sheetId: string } | null {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!email || !rawKey || !sheetId) return null;

  const auth = new google.auth.JWT({
    email,
    key: rawKey.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return { sheets: google.sheets({ version: "v4", auth }), sheetId };
}

// Neutralize formula/CSV injection: a cell starting with = + - @ is treated as
// a formula by Sheets, so prefix it with an apostrophe to force plain text.
// Also clamp to the per-cell character limit.
function safeCell(value: string): string {
  const clamped = value.length > MAX_CELL_CHARS ? value.slice(0, MAX_CELL_CHARS) : value;
  return /^[=+\-@]/.test(clamped) ? `'${clamped}` : clamped;
}

// Append a new row when a call ends.
export async function POST(req: NextRequest) {
  const { callId, agentName, version, direction, user, timestamp, variables } =
    await req.json();

  const client = getSheetsClient();
  if (!client) {
    return NextResponse.json({ error: "Missing Google Sheets config" }, { status: 500 });
  }
  const { sheets, sheetId } = client;

  // Fetch Retell call for recording + transcript (non-fatal if not ready yet).
  let recordingUrl = "";
  let transcript = "";
  try {
    const call = await getCall(callId);
    recordingUrl = call.recording_url ?? "";
    transcript = call.transcript ?? "";
  } catch {
    // log the row without these fields
  }

  const time = new Date(timestamp).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    dateStyle: "short",
    timeStyle: "short",
  });

  const agentStr = version ? `${agentName} (v${version})` : agentName;
  const variablesStr = variables
    ? Object.entries(variables as Record<string, string>)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ")
    : "";
  // We build the HYPERLINK formula ourselves, so it stays USER_ENTERED; escape
  // any quotes in the URL so they can't break out of the formula string.
  const recordingCell = recordingUrl
    ? `=HYPERLINK("${recordingUrl.replace(/"/g, "%22")}","Recording")`
    : "";

  const row = [
    time, // A
    callId, // B
    safeCell(agentStr), // C
    safeCell(direction ?? ""), // D
    safeCell(variablesStr), // E
    recordingCell, // F
    safeCell(transcript), // G
    gradeToScore(undefined), // H — graded later via PATCH
    "", // I — notes, added via PATCH
    safeCell(user ?? ""), // J
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `${SHEET_NAME}!A:J`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] },
  });

  return NextResponse.json({ ok: true });
}

// Update grade + note on an existing row matched by call_id (column B).
export async function PATCH(req: NextRequest) {
  const { callId, grade, note } = await req.json();

  const client = getSheetsClient();
  if (!client) {
    return NextResponse.json({ error: "Missing Google Sheets config" }, { status: 500 });
  }
  const { sheets, sheetId } = client;

  const lookup = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${SHEET_NAME}!B:B`,
  });

  const rows = lookup.data.values ?? [];
  const rowIndex = rows.findIndex((r) => r[0] === callId);
  if (rowIndex === -1) {
    return NextResponse.json({ error: "Call not found in sheet" }, { status: 404 });
  }

  const sheetRow = rowIndex + 1; // 1-based

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        { range: `${SHEET_NAME}!H${sheetRow}`, values: [[gradeToScore(grade)]] },
        { range: `${SHEET_NAME}!I${sheetRow}`, values: [[safeCell(note ?? "")]] },
      ],
    },
  });

  return NextResponse.json({ ok: true });
}
