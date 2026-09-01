// Import / export shapes for test presets, plus the "Copy agent instructions"
// text.
//
// The wire format is deliberately the same one the retired
// testing/dev_test_cases.json used, so an export can be committed as an archive
// and pasted straight back in. Export and import are symmetric: whatever the
// export writes, the import accepts.

import {
  AGENT_CONFIGS,
  AGENT_SCOPES,
  CALL_TYPES,
  PRIORITIES,
  RESERVED_VAR_PREFIXES,
  type OverrideValue,
  type PresetDefaults,
  type TestPresetInput,
  type TestPresetRecord,
} from "./testPreset";

/** One case in the interchange format (dev_test_cases.json field names). */
export interface PresetExchange {
  test_no: number;
  agent: string;
  scenario: string;
  priority: string;
  high_risk: boolean;
  needs_lead_profile: boolean;
  agent_config: string;
  setup: string;
  group: string;
  callType: string;
  sheet_what_to_say: string;
  sheet_what_to_watch_for: string;
  overrides: Record<string, OverrideValue>;
  userMessages: string[];
  expectedBehavior: string;
  expectedPath: string;
  sample: string;
  testerNotes: string;
}

export function toExchange(record: TestPresetRecord): PresetExchange {
  return {
    test_no: record.test_no,
    agent: record.agent_scope,
    scenario: record.scenario,
    priority: record.priority,
    high_risk: record.high_risk,
    needs_lead_profile: record.needs_lead_profile,
    agent_config: record.agent_config,
    setup: record.setup,
    group: record.group_name,
    callType: record.call_type,
    sheet_what_to_say: record.sheet_what_to_say,
    sheet_what_to_watch_for: record.sheet_what_to_watch_for,
    overrides: record.overrides,
    userMessages: record.user_messages,
    expectedBehavior: record.expected_behavior,
    expectedPath: record.expected_path,
    sample: record.sample,
    testerNotes: record.tester_notes,
  };
}

/**
 * Interchange case -> editable input. Shape coercion only; the business rules
 * stay in validateTestPreset so imports and the editor are judged identically.
 * `testNo` is passed in because the importer allocates numbers for cases that
 * arrive without one.
 */
export function fromExchange(raw: Record<string, unknown>, testNo: number): TestPresetInput {
  const str = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string) : "");
  return {
    test_no: testNo,
    scenario: str("scenario"),
    group_name: str("group"),
    agent_scope: str("agent"),
    call_type: str("callType"),
    priority: str("priority"),
    high_risk: raw.high_risk === true,
    needs_lead_profile: raw.needs_lead_profile === true,
    agent_config: str("agent_config") || "Default",
    setup: str("setup"),
    sheet_what_to_say: str("sheet_what_to_say"),
    sheet_what_to_watch_for: str("sheet_what_to_watch_for"),
    overrides:
      raw.overrides && typeof raw.overrides === "object"
        ? (raw.overrides as Record<string, OverrideValue>)
        : {},
    user_messages: Array.isArray(raw.userMessages)
      ? (raw.userMessages as unknown[]).map(String)
      : [],
    expected_path: str("expectedPath"),
    expected_behavior: str("expectedBehavior"),
    sample: str("sample"),
    tester_notes: str("testerNotes"),
  };
}

/** Accepts `{ tests: [...] }` or a bare array. Throws with a readable message. */
export function parseExchangePayload(text: string): Record<string, unknown>[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Not valid JSON");
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { tests?: unknown }).tests)
      ? (parsed as { tests: unknown[] }).tests
      : null;
  if (!list) {
    throw new Error('Expected an array of cases, or an object with a "tests" array');
  }
  return list.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Entry ${index + 1} is not an object`);
    }
    return item as Record<string, unknown>;
  });
}

// ---------------------------------------------------------------------------
// QA-sheet CSV (the tester's column layout, ported from make_qa_sheet.py)
// ---------------------------------------------------------------------------

const QA_COLUMNS = [
  "Test #",
  "Agent",
  "Scenario",
  "Priority",
  "high risk",
  "Needs Lead Profile",
  "Agent Config",
  "Setup",
  "What to Say",
  "What to Watch For",
  "tested by",
  "Pass/Fail",
  "Call Rating",
  "Notes",
  "Link",
];
// Trailing columns the tester fills in, emitted empty.
const QA_TESTER_COLUMNS = 5;

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRow(cells: (string | number)[]): string {
  return cells.map(csvCell).join(",");
}

/**
 * QA-sheet CSV for a run of cases, with an uppercase section row per group —
 * the layout the testers already work in.
 */
export function buildQaSheetCsv(records: TestPresetRecord[]): string {
  const lines = [csvRow(QA_COLUMNS)];
  let group: string | null = null;
  for (const record of records) {
    if (record.group_name !== group) {
      group = record.group_name;
      lines.push(csvRow([group.toUpperCase(), ...Array(QA_COLUMNS.length - 1).fill("")]));
    }
    lines.push(
      csvRow([
        record.test_no,
        record.agent_scope,
        record.scenario,
        record.priority,
        record.high_risk ? "Y" : "",
        record.needs_lead_profile ? "Yes" : "No",
        record.agent_config,
        record.setup,
        record.sheet_what_to_say,
        record.sheet_what_to_watch_for,
        ...Array(QA_TESTER_COLUMNS).fill(""),
      ])
    );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Agent instructions
// ---------------------------------------------------------------------------

/**
 * The text behind "Copy agent instructions". Generated from the LIVE defaults
 * on purpose: handing the model the real variable names for each call type is
 * what stops it inventing `seller_name` when the field is `seller_first_name`.
 */
export function buildAgentInstructions(
  defaults: PresetDefaults,
  nextTestNo: number,
  groups: string[]
): string {
  const variableBlocks = CALL_TYPES.map((callType) => {
    const keys = Object.keys(defaults[callType] ?? {}).sort();
    return `### ${callType} (${keys.length} variables)\n${keys.join(", ")}`;
  }).join("\n\n");

  return `You are writing test cases for a Retell voice-agent test suite. Convert the
scenarios I give you into JSON matching the contract below, and output ONLY the
JSON — no prose, no markdown fence.

## Output shape

{"tests": [ <case>, <case>, ... ]}

Each case is an object with exactly these fields:

| field | type | notes |
|---|---|---|
| test_no | number | OMIT to auto-allocate. Next free number is ${nextTestNo}. |
| agent | string | one of: ${AGENT_SCOPES.join(" | ")} |
| scenario | string | short title, shown in the picker |
| priority | string | one of: ${PRIORITIES.join(" | ")} |
| high_risk | boolean | true = part of the smoke set run on every dev push |
| needs_lead_profile | boolean | true = needs a real staged lead in REsimpli |
| agent_config | string | one of: ${AGENT_CONFIGS.join(" | ")} |
| setup | string | manual staging steps, if any |
| group | string | see the group list below; a new group is allowed |
| callType | string | one of: ${CALL_TYPES.join(" | ")} |
| sheet_what_to_say | string | QA-sheet column: the persona, in prose |
| sheet_what_to_watch_for | string | QA-sheet column: the pass/fail signal |
| overrides | object | variable name -> string value, or null (see below) |
| userMessages | array of strings | what the tester says, in order |
| expectedBehavior | string | outcome INCLUDING explicit fail conditions |
| expectedPath | string | e.g. "OPENER -> DISCOVERY -> ROUTING" |
| sample | string | one line the agent should say |
| testerNotes | string | staging notes and the discriminator turn |

## Rules — an import is rejected if any of these is broken

1. Every key in "overrides" MUST already exist in that callType's variable list
   below. You cannot invent variable names. If a scenario needs a variable that
   does not exist, say so in prose instead of guessing.
2. An override VALUE of null stages the variable as ABSENT — deleted from the
   payload rather than sent blank. Use null only when the case is specifically
   testing a missing variable. Use "" for a blank one.
3. Never use a variable starting with ${RESERVED_VAR_PREFIXES.map((p) => `"${p}"`).join(" or ")} — the agent builds those
   at call time and staging one would overwrite what it generates.
4. Never override "call_type"; it is set by the call direction.
5. All override values are strings, including numbers and booleans:
   "true", "false", "183,000 to 211,000".
6. Scope deliberately. agent "Any" shows the case on every agent, which
   produces false failures when the behaviour is direction-specific. Prefer the
   specific agent unless the behaviour is genuinely shared.
7. Put the discriminator in testerNotes: name the single turn that decides
   pass/fail. Most cases pass everywhere except one turn, and a tester reading
   a wall of expected behaviour will miss it.

## Existing groups

${groups.map((group) => `- ${group}`).join("\n") || "- (none yet)"}

## Available variables

${variableBlocks}

## Example

{"tests": [{
  "agent": "Inbound",
  "scenario": "Callback rep named - single close",
  "priority": "P0",
  "high_risk": true,
  "needs_lead_profile": false,
  "agent_config": "Default",
  "setup": "None.",
  "group": "Inbound · Gate & Routing",
  "callType": "inbound",
  "sheet_what_to_say": "Persona: a seller who wants a callback rather than an appointment.",
  "sheet_what_to_watch_for": "The named rep is used once, in a single close.",
  "overrides": {"callback_rep_name": "Marcus", "next_step_type": "callback"},
  "userMessages": ["Hi, I got a letter about my house.", "Just have someone call me back."],
  "expectedBehavior": "The agent closes once, naming Marcus. Fail if it names a generic specialist or closes twice.",
  "expectedPath": "OPENER -> DISCOVERY -> ROUTING (callback)",
  "sample": "Marcus will reach out about next steps.",
  "testerNotes": "Discriminator: the closing turn. The rep name must be spoken exactly once."
}]}`;
}
