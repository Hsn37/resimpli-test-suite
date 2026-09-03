import type { Workspace } from "./workspace";

// Cross-workspace call lookup: the client half of /api/calls/search, plus the
// call-ID shape both it and the /calls search box match against.

// Retell call IDs are `call_` followed by an alphanumeric token. Used to detect
// when a search query is an exact ID worth fetching straight from Retell.
export const CALL_ID_RE = /^call_[a-zA-Z0-9]+$/;

/** A call located in one of the workspaces the session may read. */
export interface CallSearchHit {
  call_id: string;
  workspace: Workspace;
  agent_name: string | null;
  start_timestamp: number | null;
  call_status: string | null;
}

/**
 * Find a call by ID across every workspace the session may read (all of them
 * for an admin, "dev" alone otherwise). Throws with the API's message when the
 * ID matches nothing, so callers can render it as-is.
 */
export async function searchCall(callId: string): Promise<CallSearchHit> {
  const res = await fetch(`/api/calls/search?call_id=${encodeURIComponent(callId)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Failed to search for call");
  return data as CallSearchHit;
}
