// Client-side helpers for persisting call data to the database.
// Both calls are fire-and-forget — a logging failure must never block the UI.

export interface LogCallPayload {
  callId: string;
  agentName: string;
  version?: number;
  direction: string;
  variables: Record<string, string>;
  user: string;
  timestamp: number;
}

/** Record a call (called once, when the call ends). */
export async function logCall(payload: LogCallPayload): Promise<void> {
  try {
    await fetch("/api/calls/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // non-blocking
  }
}

/** Update grade + note on an existing call record. */
export async function patchCallGrade(
  callId: string,
  grade?: number,
  note?: string
): Promise<void> {
  try {
    await fetch("/api/calls/log", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callId, grade, note }),
    });
  } catch {
    // non-blocking
  }
}
