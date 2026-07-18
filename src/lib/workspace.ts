// Workspace dimension for the call-grader tables. Every grader row is scoped to
// a workspace so dev traffic never mixes with prod. Kept separate from db.ts so
// API routes / UI can import the type + guard without pulling in "server-only".

export type Workspace = "dev" | "prod";

export const WORKSPACES: readonly Workspace[] = ["dev", "prod"] as const;

// Safe default: non-admins are locked to "dev"; "prod" (real migrated
// production data) is reachable only by an explicit admin choice. Admin-only
// access is enforced server-side in getServerWorkspace() and client-side in
// WorkspaceProvider — this constant is just the fallback landing workspace.
export const DEFAULT_WORKSPACE: Workspace = "dev";

// Cookie the client writes when an admin picks/switches workspace. Lives here
// (not in the server-only helper) so the client provider and the server
// resolver share one source of truth for the name.
export const WORKSPACE_COOKIE = "ws";

/** Narrowing guard for untrusted input (query params, headers, request bodies). */
export function isWorkspace(value: unknown): value is Workspace {
  return typeof value === "string" && (WORKSPACES as readonly string[]).includes(value);
}
