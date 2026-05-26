"use client";

import { useState, useMemo } from "react";
import { Phone, PhoneIncoming, PhoneOutgoing, Zap, ChevronDown, Trash2 } from "lucide-react";
import { CALL_MODES, VARIABLE_PRESETS, type CallMode } from "@/lib/presets";
import VarEditor from "./VarEditor";
import JsonDropzone from "./JsonDropzone";

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
}

export default function CallSetup({ agentName, onStartCall, onBack }: Props) {
  const [mode, setMode] = useState<CallMode>("inbound");
  const [variables, setVariables] = useState<Record<string, string>>({
    call_type: CALL_MODES.inbound.callType,
  });
  const [activePreset, setActivePreset] = useState<string | null>(null);

  const presetGroups = useMemo(() => {
    const groups: Record<string, typeof VARIABLE_PRESETS> = {};
    for (const p of VARIABLE_PRESETS) {
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

  function handlePreset(presetName: string, presetVars: Record<string, string>) {
    setActivePreset(presetName);
    setVariables({
      ...presetVars,
      call_type: CALL_MODES[mode].callType,
    });
  }

  function handleJsonDrop(vars: Record<string, string>) {
    setActivePreset(null);
    setVariables((prev) => ({
      ...prev,
      ...vars,
      call_type: CALL_MODES[mode].callType,
    }));
  }

  function clearVars() {
    setVariables({ call_type: CALL_MODES[mode].callType });
    setActivePreset(null);
  }

  const varCount = Object.keys(variables).length;
  const filledCount = Object.values(variables).filter((v) => v !== "").length;
  const colors = MODE_COLORS[mode];

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] max-w-3xl mx-auto">
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
          Presets
        </span>
      </div>
      <div className="shrink-0 flex items-center gap-2 mb-4">
        <div className="relative flex-1">
          <select
            value={activePreset ?? ""}
            onChange={(e) => {
              const name = e.target.value;
              if (!name) return;
              const p = VARIABLE_PRESETS.find((pr) => pr.name === name);
              if (p) handlePreset(p.name, p.variables);
            }}
            className="w-full appearance-none bg-zinc-100 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg px-3 py-2 pr-10 text-sm"
          >
            <option value="">Select a preset</option>
            {Object.entries(presetGroups).map(([group, presets]) => (
              <optgroup key={group} label={group}>
                {presets.map((p) => (
                  <option key={p.name} value={p.name}>
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

      {/* Variable count summary */}
      <div className="shrink-0 flex items-center gap-2 mb-2">
        <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">
          Dynamic Variables
        </span>
        <span className="text-xs text-zinc-400">
          {filledCount} filled / {varCount} total
        </span>
      </div>

      {/* Variables — main scrollable area */}
      <div className="flex-1 overflow-y-auto pr-1 min-h-0">
        <VarEditor
          variables={variables}
          onChange={(vars) =>
            setVariables({ ...vars, call_type: CALL_MODES[mode].callType })
          }
          lockedKeys={["call_type"]}
        />
      </div>

      {/* Pinned footer */}
      <div className="shrink-0 pt-4 mt-4 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
        <div className="text-sm text-zinc-500">
          <span className={`font-medium ${colors.text}`}>
            {CALL_MODES[mode].label}
          </span>
          {activePreset && <span> &middot; {activePreset}</span>}
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
