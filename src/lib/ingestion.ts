import "server-only";
import { getCall as getRetellCall, getAgent as getRetellAgent } from "./retell";
import {
  upsertCall,
  upsertAgentVoice,
  getAppConfig,
  getAgentVoice,
  type UpsertCallInput,
} from "./db";
import { APP_CONFIG_KEYS } from "./graderRubric";
import { MIN_DURATION_SECONDS } from "./dashboard";
import type { Workspace } from "./workspace";

// Shared ingestion pipeline — the workspace-scoped port of the client's
// retell-webhook / backfill-calls / sync-agent-voices edge functions. The
// webhook, backfill, voice-sync and cron routes all reuse these helpers so the
// skip rules, row shape and voice cache behave identically everywhere (DRY).
//
// Grading itself lives in grading.ts (gradeAndStoreCall); this module only
// normalizes Retell payloads into `calls` rows + maintains the agent→voice cache.

// A single Retell call payload (webhook `call`, list-calls item, or get-call).
export type RetellCallPayload = Record<string, unknown>;

// ---------------------------------------------------------------------------
// app_config reads (workspace-scoped).
// ---------------------------------------------------------------------------

/** The agent-id allowlist for a workspace. Empty = no agent filter (all agents). */
export async function getAgentAllowlist(workspace: Workspace): Promise<string[]> {
  const v = await getAppConfig<unknown>(workspace, APP_CONFIG_KEYS.agentIdAllowlist);
  return Array.isArray(v) ? v.map(String) : [];
}

/** tracking_start_date (YYYY-MM-DD or ISO) as a Date, or null when unset/invalid. */
export async function getTrackingStartDate(workspace: Workspace): Promise<Date | null> {
  const v = await getAppConfig<string>(workspace, APP_CONFIG_KEYS.trackingStartDate);
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v.length === 10 ? `${v}T00:00:00.000Z` : v);
  return isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------------------
// Payload normalization (ports pickTimestamp / pickDuration / normalizeTranscript).
// ---------------------------------------------------------------------------

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Epoch ms for a call (start, else end, else now). */
export function pickTimestampMs(call: RetellCallPayload): number {
  const start = asNumber(call.start_timestamp);
  const end = asNumber(call.end_timestamp);
  if (start != null) return start;
  if (end != null) return end;
  return Date.now();
}

/** Duration in whole seconds, or null when it can't be derived. */
export function pickDuration(call: RetellCallPayload): number | null {
  const durationMs = asNumber(call.duration_ms);
  if (durationMs != null) return Math.round(durationMs / 1000);
  const start = asNumber(call.start_timestamp);
  const end = asNumber(call.end_timestamp);
  if (start != null && end != null) return Math.round((end - start) / 1000);
  return null;
}

interface TranscriptTurn {
  turn: number;
  role: string;
  content: string;
  words?: unknown;
}

/** Normalize Retell's transcript_object / transcript string into a turn list. */
export function normalizeTranscript(call: RetellCallPayload): TranscriptTurn[] {
  const obj = call.transcript_object;
  if (Array.isArray(obj)) {
    return obj.map((t: Record<string, unknown>, i: number) => ({
      turn: i + 1,
      role: typeof t.role === "string" ? t.role : "unknown",
      content: typeof t.content === "string" ? t.content : "",
      words: t.words,
    }));
  }
  if (typeof call.transcript === "string") {
    return [{ turn: 1, role: "transcript", content: call.transcript }];
  }
  return [];
}

function transcriptHasContent(turns: TranscriptTurn[]): boolean {
  return turns.some((t) => typeof t.content === "string" && t.content.trim().length > 0);
}

/** Retell call direction, defaulting through direction → call_type. */
export function callDirection(call: RetellCallPayload): string | undefined {
  if (typeof call.direction === "string" && call.direction) return call.direction;
  if (typeof call.call_type === "string" && call.call_type) return call.call_type;
  return undefined;
}

export function retellCallId(call: RetellCallPayload): string {
  if (typeof call.call_id === "string" && call.call_id) return call.call_id;
  if (typeof call.id === "string" && call.id) return call.id;
  return "";
}

/**
 * Normalize the authoritative appointment flag produced by Retell post-call
 * analysis. Retell custom fields normally live under
 * call_analysis.custom_analysis_data, but tolerate the other shapes returned
 * by older webhook/list-call payloads. Missing stays null; it must never be
 * treated as a successful booking.
 */
export function extractAppointmentBooked(call: RetellCallPayload): boolean | null {
  const analysis =
    call.call_analysis && typeof call.call_analysis === "object"
      ? (call.call_analysis as Record<string, unknown>)
      : {};
  const analysisCustom =
    analysis.custom_analysis_data && typeof analysis.custom_analysis_data === "object"
      ? (analysis.custom_analysis_data as Record<string, unknown>)
      : {};
  const postCall =
    call.post_call_analysis_data && typeof call.post_call_analysis_data === "object"
      ? (call.post_call_analysis_data as Record<string, unknown>)
      : {};
  const topLevelCustom =
    call.custom_analysis_data && typeof call.custom_analysis_data === "object"
      ? (call.custom_analysis_data as Record<string, unknown>)
      : {};

  const value =
    analysisCustom.appointment_booked ??
    analysis.appointment_booked ??
    postCall.appointment_booked ??
    topLevelCustom.appointment_booked ??
    call.appointment_booked;

  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Skip rules — the single source of truth for who gets ingested. Returns a skip
// reason string (counter key) when the call should be dropped, or null to keep.
// ---------------------------------------------------------------------------
export const SKIP = {
  missingCallId: "missing_call_id",
  agentNotAllowlisted: "agent_not_allowlisted",
  notInbound: "not_inbound",
  directionMissing: "direction_missing",
  beforeTrackingStart: "before_tracking_start",
  durationTooShort: "duration_too_short",
  emptyTranscript: "empty_transcript",
} as const;

export type SkipReason = (typeof SKIP)[keyof typeof SKIP];

/**
 * Apply the ingestion filters to a (possibly enriched) call payload. `direction`
 * missing is a soft signal — we still ingest but report it. Returns { skip } to
 * drop, or { skip: null, ... } with the derived fields to persist.
 */
export function evaluateCall(
  call: RetellCallPayload,
  allowlist: string[],
  trackingStart: Date | null
): {
  skip: SkipReason | null;
  directionMissing: boolean;
  timestampMs: number;
  duration: number | null;
  transcript: TranscriptTurn[];
  agentId: string;
} {
  const agentId = typeof call.agent_id === "string" ? call.agent_id : "";
  const timestampMs = pickTimestampMs(call);
  const duration = pickDuration(call);
  const transcript = normalizeTranscript(call);

  const base = { directionMissing: false, timestampMs, duration, transcript, agentId };

  if (!retellCallId(call)) return { skip: SKIP.missingCallId, ...base };
  if (allowlist.length > 0 && !allowlist.includes(agentId)) {
    return { skip: SKIP.agentNotAllowlisted, ...base };
  }

  const direction = callDirection(call);
  let directionMissing = false;
  if (direction) {
    if (direction.toLowerCase() !== "inbound") {
      return { skip: SKIP.notInbound, ...base };
    }
  } else {
    directionMissing = true; // fall through and ingest
  }

  if (trackingStart && timestampMs < trackingStart.getTime()) {
    return { skip: SKIP.beforeTrackingStart, ...base, directionMissing };
  }
  if (duration != null && duration < MIN_DURATION_SECONDS) {
    return { skip: SKIP.durationTooShort, ...base, directionMissing };
  }
  if (!transcriptHasContent(transcript)) {
    return { skip: SKIP.emptyTranscript, ...base, directionMissing };
  }

  return { skip: null, directionMissing, timestampMs, duration, transcript, agentId };
}

// ---------------------------------------------------------------------------
// Voice cache — port of _shared/voice.ts (displayVoiceName + lookupOrFetchVoice),
// workspace-scoped over our agent_voices table.
// ---------------------------------------------------------------------------

const VOICE_PROVIDER_PREFIX = /^(11labs|elevenlabs|retell|openai|play(ht)?|deepgram)-/i;
const VOICE_TRAILING_HEX = /\s+[a-f0-9]{12,}$/i;
const CUSTOM_VOICE_PREFIX = "custom_voice_";

/** Human-friendly voice name from a raw Retell voice_id. */
export function displayVoiceName(voiceId: string | null | undefined): string | null {
  if (!voiceId) return null;
  if (voiceId.startsWith(CUSTOM_VOICE_PREFIX)) return "Custom";
  const stripped = voiceId.replace(VOICE_PROVIDER_PREFIX, "");
  const cleaned = stripped.replace(VOICE_TRAILING_HEX, "").trim();
  return cleaned || voiceId;
}

/**
 * Resolve { voice_id, voice_name } for an agent from the workspace's cache; on a
 * miss, call Retell get-agent once (with the workspace key) and cache the result
 * — including a null row for deleted agents so we don't re-fetch every ingest.
 */
export async function lookupOrFetchVoice(
  workspace: Workspace,
  agentId: string | null | undefined,
  apiKey: string | undefined
): Promise<{ voice_id: string | null; voice_name: string | null }> {
  if (!agentId) return { voice_id: null, voice_name: null };

  const cached = await getAgentVoice(workspace, agentId);
  if (cached) return { voice_id: cached.voice_id, voice_name: cached.voice_name };

  if (!apiKey) return { voice_id: null, voice_name: null };

  let voiceId: string | null = null;
  let agentName: string | null = null;
  try {
    const agent = await getRetellAgent(agentId, apiKey);
    voiceId = typeof agent?.voice_id === "string" ? agent.voice_id : null;
    agentName = typeof agent?.agent_name === "string" ? agent.agent_name : null;
  } catch (e) {
    console.error("get-agent failed", agentId, e);
  }
  const voiceName = displayVoiceName(voiceId);
  await upsertAgentVoice({ workspace, agentId, voiceId, voiceName, agentName });
  return { voice_id: voiceId, voice_name: voiceName };
}

// ---------------------------------------------------------------------------
// Ingest one call — enrich (optional), filter, upsert. Shared by webhook +
// backfill. Returns the upserted call row id, or a skip reason.
// ---------------------------------------------------------------------------

export interface IngestResult {
  callRowId: string | null;
  skip: SkipReason | null;
  directionMissing: boolean;
}

function needsEnrichment(call: RetellCallPayload): boolean {
  const hasTranscriptObject =
    Array.isArray(call.transcript_object) && call.transcript_object.length > 0;
  return !call.recording_url || !hasTranscriptObject;
}

/**
 * Ingest a single call payload into `calls` for a workspace. Optionally enriches
 * via Retell get-call when the payload is thin (webhook path). Applies all skip
 * rules; on pass, upserts and returns the row id. Never grades — the caller
 * decides whether to fire gradeAndStoreCall.
 */
export async function ingestCall(opts: {
  workspace: Workspace;
  call: RetellCallPayload;
  allowlist: string[];
  trackingStart: Date | null;
  apiKey: string | undefined;
  enrich?: boolean;
  rawPayload?: unknown;
  // Manual "Grade call" path: ingest regardless of the inbound / allowlist /
  // tracking-start / duration filters (the user explicitly asked to grade this
  // call). Only a missing call id or an empty transcript still drop it, since
  // those make grading impossible.
  bypassEligibility?: boolean;
}): Promise<IngestResult> {
  const { workspace, allowlist, trackingStart, apiKey } = opts;
  let call = opts.call;

  // Enrich thin webhook payloads with the authoritative get-call record.
  if (opts.enrich && apiKey && retellCallId(call) && needsEnrichment(call)) {
    try {
      const full = await getRetellCall(retellCallId(call), apiKey);
      call = { ...call, ...full };
    } catch (e) {
      console.error("retell get-call enrich failed", retellCallId(call), e);
    }
  }

  const verdict = evaluateCall(call, allowlist, trackingStart);
  // In bypass mode only the un-gradeable skips (no id / empty transcript) block
  // ingestion; the derived fields are computed regardless of the skip verdict.
  const hardSkip =
    opts.bypassEligibility &&
    verdict.skip !== SKIP.missingCallId &&
    verdict.skip !== SKIP.emptyTranscript
      ? null
      : verdict.skip;
  if (hardSkip) {
    return { callRowId: null, skip: hardSkip, directionMissing: verdict.directionMissing };
  }

  const { voice_id, voice_name } = await lookupOrFetchVoice(workspace, verdict.agentId, apiKey);

  const row: UpsertCallInput = {
    workspace,
    retellCallId: retellCallId(call),
    agentId: verdict.agentId || null,
    agentVersion: call.agent_version != null ? String(call.agent_version) : null,
    timestamp: verdict.timestampMs,
    durationSeconds: verdict.duration,
    phoneNumber:
      (typeof call.from_number === "string" && call.from_number) ||
      (typeof call.caller_phone_number === "string" && call.caller_phone_number) ||
      null,
    transcript: verdict.transcript,
    dynamicVariables:
      (call.retell_llm_dynamic_variables as Record<string, unknown>) ??
      (call.dynamic_variables as Record<string, unknown>) ??
      {},
    recordingUrl: typeof call.recording_url === "string" ? call.recording_url : null,
    appointmentBooked: extractAppointmentBooked(call),
    latency: call.latency ?? (call.call_analysis as Record<string, unknown>)?.latency ?? null,
    voiceId: voice_id,
    voiceName: voice_name,
    rawPayload: opts.rawPayload ?? call,
  };

  const callRowId = await upsertCall(row);
  return { callRowId, skip: null, directionMissing: verdict.directionMissing };
}
