import "server-only";
import { timingSafeEqual } from "node:crypto";
import { getAppConfig, setAppConfig } from "./db";
import { APP_CONFIG_KEYS } from "./graderRubric";
import type { Workspace } from "./workspace";

// Automation constants + guards shared by the cron tick and the voice-sync
// route. The tick itself calls the internal route handlers (backfill →
// grade-pending → periodic voice-sync) so it reuses the exact same code paths.

export const BACKFILL_CURSOR_KEY = "backfill_cursor";
export const LAST_VOICE_SYNC_KEY = "last_voice_sync_at";
export const LAST_TICK_KEY = "last_tick_at";
export const VOICE_SYNC_INTERVAL_MS = 60 * 60 * 1000; // opportunistic, hourly
export const CRON_SECRET_HEADER = "x-cron-secret";
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
 * Guard the cron route: the caller must present CRON_SECRET, as
 * `Authorization: Bearer <secret>` (what Vercel Cron sends), an
 * `x-cron-secret` header, or a `?secret=` query param. With CRON_SECRET unset
 * nothing is authorized. There is deliberately no header-only bypass: an
 * `x-vercel-cron` header can be sent by anyone, and each tick now pulls
 * several MB from Retell per workspace.
 */
export function isCronAuthorized(headers: Headers, secretParam: string | null): boolean {
  const secret = process.env[CRON_SECRET_ENV];
  if (!secret) return false;
  const bearer = headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const provided = bearer ?? headers.get(CRON_SECRET_HEADER) ?? secretParam;
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Stamp the last time the cron tick touched this workspace (epoch ms). */
export async function recordTick(workspace: Workspace): Promise<void> {
  await setAppConfig(workspace, LAST_TICK_KEY, Date.now());
}

/** Epoch ms of the last cron tick for a workspace, or null if never ticked. */
export async function getLastTickAt(workspace: Workspace): Promise<number | null> {
  const v = await getAppConfig<number | string>(workspace, LAST_TICK_KEY);
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const parsed = Date.parse(v);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}
