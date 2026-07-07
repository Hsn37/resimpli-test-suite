"use client";

import { useEffect, useMemo, useState } from "react";
import { Bot, Check, Search, X } from "lucide-react";
import { useToast } from "./Toast";
import Skeleton from "./Skeleton";

interface Agent {
  agent_id: string;
  agent_name: string;
}

interface AgentVersion {
  version: number;
  version_title?: string;
  version_description?: string;
  is_published?: boolean;
  last_modification_timestamp?: number;
}

interface Props {
  onSelect: (agentId: string, agentName: string, version?: number) => void;
}

export default function AgentSelect({ onSelect }: Props) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [versions, setVersions] = useState<AgentVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<number | undefined>();
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [search, setSearch] = useState("");
  const { toast } = useToast();

  const filteredAgents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter(
      (a) =>
        a.agent_name?.toLowerCase().includes(q) ||
        a.agent_id.toLowerCase().includes(q)
    );
  }, [agents, search]);

  useEffect(() => {
    fetch("/api/agents")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch agents");
        return res.json();
      })
      .then((data: Agent[]) => {
        const seen = new Set<string>();
        const unique = data.filter((a) => {
          if (seen.has(a.agent_id)) return false;
          seen.add(a.agent_id);
          return true;
        });
        setAgents(unique);
      })
      .catch((err) => toast(err.message, "error"))
      .finally(() => setLoading(false));
  }, [toast]);

  async function handleAgentClick(agent: Agent) {
    setSelectedAgent(agent);
    setSelectedVersion(undefined);
    setVersions([]);
    setLoadingVersions(true);

    try {
      const res = await fetch(`/api/agents/${agent.agent_id}`);
      if (!res.ok) throw new Error("Failed to fetch agent details");
      const data = await res.json();
      if (data.versions && data.versions.length > 0) {
        setVersions(
          [...data.versions].sort(
            (a: AgentVersion, b: AgentVersion) => b.version - a.version
          )
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast(message, "error");
    } finally {
      setLoadingVersions(false);
    }
  }

  function handleConfirm() {
    if (!selectedAgent) return;
    onSelect(selectedAgent.agent_id, selectedAgent.agent_name, selectedVersion);
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] max-w-4xl mx-auto">
      <h2 className="text-xl font-semibold mb-4 shrink-0">Select an Agent</h2>

      <div className="flex-1 flex gap-6 min-h-0">
        {/* Agent list — left panel */}
        <div className="w-1/2 flex flex-col min-h-0">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">
            Agents
          </p>
          {/* Search */}
          <div className="relative mb-2 shrink-0">
            <Search
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or ID..."
              disabled={loading}
              className="w-full text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 pl-9 pr-8 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-zinc-400 disabled:opacity-60"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
              >
                <X size={15} />
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {loading &&
              Array.from({ length: 6 }, (_, i) => (
                <div
                  key={i}
                  className="w-full flex items-center gap-3 p-3 rounded-lg border border-zinc-200 dark:border-zinc-800"
                >
                  <Skeleton className="h-[18px] w-[18px] rounded-full shrink-0" />
                  <div className="flex-1 min-w-0">
                    <Skeleton className="h-4 w-2/3 mb-1.5" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                </div>
              ))}
            {!loading && filteredAgents.map((agent) => (
              <button
                key={agent.agent_id}
                onClick={() => handleAgentClick(agent)}
                className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                  selectedAgent?.agent_id === agent.agent_id
                    ? "border-blue-500 bg-blue-500/10"
                    : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600"
                }`}
              >
                <Bot size={18} className="shrink-0 text-zinc-500" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">
                    {agent.agent_name || agent.agent_id}
                  </div>
                  <div className="text-xs text-zinc-500 truncate">
                    {agent.agent_id}
                  </div>
                </div>
              </button>
            ))}
            {!loading && filteredAgents.length === 0 && (
              <div className="text-center py-10 text-zinc-500 text-sm">
                {agents.length === 0
                  ? "No agents found."
                  : `No agents match "${search}".`}
              </div>
            )}
          </div>
        </div>

        {/* Version list — right panel */}
        <div className="w-1/2 flex flex-col min-h-0">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">
            Versions
          </p>
          {!selectedAgent ? (
            <div className="flex-1 flex items-center justify-center text-zinc-400 text-sm">
              Select an agent to see versions
            </div>
          ) : loadingVersions ? (
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-800">
                  <Skeleton className="h-4 w-16 mb-1.5" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ))}
            </div>
          ) : versions.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-zinc-400 text-sm">
              No versions found
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {/* Latest (no version specified) */}
              <button
                onClick={() => setSelectedVersion(undefined)}
                className={`w-full p-3 rounded-lg border text-left transition-colors ${
                  selectedVersion === undefined
                    ? "border-blue-500 bg-blue-500/10"
                    : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">Latest</span>
                  {selectedVersion === undefined && (
                    <Check size={14} className="text-blue-500" />
                  )}
                </div>
                <p className="text-xs text-zinc-500 mt-1">
                  Uses the current published version
                </p>
              </button>

              {versions.map((v) => (
                <button
                  key={v.version}
                  onClick={() => setSelectedVersion(v.version)}
                  className={`w-full p-3 rounded-lg border text-left transition-colors ${
                    selectedVersion === v.version
                      ? "border-blue-500 bg-blue-500/10"
                      : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">
                      v{v.version}
                    </span>
                    {v.is_published && (
                      <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                        Published
                      </span>
                    )}
                    {selectedVersion === v.version && (
                      <Check size={14} className="text-blue-500 ml-auto" />
                    )}
                  </div>
                  {v.version_title && (
                    <p className="text-sm text-zinc-700 dark:text-zinc-300 mt-1">
                      {v.version_title}
                    </p>
                  )}
                  {v.version_description && (
                    <p className="text-xs text-zinc-500 mt-1 line-clamp-2">
                      {v.version_description}
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Pinned footer */}
      {selectedAgent && (
        <div className="shrink-0 pt-4 mt-4 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <div className="text-sm text-zinc-500">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              {selectedAgent.agent_name}
            </span>
            {selectedVersion !== undefined && (
              <span> &middot; v{selectedVersion}</span>
            )}
            {selectedVersion === undefined && <span> &middot; Latest</span>}
          </div>
          <button
            onClick={handleConfirm}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition-colors"
          >
            Continue
          </button>
        </div>
      )}
    </div>
  );
}
