"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { Phone } from "lucide-react";
import { ToastProvider } from "@/components/Toast";
import AgentSelect from "@/components/AgentSelect";
import CallSetup from "@/components/CallSetup";
import CallScreen from "@/components/CallScreen";
import { ALL_AGENTS_TAG, type CallMode, type TestPreset } from "@/lib/presets";

type Screen = "agent-select" | "call-setup" | "call";

const STEPS: { key: Screen; label: string }[] = [
  { key: "agent-select", label: "Agent" },
  { key: "call-setup", label: "Setup" },
  { key: "call", label: "Call" },
];

interface CallConfig {
  agentId: string;
  agentName: string;
  version?: number;
  mode: CallMode;
  variables: Record<string, string>;
  testCase: TestPreset | null;
}

function TestCallContent() {
  const [screen, setScreen] = useState<Screen>("agent-select");
  const [agentId, setAgentId] = useState("");
  const [agentName, setAgentName] = useState("");
  const [agentTag, setAgentTag] = useState(ALL_AGENTS_TAG);
  const [version, setVersion] = useState<number | undefined>();
  const [callConfig, setCallConfig] = useState<CallConfig | null>(null);
  const { user } = useUser();

  function handleAgentSelect(id: string, name: string, ver?: number, tag?: string) {
    setAgentId(id);
    setAgentName(name);
    setVersion(ver);
    setAgentTag(tag ?? ALL_AGENTS_TAG);
    // Clear any config left over from a previously tested agent — otherwise
    // its mode/variables leak into this agent's Call Setup screen.
    setCallConfig(null);
    setScreen("call-setup");
  }

  function handleStartCall(
    mode: CallMode,
    variables: Record<string, string>,
    testCase: TestPreset | null
  ) {
    setCallConfig({ agentId, agentName, version, mode, variables, testCase });
    setScreen("call");
  }

  function handleCallBack() {
    setScreen("call-setup");
  }

  return (
    <div className="p-8">
      <div className="max-w-5xl mx-auto flex items-center gap-3 mb-8">
        <h1 className="font-semibold text-lg flex items-center gap-2 flex-1">
          <Phone size={18} />
          Test Call
        </h1>
        <div className="flex items-center gap-1.5 text-xs">
          {STEPS.map((step, i) => {
            const stepIndex = STEPS.findIndex((s) => s.key === screen);
            const isActive = step.key === screen;
            const isDone = i < stepIndex;
            return (
              <div key={step.key} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-zinc-300 dark:text-zinc-700">/</span>}
                <span
                  className={
                    isActive
                      ? "font-semibold text-zinc-900 dark:text-zinc-100"
                      : isDone
                        ? "text-zinc-500"
                        : "text-zinc-300 dark:text-zinc-700"
                  }
                >
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {screen === "agent-select" && (
        <AgentSelect onSelect={handleAgentSelect} />
      )}
      {screen === "call-setup" && (
        <CallSetup
          agentName={agentName}
          agentTag={agentTag}
          onStartCall={handleStartCall}
          onBack={() => setScreen("agent-select")}
          initialMode={callConfig?.mode}
          initialVariables={callConfig?.variables}
        />
      )}
      {screen === "call" && callConfig && (
        <CallScreen
          agentId={callConfig.agentId}
          agentName={callConfig.agentName}
          version={callConfig.version}
          mode={callConfig.mode}
          variables={callConfig.variables}
          testCase={callConfig.testCase}
          userEmail={user?.emailAddresses[0]?.emailAddress ?? ""}
          onBack={handleCallBack}
        />
      )}
    </div>
  );
}

export default function TestCallPage() {
  return (
    <ToastProvider>
      <TestCallContent />
    </ToastProvider>
  );
}
