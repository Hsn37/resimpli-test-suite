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

// Per-workspace Retell keys. Each workspace MUST have its own key — there is no
// shared fallback, so a workspace can never silently borrow another's account
// (e.g. prod falling back to a RETELL_API_KEY that holds the dev key).
const RETELL_KEY_ENV: Record<Workspace, string> = {
  prod: "RETELL_PROD_KEY",
  dev: "RETELL_DEV_KEY",
};

/**
 * Retell API key for a workspace, from its dedicated env var. Throws when the
 * workspace's key isn't configured (no cross-workspace fallback).
 */
export function retellKeyForWorkspace(workspace: Workspace): string {
  const key = process.env[RETELL_KEY_ENV[workspace]];
  if (!key) {
    throw new Error(
      `No Retell key configured for workspace "${workspace}" (set ${RETELL_KEY_ENV[workspace]})`
    );
  }
  return key;
}
