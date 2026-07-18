"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { ToastProvider } from "@/components/Toast";
import AgentSelect from "@/components/AgentSelect";
import CallSetup from "@/components/CallSetup";
import CallScreen from "@/components/CallScreen";
import { ALL_AGENTS_TAG, type CallMode } from "@/lib/presets";

type Screen = "agent-select" | "call-setup" | "call";

interface CallConfig {
  agentId: string;
  agentName: string;
  version?: number;
  mode: CallMode;
  variables: Record<string, string>;
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

  function handleStartCall(mode: CallMode, variables: Record<string, string>) {
    setCallConfig({ agentId, agentName, version, mode, variables });
    setScreen("call");
  }

  function handleCallBack() {
    setScreen("call-setup");
  }

  return (
    <div className="p-8">
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
