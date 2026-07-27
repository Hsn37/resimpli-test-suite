import "server-only";
import { cookies } from "next/headers";
import { isSessionAdmin } from "./admin";
import {
  DEFAULT_WORKSPACE,
  WORKSPACE_COOKIE,
  isWorkspace,
  type Workspace,
} from "./workspace";

// retellKeyForWorkspace lives in the Clerk-free ./retellKeys leaf (so importing
// just the key resolver doesn't drag in this module's Clerk/cookies deps).
// Re-exported here so existing importers of workspaceServer keep working.
export { retellKeyForWorkspace } from "./retellKeys";

/**
 * Active workspace for the current request, read from the `ws` cookie and
 * validated with the shared guard. Falls back to DEFAULT_WORKSPACE ("dev")
 * for missing/invalid cookies.
 *
 * Access model (Build 8): non-admins are locked to "dev"; the production
 * workspaces (real Retell accounts) are admin-only. Defense-in-depth server
 * pin: only admins may select a non-default workspace. For non-admins we ignore
 * any hand-set `ws` cookie and force DEFAULT_WORKSPACE ("dev"), so a normal
 * user can't read a production workspace's data/key by editing their cookie.
 * Admins keep the chooser/switcher across all. The admin lookup is skipped when
 * the cookie already resolves to the default ("dev"), so the common
 * (non-admin, hot) path never pays for a Clerk round-trip.
 */
export async function getServerWorkspace(): Promise<Workspace> {
  const value = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  const requested = isWorkspace(value) ? value : DEFAULT_WORKSPACE;
  if (requested === DEFAULT_WORKSPACE) return requested;
  // Non-default (a production workspace) requested — only honor it for admins.
  return (await isSessionAdmin()) ? requested : DEFAULT_WORKSPACE;
}
