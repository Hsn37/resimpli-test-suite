import "server-only";
import type { Workspace } from "./workspace";

// Per-workspace Retell key resolution. Split out of workspaceServer.ts so it can
// be imported WITHOUT pulling in that module's request-scoped Clerk/cookies deps
// (getServerWorkspace → admin.ts → @clerk/nextjs/server, which transitively
// imports next/navigation and only loads under the Next/React runtime). This
// leaf is pure env reading, so the grading/ingestion server libs — and scripts
// running them under `--conditions=react-server` — stay node-runnable.
// workspaceServer.ts re-exports retellKeyForWorkspace, so existing importers of
// it are unaffected.

// Per-workspace Retell keys. Fall back to the shared RETELL_API_KEY (what the
// app used before workspaces existed) so nothing breaks when only one key is set.
const RETELL_KEY_ENV: Record<Workspace, string> = {
  prod: "RETELL_PROD_KEY",
  dev: "RETELL_DEV_KEY",
};
const RETELL_FALLBACK_KEY_ENV = "RETELL_API_KEY";

/**
 * Retell API key for a workspace: the workspace-specific key if set, else the
 * shared RETELL_API_KEY. Throws only when nothing is configured at all.
 */
export function retellKeyForWorkspace(workspace: Workspace): string {
  const key =
    process.env[RETELL_KEY_ENV[workspace]] || process.env[RETELL_FALLBACK_KEY_ENV];
  if (!key) {
    throw new Error(
      `No Retell key configured for workspace "${workspace}" (set ${RETELL_KEY_ENV[workspace]} or ${RETELL_FALLBACK_KEY_ENV})`
    );
  }
  return key;
}
