"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { Phone, PhoneIncoming, PhoneOutgoing, Zap, ChevronDown, Trash2 } from "lucide-react";
import {
  CALL_MODES,
  type CallMode,
  type TestPreset,
  ALL_AGENTS_TAG,
  UNIVERSAL_AGENT_SCOPE,
  presetsForAgentTag,
} from "@/lib/presets";
import { TEST_PRESETS } from "@/lib/tests";
import VarEditor from "./VarEditor";
import JsonDropzone from "./JsonDropzone";
import TestDetailsPanel from "./TestDetailsPanel";

const MODE_COLORS: Record<CallMode, { border: string; bg: string; btn: string; text: string }> = {
  inbound: {
    border: "border-blue-500",
    bg: "bg-blue-500/10",
    btn: "bg-blue-600 hover:bg-blue-700",
    text: "text-blue-600",
  },
  outbound_followup: {
    border: "border-orange-500",
    bg: "bg-orange-500/10",
    btn: "bg-orange-600 hover:bg-orange-700",
    text: "text-orange-600",
  },
  speed_to_lead: {
    border: "border-green-500",
    bg: "bg-green-500/10",
    btn: "bg-green-600 hover:bg-green-700",
    text: "text-green-600",
  },
};

const MODE_ICONS: Record<CallMode, React.ReactNode> = {
  inbound: <PhoneIncoming size={14} />,
  outbound_followup: <PhoneOutgoing size={14} />,
  speed_to_lead: <Zap size={14} />,
};

// Shown before a direction has been picked for an untagged ("All") agent.
const NEUTRAL_COLORS = {
  border: "border-zinc-300 dark:border-zinc-700",
  bg: "bg-zinc-100 dark:bg-zinc-800",
  btn: "bg-zinc-300 dark:bg-zinc-700",
  text: "text-zinc-500",
};

// Agent tags map 1:1 onto call modes, so a tagged agent's direction is known
// up front and doesn't need to be picked manually. MODE_TO_TAG is derived
// from this so the two can never drift out of sync with each other.
const TAG_TO_MODE: Record<string, CallMode> = {
  Inbound: "inbound",
  Outbound: "outbound_followup",
  "Speed to Lead": "speed_to_lead",
};
const MODE_TO_TAG = Object.fromEntries(
  Object.entries(TAG_TO_MODE).map(([tag, mode]) => [mode, tag])
) as Record<CallMode, string>;

// Group heading color in the custom test-case dropdown, keyed off the group's
// direction prefix (groups look like "Inbound · Opener"); universal groups
// (Global Interrupts, TTS & Config Sanity, …) stay neutral.
function groupLabelColor(group: string): string {
  if (group.startsWith("Inbound")) return "text-blue-600 dark:text-blue-400";
  if (group.startsWith("Outbound")) return "text-orange-600 dark:text-orange-400";
  if (group.startsWith("Speed to Lead")) return "text-green-600 dark:text-green-400";
  return "text-zinc-500";
}

interface Props {
  agentName: string;
  agentTag?: string;
  onStartCall: (
    mode: CallMode,
    variables: Record<string, string>,
    testCase: TestPreset | null
  ) => void;
  onBack: () => void;
  initialMode?: CallMode;
  initialVariables?: Record<string, string>;
  initialTestCase?: TestPreset | null;
}

export default function CallSetup({
  agentName,
  agentTag = ALL_AGENTS_TAG,
  onStartCall,
  onBack,
  initialMode,
  initialVariables,
  initialTestCase,
}: Props) {
  // agentTag arrives synchronously as a prop (resolved before this component
  // ever mounts, see AgentSelect), so the tag-implied mode can be computed up
  // front — no fetch-then-overwrite race with whatever the user picks first.
  const [mode, setMode] = useState<CallMode | null>(
    initialMode ?? TAG_TO_MODE[agentTag] ?? null
  );
  const [variables, setVariables] = useState<Record<string, string>>(() => {
    const initialCallMode = initialMode ?? TAG_TO_MODE[agentTag];
    return initialVariables ?? (initialCallMode ? { call_type: CALL_MODES[initialCallMode].callType } : {});
  });
  const [selectedTest, setSelectedTest] = useState<TestPreset | null>(
    initialTestCase ?? null
  );
  const [presetMenuOpen, setPresetMenuOpen] = useState(false);
  const presetMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!presetMenuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (presetMenuRef.current && !presetMenuRef.current.contains(e.target as Node)) {
        setPresetMenuOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setPresetMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [presetMenuOpen]);

  // The mode is manually choosable only when the agent isn't tagged to a
  // direction and no preset (which also implies a direction) is selected.
  const modeIsChoosable = agentTag === ALL_AGENTS_TAG && !selectedTest;

  // An untagged ("all") agent has no group restriction until the tester picks
  // a direction manually — once they do, presets should narrow to match it.
  const presetFilterTag =
    agentTag !== ALL_AGENTS_TAG ? agentTag : mode ? MODE_TO_TAG[mode] : ALL_AGENTS_TAG;

  const availablePresets = useMemo(
    () => presetsForAgentTag(TEST_PRESETS, presetFilterTag),
    [presetFilterTag]
  );

  const presetGroups = useMemo(() => {
    const groups: Record<string, TestPreset[]> = {};
    for (const p of availablePresets) {
      if (!groups[p.group]) groups[p.group] = [];
      groups[p.group].push(p);
    }
    return groups;
  }, [availablePresets]);

  function handleModeChange(newMode: CallMode) {
    setMode(newMode);
    setVariables((prev) => ({
      ...prev,
      call_type: CALL_MODES[newMode].callType,
    }));
  }

  function handlePreset(test: TestPreset) {
    setSelectedTest(test);
    // Universal ("Any"-scope) presets carry a placeholder callType (always
    // "inbound" in the source data) since they don't actually imply a
    // direction — keep whatever mode is already active instead of forcing
    // it back to Inbound for an Outbound/Speed-to-Lead agent.
    const impliesDirection = test.agentScope !== UNIVERSAL_AGENT_SCOPE && test.callType in CALL_MODES;
    const ct = (impliesDirection ? test.callType : mode ?? "inbound") as CallMode;
    setMode(ct);
    setVariables({
      ...test.variables,
      call_type: CALL_MODES[ct].callType,
    });
  }

  function handleJsonDrop(vars: Record<string, string>) {
    setSelectedTest(null);
    setVariables((prev) => {
      const next = { ...prev, ...vars };
      if (mode) next.call_type = CALL_MODES[mode].callType;
      return next;
    });
  }

  function clearVars() {
    setVariables(mode ? { call_type: CALL_MODES[mode].callType } : {});
    setSelectedTest(null);
  }

  const varCount = Object.keys(variables).length;
  const filledCount = Object.values(variables).filter((v) => v !== "").length;
  const colors = mode ? MODE_COLORS[mode] : NEUTRAL_COLORS;

  return (
    <div className="flex flex-col lg:h-[calc(100vh-8rem)] max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 shrink-0">
        <div>
          <h2 className="text-2xl font-semibold">Call Setup</h2>
          <p className="text-sm text-zinc-500 mt-0.5">Agent: {agentName}</p>
        </div>
        <div className="flex items-center gap-3">
          {modeIsChoosable ? (
            <div className="relative">
              <select
                value={mode ?? ""}
                onChange={(e) => handleModeChange(e.target.value as CallMode)}
                title="Call direction"
                className={`appearance-none text-xs font-semibold uppercase tracking-wide pl-3.5 pr-8 py-2 rounded-full border shadow-sm ${colors.border} ${colors.bg} ${colors.text}`}
              >
                <option value="" disabled>
                  Select direction
                </option>
                {(
                  Object.entries(CALL_MODES) as [CallMode, (typeof CALL_MODES)[CallMode]][]
                ).map(([key, config]) => (
                  <option key={key} value={key}>
                    {config.label}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={12}
                className={`absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none ${colors.text}`}
              />
            </div>
          ) : (
            mode && (
              <span
                title="Set by the agent's tag or the selected test case"
                className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide px-3.5 py-2 rounded-full ${colors.bg} ${colors.text}`}
              >
                {MODE_ICONS[mode]}
                {CALL_MODES[mode].label}
              </span>
            )
          )}
          <button
            onClick={onBack}
            className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
          >
            Change agent
          </button>
        </div>
      </div>

      {/* Preset + JSON row */}
      <div className="shrink-0 flex items-center gap-2 mb-2.5">
        <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">
          Test case
        </span>
        <span className="text-[11px] font-medium text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded-md">
          {availablePresets.length} available
        </span>
      </div>
      <div className="shrink-0 flex items-center gap-2 mb-5">
        <div className="relative flex-1" ref={presetMenuRef}>
          <button
            type="button"
            onClick={() => setPresetMenuOpen((open) => !open)}
            aria-haspopup="listbox"
            aria-expanded={presetMenuOpen}
            className="w-full flex items-center justify-between gap-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-sm pl-4 pr-3 py-3 text-sm font-medium transition-all hover:border-zinc-300 dark:hover:border-zinc-600 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <span
              className={
                selectedTest
                  ? "text-zinc-900 dark:text-zinc-100 truncate"
                  : "text-zinc-400 font-normal truncate"
              }
            >
              {selectedTest ? selectedTest.name : "Select a test case…"}
            </span>
            <ChevronDown
              size={16}
              className={`shrink-0 text-zinc-400 transition-transform ${presetMenuOpen ? "rotate-180" : ""}`}
            />
          </button>

          {presetMenuOpen && (
            <div
              role="listbox"
              className="absolute z-20 mt-1.5 w-full max-h-80 overflow-y-auto rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg py-1.5"
            >
              {Object.entries(presetGroups).map(([group, presets]) => (
                <div key={group}>
                  <div
                    className={`px-3 pt-2.5 pb-1 text-[11px] font-bold uppercase tracking-wide ${groupLabelColor(group)}`}
                  >
                    {group}
                  </div>
                  {presets.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      role="option"
                      aria-selected={selectedTest?.id === p.id}
                      onClick={() => {
                        handlePreset(p);
                        setPresetMenuOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-sm truncate transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                        selectedTest?.id === p.id
                          ? "bg-zinc-100 dark:bg-zinc-800 font-medium text-zinc-900 dark:text-zinc-100"
                          : "text-zinc-700 dark:text-zinc-300"
                      }`}
                    >
                      <span className="text-zinc-400 dark:text-zinc-500">
                        {p.priority}{p.highRisk ? " ★" : ""}
                      </span>
                      {" · "}
                      {p.name}
                    </button>
                  ))}
                </div>
              ))}
              {availablePresets.length === 0 && (
                <div className="px-3 py-6 text-center text-sm text-zinc-400">
                  No test cases for this direction.
                </div>
              )}
            </div>
          )}
        </div>
        <JsonDropzone onDrop={handleJsonDrop} />
        <button
          onClick={clearVars}
          className="flex items-center gap-1 px-3.5 py-3 text-xs text-zinc-400 hover:text-red-500 border border-zinc-300 dark:border-zinc-700 rounded-xl transition-colors shrink-0"
        >
          <Trash2 size={12} />
          Clear
        </button>
      </div>

      {/* Lower area: variables (large) beside the test details.
          On mobile it stacks and the page scrolls; on lg it's a fixed-height split. */}
      <div className="flex flex-col lg:flex-row gap-6 lg:flex-1 lg:min-h-0">
        {/* Variables column — stays large */}
        <div className="flex flex-col lg:flex-1 lg:min-h-0 order-2 lg:order-1">
          <div className="shrink-0 h-5 flex items-center gap-2 mb-2.5">
            <span className={`text-xs font-bold uppercase tracking-wide ${colors.text}`}>
              Dynamic Variables
            </span>
            <span className="text-xs text-zinc-400">
              {filledCount} filled / {varCount} total
            </span>
          </div>
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 shadow-sm p-3 lg:flex-1 lg:overflow-y-auto lg:min-h-0">
            <VarEditor
              variables={variables}
              onChange={(vars) =>
                setVariables(
                  mode ? { ...vars, call_type: CALL_MODES[mode].callType } : vars
                )
              }
              lockedKeys={["call_type"]}
            />
          </div>
        </div>

        {/* Test details column — shows first on mobile, right side on desktop */}
        {selectedTest && (
          <div className="lg:w-96 lg:shrink-0 flex flex-col lg:min-h-0 order-1 lg:order-2">
            <TestDetailsPanel testCase={selectedTest} accentClass={colors.text} />
          </div>
        )}
      </div>

      {/* Pinned footer */}
      <div className="shrink-0 pt-5 mt-5 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
        <div className="text-sm text-zinc-500">
          <span className={`font-medium ${colors.text}`}>
            {mode ? CALL_MODES[mode].label : "Select a call direction above"}
          </span>
          {selectedTest && <span> &middot; {selectedTest.name}</span>}
        </div>
        <button
          onClick={() => mode && onStartCall(mode, variables, selectedTest)}
          disabled={!mode}
          className={`flex items-center gap-2 ${colors.btn} text-white px-8 py-3 rounded-xl font-medium shadow-sm hover:shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none`}
        >
          <Phone size={18} />
          Start Call
        </button>
      </div>
    </div>
  );
}
