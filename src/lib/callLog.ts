import type { CallRowGrade } from "./callGrade";

// Client-side helpers for persisting call data to the database.
// Both calls are fire-and-forget — a logging failure must never block the UI.

export interface LogCallPayload {
  callId: string;
  agentId: string;
  agentName: string;
  version?: number;
  direction: string;
  variables: Record<string, string>;
  user: string;
  timestamp: number;
  duration: number;
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

/**
 * Manually trigger the unified 0-100 AI grader for a call. Unlike the helpers
 * above, this throws on failure — callers drive a loading/error UI off it (the
 * "Grade call" button), so it can't be fire-and-forget. Resolves to the row
 * grade fields (rep_score + grade + AI note + full call_grades for the modal).
 */
export async function gradeCall(callId: string): Promise<CallRowGrade> {
  const res = await fetch(`/api/calls/${callId}/grade`, { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Failed to grade call");
  }
  return data as CallRowGrade;
}
