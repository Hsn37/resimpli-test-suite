"use client";

import { useState, useCallback, useMemo } from "react";
import { UserButton, useUser } from "@clerk/nextjs";
import { Settings, PanelLeftClose, PanelLeftOpen, Phone, FlaskConical } from "lucide-react";
import Link from "next/link";
import { ToastProvider, useToast } from "@/components/Toast";
import AgentSelect from "@/components/AgentSelect";
import CallSetup from "@/components/CallSetup";
import CallScreen from "@/components/CallScreen";
import CallHistory from "@/components/CallHistory";
import { ALL_AGENTS_TAG, type CallMode } from "@/lib/presets";

type Screen = "agent-select" | "call-setup" | "call";

interface CallConfig {
  agentId: string;
  agentName: string;
  version?: number;
  mode: CallMode;
  variables: Record<string, string>;
}

function AppContent() {
  const [screen, setScreen] = useState<Screen>("agent-select");
  const [agentId, setAgentId] = useState("");
  const [agentName, setAgentName] = useState("");
  const [agentTag, setAgentTag] = useState(ALL_AGENTS_TAG);
  const [version, setVersion] = useState<number | undefined>();
  const [callConfig, setCallConfig] = useState<CallConfig | null>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { user } = useUser();
  const isAdmin = useMemo(() => {
    const adminEmails = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || "")
      .split(",")
      .map((e) => e.trim().toLowerCase());
    const email = user?.emailAddresses[0]?.emailAddress?.toLowerCase();
    return email ? adminEmails.includes(email) : false;
  }, [user]);
  const { toast } = useToast();

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
    setHistoryKey((k) => k + 1);
    setScreen("call-setup");
  }

  const handleDownload = useCallback(
    async (callId: string) => {
      try {
        const res = await fetch(`/api/calls/${callId}`);
        if (!res.ok) throw new Error("Failed to fetch call data");
        const data = await res.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${callId}.json`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Download failed";
        toast(message, "error");
      }
    },
    [toast]
  );

  return (
    <div className="flex flex-1">
      {/* Sidebar */}
      <aside
        className={`border-r border-zinc-200 dark:border-zinc-800 overflow-y-auto hidden md:flex flex-col transition-all duration-200 ${
          sidebarOpen ? "w-72 p-4" : "w-12 p-2 items-center"
        }`}
      >
        {sidebarOpen ? (
          <>
            <div className="flex items-center justify-between mb-6">
              <h1 className="font-semibold text-sm">Resimpli Test Suite</h1>
              <div className="flex items-center gap-2">
                <Link
                  href="/calls"
                  className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                  title="Calls"
                >
                  <Phone size={16} />
                </Link>
                <Link
                  href="/batch-tests"
                  className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                  title="Batch Tests"
                >
                  <FlaskConical size={16} />
                </Link>
                {isAdmin && (
                  <Link
                    href="/admin"
                    className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                  >
                    <Settings size={16} />
                  </Link>
                )}
                <UserButton />
                <button
                  onClick={() => setSidebarOpen(false)}
                  className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                >
                  <PanelLeftClose size={16} />
                </button>
              </div>
            </div>
            <CallHistory key={historyKey} onDownload={handleDownload} />
          </>
        ) : (
          <div className="flex flex-col items-center gap-3 pt-2">
            <button
              onClick={() => setSidebarOpen(true)}
              className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            >
              <PanelLeftOpen size={18} />
            </button>
            <UserButton />
            <Link
              href="/calls"
              className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
              title="Calls"
            >
              <Phone size={16} />
            </Link>
            <Link
              href="/batch-tests"
              className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
              title="Batch Tests"
            >
              <FlaskConical size={16} />
            </Link>
            {isAdmin && (
              <Link
                href="/admin"
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
              >
                <Settings size={16} />
              </Link>
            )}
          </div>
        )}
      </aside>

      {/* Main content */}
      <main className="flex-1 p-8 overflow-y-auto">
        {/* Mobile header */}
        <div className="flex items-center justify-between mb-6 md:hidden">
          <h1 className="font-semibold">Resimpli Test Suite</h1>
          <div className="flex items-center gap-2">
            <Link
              href="/calls"
              className="text-zinc-400 hover:text-zinc-600 transition-colors"
              title="Calls"
            >
              <Phone size={16} />
            </Link>
            <Link
              href="/batch-tests"
              className="text-zinc-400 hover:text-zinc-600 transition-colors"
              title="Batch Tests"
            >
              <FlaskConical size={16} />
            </Link>
            {isAdmin && (
              <Link
                href="/admin"
                className="text-zinc-400 hover:text-zinc-600 transition-colors"
              >
                <Settings size={16} />
              </Link>
            )}
            <UserButton />
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
            userEmail={user?.emailAddresses[0]?.emailAddress ?? ""}
            onBack={handleCallBack}
          />
        )}
      </main>
    </div>
  );
}

export default function Home() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}
