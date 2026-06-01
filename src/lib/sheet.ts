// Client-side helpers for syncing call data to the Google Sheet.
// Both calls are fire-and-forget — a sheet failure must never block the UI.

export interface SheetCallPayload {
  callId: string;
  agentName: string;
  version?: number;
  direction: string;
  variables: Record<string, string>;
  user: string;
  timestamp: number;
}

/** Append a row for a call (called once, when the call ends). */
export async function logCallToSheet(payload: SheetCallPayload): Promise<void> {
  try {
    await fetch("/api/calls/log-sheet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // non-blocking
  }
}

/** Update grade + note on the existing row for a call. */
export async function patchCallGrade(
  callId: string,
  grade?: number,
  note?: string
): Promise<void> {
  try {
    await fetch("/api/calls/log-sheet", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callId, grade, note }),
    });
  } catch {
    // non-blocking
  }
}
