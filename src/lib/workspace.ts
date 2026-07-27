// Workspace dimension for the call-grader tables. Every grader row is scoped to
// a workspace so dev traffic never mixes with prod. Kept separate from db.ts so
// API routes / UI can import the type + guard without pulling in "server-only".

// One workspace per Retell account. "prod" is the inbound production account —
// the id predates the outbound/stl accounts and is kept as-is so existing rows
// (stamped `workspace = 'prod'`) stay valid.
export type Workspace = "dev" | "prod" | "outbound" | "stl";

export const WORKSPACES: readonly Workspace[] = ["dev", "prod", "outbound", "stl"] as const;

// Display copy + capability flags per workspace. Lives here rather than in the
// client provider so server code (cron) and the UI share one source of truth;
// the lucide icons stay in WorkspaceProvider, out of server-imported modules.
//
// hasDashboard marks workspaces whose call-grader dashboard is live. Outbound
// and Speed to Lead use the same app for test calls / agents / batch tests, but
// their dashboards aren't set up yet: the page shows a placeholder and the cron
// skips them, so nothing is ingested or graded for them.
export const WORKSPACE_META: Record<
  Workspace,
  { label: string; blurb: string; hasDashboard: boolean }
> = {
  dev: { label: "Dev", blurb: "Development sandbox", hasDashboard: true },
  prod: { label: "Inbound", blurb: "Live inbound production", hasDashboard: true },
  outbound: { label: "Outbound", blurb: "Live outbound production", hasDashboard: false },
  stl: { label: "Speed to Lead", blurb: "Live speed-to-lead production", hasDashboard: false },
};

/** Workspaces the dashboard/ingestion pipeline runs for (the cron iterates these). */
export const DASHBOARD_WORKSPACES: readonly Workspace[] = WORKSPACES.filter(
  (w) => WORKSPACE_META[w].hasDashboard
);

// Safe default: non-admins are locked to "dev"; every production workspace
// (real Retell accounts) is reachable only by an explicit admin choice.
// Admin-only access is enforced server-side in getServerWorkspace() and
// client-side in WorkspaceProvider — this constant is just the fallback
// landing workspace.
export const DEFAULT_WORKSPACE: Workspace = "dev";

// Cookie the client writes when an admin picks/switches workspace. Lives here
// (not in the server-only helper) so the client provider and the server
// resolver share one source of truth for the name.
export const WORKSPACE_COOKIE = "ws";

/** Narrowing guard for untrusted input (query params, headers, request bodies). */
export function isWorkspace(value: unknown): value is Workspace {
  return typeof value === "string" && (WORKSPACES as readonly string[]).includes(value);
}
