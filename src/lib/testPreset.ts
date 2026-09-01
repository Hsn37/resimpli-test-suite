// Shared, client-safe types + validation for live-call test presets (the "test
// cases" a tester picks in Call Setup). Kept out of db.ts (which is
// "server-only") so the admin editor, the API route and the migration script
// all share one validator.
//
// A preset is stored as OVERRIDES ONLY, never as composed variables:
//     variables = preset_defaults[callType] + overrides
// so adding a variable in the Defaults tab propagates to every case for that
// call type with no backfill. An override VALUE of null deletes the key from
// the payload entirely, staging an ABSENT variable rather than a blank one
// (T-130 / T-135 / T-140 rely on this for the "offer switch absent" cases).

import { CALL_MODES, type TestPreset } from "./presets";

export const PRIORITIES = ["P0", "P1", "P2", "Obs"] as const;
export const AGENT_SCOPES = ["Inbound", "Outbound", "STL", "Any"] as const;
export const AGENT_CONFIGS = ["Default", "Variant"] as const;

// Call types are the CALL_MODES keys (each mode's callType equals its key), so
// the two can't drift apart.
export const CALL_TYPES = Object.keys(CALL_MODES) as readonly string[];

// Variables the Retell agent builds for itself at call time — section_* by the
// setup_* code tools, edv_* by the sync_known_info extractor. Staging either
// would overwrite what the agent generates, so they are rejected on write in
// both the Defaults tab and imports.
export const RESERVED_VAR_PREFIXES = ["section_", "edv_"] as const;

// Locked because Call Setup pins it from the selected direction; a default row
// for it exists per call type but must never be edited or overridden.
export const LOCKED_VAR_KEY = "call_type";

/** null = stage this variable as ABSENT (deleted from the payload). */
export type OverrideValue = string | null;

/** Per-call-type variable defaults: callType -> key -> value. */
export type PresetDefaults = Record<string, Record<string, string>>;

export interface TestPresetRecord {
  id: string; // "T-142" — derived from test_no, 1-1 with the QA sheet row
  test_no: number;
  scenario: string;
  group_name: string;
  agent_scope: string;
  call_type: string;
  priority: string;
  high_risk: boolean;
  needs_lead_profile: boolean;
  agent_config: string;
  setup: string;
  sheet_what_to_say: string;
  sheet_what_to_watch_for: string;
  overrides: Record<string, OverrideValue>;
  user_messages: string[];
  expected_path: string;
  expected_behavior: string;
  sample: string;
  tester_notes: string;
  active: boolean;
  updated_by: string;
  updated_at: number;
}

export type TestPresetInput = Omit<TestPresetRecord, "id" | "active" | "updated_by" | "updated_at">;

/** Canonical id for a test number. Matches make_presets.py's `T-{n:02d}`. */
export function presetId(testNo: number): string {
  return `T-${String(testNo).padStart(2, "0")}`;
}

// Retell dynamic-variable names: letters, digits, underscores, leading letter.
// Case-sensitive on purpose — the base carries `Agent_Name` alongside snake_case.
export const VAR_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

export function isReservedVarKey(key: string): boolean {
  return RESERVED_VAR_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function emptyTestPresetInput(testNo: number, callType = "inbound"): TestPresetInput {
  return {
    test_no: testNo,
    scenario: "",
    group_name: "",
    agent_scope: "Inbound",
    call_type: callType,
    priority: "P1",
    high_risk: false,
    needs_lead_profile: false,
    agent_config: "Default",
    setup: "",
    sheet_what_to_say: "",
    sheet_what_to_watch_for: "",
    overrides: {},
    user_messages: [],
    expected_path: "",
    expected_behavior: "",
    sample: "",
    tester_notes: "",
  };
}

/**
 * Validate one case against the current defaults. Returns a list of
 * human-readable problems — empty means valid. Mirrors (and extends) the
 * hard-fails make_presets.py used to perform at generation time.
 */
export function validateTestPreset(
  input: TestPresetInput,
  defaults: PresetDefaults
): string[] {
  const errors: string[] = [];

  if (!Number.isInteger(input.test_no) || input.test_no < 1) {
    errors.push("test_no must be a positive integer");
  }
  if (!input.scenario.trim()) errors.push("scenario is required");
  if (!input.group_name.trim()) errors.push("group is required");
  if (!(PRIORITIES as readonly string[]).includes(input.priority)) {
    errors.push(`priority must be one of ${PRIORITIES.join(", ")}`);
  }
  if (!(AGENT_SCOPES as readonly string[]).includes(input.agent_scope)) {
    errors.push(`agent must be one of ${AGENT_SCOPES.join(", ")}`);
  }
  if (!(AGENT_CONFIGS as readonly string[]).includes(input.agent_config)) {
    errors.push(`agent config must be one of ${AGENT_CONFIGS.join(", ")}`);
  }
  if (!CALL_TYPES.includes(input.call_type)) {
    errors.push(`callType must be one of ${CALL_TYPES.join(", ")}`);
    return errors; // no base to validate the overrides against
  }
  if (!Array.isArray(input.user_messages) || input.user_messages.some((m) => typeof m !== "string")) {
    errors.push("userMessages must be a list of strings");
  }

  const base = defaults[input.call_type] ?? {};
  for (const [key, value] of Object.entries(input.overrides)) {
    if (isReservedVarKey(key)) {
      errors.push(`"${key}" is generated by the agent at call time and cannot be staged`);
    } else if (key === LOCKED_VAR_KEY) {
      errors.push(`"${LOCKED_VAR_KEY}" is set by the call direction and cannot be overridden`);
    } else if (!(key in base)) {
      errors.push(`"${key}" is not a ${input.call_type} default — add it in the Defaults tab first`);
    }
    if (value !== null && typeof value !== "string") {
      errors.push(`"${key}" must be a string, or null to stage it as absent`);
    }
  }
  return errors;
}

/**
 * Compose the runtime preset a tester sees: base defaults for the call type,
 * plus the case's overrides, with null overrides deleting the key. Same
 * composition make_presets.py performed at build time.
 */
export function composePreset(
  record: TestPresetRecord,
  defaults: PresetDefaults
): TestPreset {
  const variables: Record<string, string> = { ...(defaults[record.call_type] ?? {}) };
  for (const [key, value] of Object.entries(record.overrides)) {
    if (value === null) delete variables[key];
    else variables[key] = value;
  }
  return {
    id: record.id,
    name: `#${String(record.test_no).padStart(2, "0")} · ${record.scenario}`,
    group: record.group_name,
    callType: record.call_type,
    agentScope: record.agent_scope,
    priority: record.priority,
    highRisk: record.high_risk,
    needsLeadProfile: record.needs_lead_profile,
    agentConfig: record.agent_config,
    setup: record.setup,
    variables,
    userMessages: record.user_messages,
    expectedPath: record.expected_path,
    expectedBehavior: record.expected_behavior,
    sample: record.sample,
    testerNotes: record.tester_notes,
  };
}

/**
 * Validate a default-variable key before it is added to a call type's base.
 * Returns null when the key is usable, otherwise the reason it is not.
 */
export function validateDefaultKey(key: string): string | null {
  if (!VAR_KEY_PATTERN.test(key)) {
    return "name must start with a letter and contain only letters, digits and underscores";
  }
  if (isReservedVarKey(key)) {
    return `"${key}" is generated by the agent at call time and cannot be staged`;
  }
  if (key === LOCKED_VAR_KEY) {
    return `"${LOCKED_VAR_KEY}" is set by the call direction and cannot be edited`;
  }
  return null;
}

/**
 * Coerce an untrusted request body into a TestPresetInput. Shape only — the
 * business rules (enums, unknown override keys, reserved prefixes) belong to
 * validateTestPreset, so the API and the editor apply exactly one rule set.
 */
export function toTestPresetInput(
  body: Record<string, unknown>,
  testNo: number
): TestPresetInput {
  const str = (key: string) => (typeof body[key] === "string" ? (body[key] as string) : "");
  return {
    test_no: testNo,
    scenario: str("scenario"),
    group_name: str("group_name"),
    agent_scope: str("agent_scope"),
    call_type: str("call_type"),
    priority: str("priority"),
    high_risk: body.high_risk === true,
    needs_lead_profile: body.needs_lead_profile === true,
    agent_config: str("agent_config") || "Default",
    setup: str("setup"),
    sheet_what_to_say: str("sheet_what_to_say"),
    sheet_what_to_watch_for: str("sheet_what_to_watch_for"),
    // Values stay string | null — null stages the variable as absent.
    overrides:
      body.overrides && typeof body.overrides === "object"
        ? (body.overrides as Record<string, OverrideValue>)
        : {},
    user_messages: Array.isArray(body.user_messages)
      ? (body.user_messages as unknown[]).map(String)
      : [],
    expected_path: str("expected_path"),
    expected_behavior: str("expected_behavior"),
    sample: str("sample"),
    tester_notes: str("tester_notes"),
  };
}
