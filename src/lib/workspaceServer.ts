import "server-only";
import { cookies } from "next/headers";
import { isSessionAdmin } from "./admin";
import {
  DEFAULT_WORKSPACE,
  WORKSPACE_COOKIE,
  WORKSPACES,
  isWorkspace,
  type Workspace,
} from "./workspace";

// retellKeyForWorkspace lives in the Clerk-free ./retellKeys leaf (so importing
// just the key resolver doesn't drag in this module's Clerk/cookies deps).
// Re-exported here so existing importers of workspaceServer keep working.
export { retellKeyForWorkspace } from "./retellKeys";

/**
 * Whether the current session may access a given workspace's data.
 *
 * Access model (Build 8): non-admins are locked to "dev"; the production
 * workspaces (real Retell accounts) are admin-only. "dev" is open to every
 * signed-in user; `isSessionAdmin()` is short-circuited away entirely for
 * that case, so the common (non-admin, hot) path never pays for a Clerk
 * round-trip.
 */
export async function isWorkspaceAuthorized(workspace: Workspace): Promise<boolean> {
  return workspace === DEFAULT_WORKSPACE || (await isSessionAdmin());
}

/**
 * Every workspace the current session may read, in WORKSPACES order. Same
 * access model as isWorkspaceAuthorized(), just enumerated: admins get all of
 * them, everyone else only "dev". Used by lookups that fan out across
 * workspaces (call search) so the model stays defined in one place.
 */
export async function getAuthorizedWorkspaces(): Promise<readonly Workspace[]> {
  return (await isSessionAdmin()) ? WORKSPACES : [DEFAULT_WORKSPACE];
}

/**
 * Active workspace for the current request, read from the `ws` cookie and
 * validated with the shared guard. Falls back to DEFAULT_WORKSPACE ("dev")
 * for missing/invalid cookies, or when the requester isn't authorized for
 * the non-default workspace they asked for (a normal user can't read a
 * production workspace's data/key by hand-editing their cookie).
 */
export async function getServerWorkspace(): Promise<Workspace> {
  const value = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  const requested = isWorkspace(value) ? value : DEFAULT_WORKSPACE;
  return (await isWorkspaceAuthorized(requested)) ? requested : DEFAULT_WORKSPACE;
}
