import "server-only";
import { getAppConfig } from "./db";
import { APP_CONFIG_KEYS } from "./graderRubric";
import type { Workspace } from "./workspace";

// Automation constants + guards shared by the cron tick and the voice-sync
// route. The tick itself calls the internal route handlers (backfill →
// grade-pending → periodic voice-sync) so it reuses the exact same code paths.

export const BACKFILL_CURSOR_KEY = "backfill_cursor";
export const LAST_VOICE_SYNC_KEY = "last_voice_sync_at";
export const VOICE_SYNC_INTERVAL_MS = 60 * 60 * 1000; // opportunistic, hourly
export const CRON_SECRET_HEADER = "x-cron-secret";
export const VERCEL_CRON_HEADER = "x-vercel-cron";
const CRON_SECRET_ENV = "CRON_SECRET";

/** Whether automation is enabled for a workspace (default true unless === false). */
export async function isAutomationEnabled(workspace: Workspace): Promise<boolean> {
  const v = await getAppConfig<boolean>(workspace, APP_CONFIG_KEYS.automationEnabled);
  return v !== false;
}

/** Whether the initial Retell backfill is complete for a workspace. */
export async function isBackfillComplete(workspace: Workspace): Promise<boolean> {
  const [complete, cursor] = await Promise.all([
    getAppConfig<boolean>(workspace, APP_CONFIG_KEYS.backfillComplete),
    getAppConfig<string>(workspace, BACKFILL_CURSOR_KEY),
  ]);
  return complete === true && !cursor;
}

/** Whether the hourly opportunistic voice sync is due for a workspace. */
export async function isVoiceSyncDue(workspace: Workspace): Promise<boolean> {
  const last = await getAppConfig<number | string>(workspace, LAST_VOICE_SYNC_KEY);
  const lastMs = typeof last === "number" ? last : typeof last === "string" ? Date.parse(last) : 0;
  return !lastMs || Date.now() - lastMs > VOICE_SYNC_INTERVAL_MS;
}

/**
 * Guard the cron route: allow either a matching CRON_SECRET header/query, or the
 * Vercel cron header (which Vercel sets on scheduled invocations). When
 * CRON_SECRET is unset we still require the Vercel header, so the route is never
 * publicly triggerable by default.
 */
export function isCronAuthorized(headers: Headers, secretParam: string | null): boolean {
  if (headers.get(VERCEL_CRON_HEADER)) return true;
  const secret = process.env[CRON_SECRET_ENV];
  if (!secret) return false;
  const provided = headers.get(CRON_SECRET_HEADER) ?? secretParam;
  return provided === secret;
}
