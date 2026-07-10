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

// Agent tags, assigned per-agent in the admin panel. "all" (the default) means
// the agent isn't restricted to a direction, so every test case is shown.
export const AGENT_TAGS = ["Inbound", "Outbound", "Speed to Lead"] as const;
export type AgentTag = (typeof AGENT_TAGS)[number];
export const ALL_AGENTS_TAG = "all";

// Each agent tag maps onto the `agentScope` its test cases carry ("Speed to
// Lead" -> "STL"). Presets scoped "Any" target every agent, whatever its tag.
const TAG_TO_SCOPE: Record<string, string> = {
  Inbound: "Inbound",
  Outbound: "Outbound",
  "Speed to Lead": "STL",
};
export const UNIVERSAL_AGENT_SCOPE = "Any";

/** Test cases for an agent tagged `tag`: those scoped to it, plus the universal ("Any") ones. */
export function presetsForAgentTag<T extends TestPreset>(presets: T[], tag: string): T[] {
  if (tag === ALL_AGENTS_TAG) return presets;
  const scope = TAG_TO_SCOPE[tag];
  return presets.filter(
    (p) => p.agentScope === scope || p.agentScope === UNIVERSAL_AGENT_SCOPE
  );
}

// A Preset enriched with the QA-sheet test case (1-1 with the dev testing sheet).
// Generated into ./tests.ts from testing/dev_test_cases.json.
// Regenerate: conda run -n env python testing/make_presets.py
export interface TestPreset extends Preset {
  id: string;                // T-01..T-71, 1-1 with the sheet's Test #
  callType: string;          // inbound | outbound_followup | speed_to_lead
  agentScope: string;        // Inbound | Outbound | STL | Any — which agent(s) the case targets
  priority: string;          // P0 blocker | P1 important | P2 nice-to-have | Obs observe-only
  highRisk: boolean;         // sheet "high risk" Y — the smoke set for every dev push
  needsLeadProfile: boolean; // needs a staged lead profile (expressed via variables here)
  agentConfig: string;       // Default | Variant (non-default agent config)
  setup: string;             // manual setup from the sheet
  userMessages: string[];    // what the tester should say, in order
  expectedPath: string;      // states the agent should traverse
  expectedBehavior: string;  // plain-English expected outcome incl. fail conditions
  sample: string;            // example line the agent should say
  testerNotes: string;       // extra staging / observe-during notes
}
