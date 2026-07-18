// Authoritative rubric + default config for the call grader, copied verbatim
// from the client's Supabase migrations and src/lib/rubric.ts. These are seeded
// idempotently (INSERT OR IGNORE) into failure_classes / rep_dimensions /
// app_config per workspace by db.ts, so admin edits are never clobbered.
//
// Sources:
// - Failure classes:  supabase/migrations/20260714003341_*.sql
// - Rep dimensions + system prompt:  src/lib/rubric.ts (REP_DIMENSIONS, GRADER_SYSTEM_PROMPT)
// - Default app_config keys:  the same migration + later automation/backfill migrations

export interface RubricEntry {
  key: string;
  name: string;
  definition: string;
  sort_order: number;
}

// The 9 failure classes — exact key/name/definition/sort_order from the migration.
export const FAILURE_CLASSES: RubricEntry[] = [
  {
    key: "re_asked_known_data",
    name: "Re-asked known data",
    definition:
      "Agent re-asked information that was already seeded in dynamic variables (PRE-FILLED) or already stated earlier in the same call. Do not penalize if the variable was EMPTY/UNKNOWN.",
    sort_order: 1,
  },
  {
    key: "spoke_name_aloud",
    name: "Spoke caller name aloud",
    definition:
      "Agent spoke the caller's name out loud at any point. Capture-only rule.",
    sort_order: 2,
  },
  {
    key: "data_echoing",
    name: "Data echoing",
    definition:
      "Agent recited fields back to the caller, recapped their data, or read back what the caller said instead of moving forward.",
    sort_order: 3,
  },
  {
    key: "stacked_questions",
    name: "Stacked questions",
    definition: "Agent asked more than one question in a single agent turn.",
    sort_order: 4,
  },
  {
    key: "affirmation_on_data",
    name: "Affirmation on plain data",
    definition:
      "Agent gave praise or thanks in response to a plain data answer (address, price, condition tier, etc.).",
    sort_order: 5,
  },
  {
    key: "steamrolled_caller",
    name: "Steamrolled caller",
    definition:
      "Agent delivered a canned line over or ignoring what the caller actually said.",
    sort_order: 6,
  },
  {
    key: "appointment_recall_failure",
    name: "Appointment recall failure",
    definition:
      "After confirming an appointment, agent reset to the opener, OR agent kept probing availability after the caller said anytime or gave a clear answer.",
    sort_order: 7,
  },
  {
    key: "false_completeness_claim",
    name: "False completeness claim",
    definition:
      "Agent claimed it had information or had done something it had not actually done or received.",
    sort_order: 8,
  },
  {
    key: "address_gate_violation",
    name: "Address gate violation",
    definition:
      "Agent asked discovery questions before the property address was captured.",
    sort_order: 9,
  },
];

// The 5 rep dimensions — exact from rubric.ts REP_DIMENSIONS, with sort_order
// derived from array position (promoted from the hardcoded array).
export const REP_DIMENSIONS: RubricEntry[] = [
  {
    key: "discovery_depth",
    name: "Discovery depth",
    definition:
      "Did the agent uncover the seller's motivation, timeline, property condition, price expectation, and mortgage/ownership situation? Score proportional to what was uncovered relative to what the call gave opportunity for. Fields already known from PRE-FILLED dynamic variables count as covered, not missing.",
    sort_order: 1,
  },
  {
    key: "rapport",
    name: "Rapport",
    definition:
      "Did the seller open up over the call? Did the agent respond to what the seller actually said rather than delivering canned lines? Were emotional disclosures acknowledged appropriately?",
    sort_order: 2,
  },
  {
    key: "call_control",
    name: "Call control",
    definition:
      "Forward momentum maintained, one question per turn, no rambling or dead-end loops, call didn't drift.",
    sort_order: 3,
  },
  {
    key: "objection_handling",
    name: "Objection handling",
    definition:
      'How did the agent handle pushback, hesitation, "just curious" callers, or price objections? If no objections arose, mark not applicable rather than scoring.',
    sort_order: 4,
  },
  {
    key: "outcome",
    name: "Outcome",
    definition:
      "Did the call end with a concrete next step: appointment set, callback scheduled, transfer completed, or correct disqualification? A call that just ends with no disposition scores low.",
    sort_order: 5,
  },
];

// Grader system prompt — the editable JUDGMENT instructions only. The two rubric
// layers and the JSON output contract are appended at grade time by the engine
// (src/lib/openaiGrader.ts), so this text stays focused on how to judge and the
// output shape can't drift from the parser. Stored as an app_config value so it
// is DB-editable (admin RubricTab).
export const GRADER_SYSTEM_PROMPT = `You are grading a live inbound production call handled by an AI voice agent for a real-estate acquisitions company. You evaluate the call on two layers:

- Failure classes — a "doesn't sound robotic" floor. Each names a specific mistake the agent might make; for each you report whether the situation arose and, if so, whether the agent committed the mistake.
- Rep scorecard — a QA-manager view of the agent as a human acquisitions rep, scored 0-100 per dimension.

You are given the dynamic variables the agent already had, split into PRE-FILLED (authoritative ground truth the agent already knew — do NOT penalize the agent for not asking about these; treat them as already covered, not missing discovery) and EMPTY/UNKNOWN (the agent legitimately needed to ask).

Judge each rep dimension relative to the opportunity the call actually gave — a short call where the caller hung up early should not be penalized on discovery for questions it never had the chance to reach.

Be strict but fair. Base every judgment on quoted transcript evidence, and never invent turns.`;

// Default app_config values seeded per workspace. Values are JSON — stored as
// TEXT via JSON.stringify at the seed boundary. Copied from the client's
// migrations (grader_model, tracking_start_date, agent_id_allowlist,
// automation_enabled, backfill_complete) plus the grader system prompt.
export const DEFAULT_GRADER_MODEL = "gpt-4o-mini";
export const DEFAULT_TRACKING_START_DATE = "2026-07-10";

export const APP_CONFIG_KEYS = {
  graderModel: "grader_model",
  trackingStartDate: "tracking_start_date",
  agentIdAllowlist: "agent_id_allowlist",
  automationEnabled: "automation_enabled",
  backfillComplete: "backfill_complete",
  graderSystemPrompt: "grader_system_prompt",
} as const;

export const DEFAULT_APP_CONFIG: Record<string, unknown> = {
  [APP_CONFIG_KEYS.graderModel]: DEFAULT_GRADER_MODEL,
  [APP_CONFIG_KEYS.trackingStartDate]: DEFAULT_TRACKING_START_DATE,
  [APP_CONFIG_KEYS.agentIdAllowlist]: [],
  [APP_CONFIG_KEYS.automationEnabled]: true,
  [APP_CONFIG_KEYS.backfillComplete]: false,
  [APP_CONFIG_KEYS.graderSystemPrompt]: GRADER_SYSTEM_PROMPT,
};
