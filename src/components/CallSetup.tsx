"use client";

import { useState, useMemo } from "react";
import { Phone, PhoneIncoming, PhoneOutgoing, Zap, ChevronDown, Trash2 } from "lucide-react";
import { CALL_MODES, type CallMode, type TestPreset } from "@/lib/presets";
import { TEST_PRESETS } from "@/lib/tests";
import VarEditor from "./VarEditor";
import JsonDropzone from "./JsonDropzone";

function scopeTag(scope: string): string {
  if (scope.startsWith("INBOUND")) return "Inbound only";
  if (scope.startsWith("OPENER")) return "Call-type specific";
  if (scope.startsWith("COMBO")) return "Combo";
  if (scope.startsWith("ANY")) return "Any call type";
  return scope;
}

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
  inbound: <PhoneIncoming size={16} />,
  outbound_followup: <PhoneOutgoing size={16} />,
  speed_to_lead: <Zap size={16} />,
};

interface Props {
  agentName: string;
  onStartCall: (mode: CallMode, variables: Record<string, string>) => void;
  onBack: () => void;
  initialMode?: CallMode;
  initialVariables?: Record<string, string>;
}

export default function CallSetup({ agentName, onStartCall, onBack, initialMode, initialVariables }: Props) {
  const [mode, setMode] = useState<CallMode>(initialMode ?? "inbound");
  const [variables, setVariables] = useState<Record<string, string>>(
    initialVariables ?? { call_type: CALL_MODES.inbound.callType }
  );
  const [selectedTest, setSelectedTest] = useState<TestPreset | null>(null);

  const presetGroups = useMemo(() => {
    const groups: Record<string, TestPreset[]> = {};
    for (const p of TEST_PRESETS) {
      if (!groups[p.group]) groups[p.group] = [];
      groups[p.group].push(p);
    }
    return groups;
  }, []);

  function handleModeChange(newMode: CallMode) {
    setMode(newMode);
    setVariables((prev) => ({
      ...prev,
      call_type: CALL_MODES[newMode].callType,
    }));
  }

  function handlePreset(test: TestPreset) {
    setSelectedTest(test);
    const ct = (
      test.callType in CALL_MODES ? test.callType : mode
    ) as CallMode;
    setMode(ct);
    setVariables({
      ...test.variables,
      call_type: CALL_MODES[ct].callType,
    });
  }

  function handleJsonDrop(vars: Record<string, string>) {
    setSelectedTest(null);
    setVariables((prev) => ({
      ...prev,
      ...vars,
      call_type: CALL_MODES[mode].callType,
    }));
  }

  function clearVars() {
    setVariables({ call_type: CALL_MODES[mode].callType });
    setSelectedTest(null);
  }

  const varCount = Object.keys(variables).length;
  const filledCount = Object.values(variables).filter((v) => v !== "").length;
  const colors = MODE_COLORS[mode];

  return (
    <div className="flex flex-col lg:h-[calc(100vh-8rem)] max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h2 className="text-xl font-semibold">Call Setup</h2>
          <p className="text-sm text-zinc-500">Agent: {agentName}</p>
        </div>
        <button
          onClick={onBack}
          className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
        >
          Change agent
        </button>
      </div>

      {/* Call Mode */}
      <div className="shrink-0 mb-4">
        <div className="grid grid-cols-3 gap-2">
          {(
            Object.entries(CALL_MODES) as [CallMode, (typeof CALL_MODES)[CallMode]][]
          ).map(([key, config]) => {
            const c = MODE_COLORS[key];
            const selected = mode === key;
            return (
              <button
                key={key}
                onClick={() => handleModeChange(key)}
                className={`flex items-center gap-2 p-3 rounded-lg border text-left transition-colors ${
                  selected
                    ? `${c.border} ${c.bg}`
                    : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600"
                }`}
              >
                <span className={selected ? c.text : "text-zinc-400"}>
                  {MODE_ICONS[key]}
                </span>
                <div>
                  <div className="font-medium text-sm">{config.label}</div>
                  <div className="text-xs text-zinc-500">{config.description}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Preset + JSON row */}
      <div className="shrink-0 flex items-center gap-2 mb-2">
        <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">
          Test case
        </span>
        <span className="text-xs text-zinc-400">{TEST_PRESETS.length} cases</span>
      </div>
      <div className="shrink-0 flex items-center gap-2 mb-4">
        <div className="relative flex-1">
          <select
            value={selectedTest?.id ?? ""}
            onChange={(e) => {
              const id = e.target.value;
              if (!id) return;
              const p = TEST_PRESETS.find((pr) => pr.id === id);
              if (p) handlePreset(p);
            }}
            className="w-full appearance-none bg-zinc-100 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg px-3 py-2 pr-10 text-sm"
          >
            <option value="">Select a test case</option>
            {Object.entries(presetGroups).map(([group, presets]) => (
              <optgroup key={group} label={group}>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <ChevronDown
            size={16}
            className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-400"
          />
        </div>
        <JsonDropzone onDrop={handleJsonDrop} />
        <button
          onClick={clearVars}
          className="flex items-center gap-1 px-3 py-2 text-xs text-zinc-400 hover:text-red-500 border border-zinc-300 dark:border-zinc-700 rounded-lg transition-colors shrink-0"
        >
          <Trash2 size={12} />
          Clear
        </button>
      </div>

      {/* Lower area: variables (large) beside the test details.
          On mobile it stacks and the page scrolls; on lg it's a fixed-height split. */}
      <div className="flex flex-col lg:flex-row gap-4 lg:flex-1 lg:min-h-0">
        {/* Variables column — stays large */}
        <div className="flex flex-col lg:flex-1 lg:min-h-0 order-2 lg:order-1">
          <div className="shrink-0 flex items-center gap-2 mb-2">
            <span className={`text-xs font-bold uppercase tracking-wide ${colors.text}`}>
              Dynamic Variables
            </span>
            <span className="text-xs text-zinc-400">
              {filledCount} filled / {varCount} total
            </span>
          </div>
          <div className="pr-1 lg:flex-1 lg:overflow-y-auto lg:min-h-0">
            <VarEditor
              variables={variables}
              onChange={(vars) =>
                setVariables({ ...vars, call_type: CALL_MODES[mode].callType })
              }
              lockedKeys={["call_type"]}
            />
          </div>
        </div>

        {/* Test details column — shows first on mobile, right side on desktop */}
        {selectedTest && (
          <div className="lg:w-96 lg:shrink-0 flex flex-col lg:min-h-0 order-1 lg:order-2">
            <div className="shrink-0 flex items-center justify-between gap-2 mb-2">
              <span className={`text-xs font-bold uppercase tracking-wide ${colors.text}`}>
                Test Details
              </span>
              <span
                title={selectedTest.callTypeScope}
                className="shrink-0 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
              >
                {scopeTag(selectedTest.callTypeScope)}
              </span>
            </div>
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 p-3 text-sm lg:flex-1 lg:overflow-y-auto lg:min-h-0">
              <div className="font-semibold text-zinc-900 dark:text-zinc-100 mb-3">
                {selectedTest.name}
              </div>

              <div className="mb-3">
                <div className={`text-xs font-bold uppercase tracking-wide mb-0.5 ${colors.text}`}>
                  Expected outcome
                </div>
                <p className="text-zinc-700 dark:text-zinc-300">
                  {selectedTest.expectedBehavior}
                </p>
              </div>

              {selectedTest.sample && (
                <div className="mb-3">
                  <div className={`text-xs font-bold uppercase tracking-wide mb-0.5 ${colors.text}`}>
                    Agent should say (sample)
                  </div>
                  <p className="italic text-zinc-600 dark:text-zinc-400 border-l-2 border-zinc-300 dark:border-zinc-700 pl-2">
                    {selectedTest.sample}
                  </p>
                </div>
              )}

              {selectedTest.userMessages.length > 0 && (
                <div className="mb-3">
                  <div className={`text-xs font-bold uppercase tracking-wide mb-0.5 ${colors.text}`}>
                    What to say, in order
                  </div>
                  <ol className="list-decimal list-inside space-y-0.5 text-zinc-700 dark:text-zinc-300">
                    {selectedTest.userMessages.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ol>
                </div>
              )}

              <div>
                <div className={`text-xs font-bold uppercase tracking-wide mb-0.5 ${colors.text}`}>
                  Expected path
                </div>
                <p className="font-mono text-xs text-zinc-500 break-words">
                  {selectedTest.expectedPath}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Pinned footer */}
      <div className="shrink-0 pt-4 mt-4 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
        <div className="text-sm text-zinc-500">
          <span className={`font-medium ${colors.text}`}>
            {CALL_MODES[mode].label}
          </span>
          {selectedTest && <span> &middot; {selectedTest.name}</span>}
        </div>
        <button
          onClick={() => onStartCall(mode, variables)}
          className={`flex items-center gap-2 ${colors.btn} text-white px-6 py-2.5 rounded-lg font-medium transition-colors`}
        >
          <Phone size={18} />
          Start Call
        </button>
      </div>
    </div>
  );
}
