export type CallMode = "inbound" | "outbound_followup" | "speed_to_lead";

export interface CallModeConfig {
  label: string;
  description: string;
  callType: string;
  firstSpeaker: "agent" | "user";
}

export const CALL_MODES: Record<CallMode, CallModeConfig> = {
  inbound: {
    label: "Inbound",
    description: "Caller dials in — AI speaks first",
    callType: "inbound",
    firstSpeaker: "agent",
  },
  outbound_followup: {
    label: "Outbound Follow-up",
    description: "AI calls a lead back — user speaks first",
    callType: "outbound_followup",
    firstSpeaker: "user",
  },
  speed_to_lead: {
    label: "Speed to Lead",
    description: "AI calls a new lead — user speaks first",
    callType: "speed_to_lead",
    firstSpeaker: "user",
  },
};

export interface Preset {
  name: string;
  group: string;
  variables: Record<string, string>;
}

// A Preset enriched with the test-case script + expected outcome.
// Generated into ./tests.ts from testing/test_cases_unique.json.
export interface TestPreset extends Preset {
  id: string;
  callType: string;          // inbound | outbound_followup | speed_to_lead
  callTypeScope: string;     // whether this case varies by call_type or is shared
  userMessages: string[];    // what the tester should say, in order
  expectedPath: string;      // nodes the agent should traverse
  expectedBehavior: string;  // plain-English expected outcome
  sample: string;            // example line the agent should say
}
