"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, Bot } from "lucide-react";
import { useToast } from "@/components/Toast";
import { AGENT_TAGS, ALL_AGENTS_TAG } from "@/lib/presets";

interface AgentRecord {
  agent_id: string;
  agent_name: string;
  enabled: boolean;
  tag: string;
}

// Agent management tab. Moved verbatim from the pre-tabs admin page: enable/
// disable (single + bulk) and per-agent direction tagging. No behavior change.
export default function AgentsTab() {
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [togglingAgentId, setTogglingAgentId] = useState<string | null>(null);
  const [bulkToggling, setBulkToggling] = useState(false);
  const { toast } = useToast();

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/agents");
      if (res.status === 403) return;
      if (!res.ok) throw new Error("Failed to fetch agents");
      const data = await res.json();
      setAgents(data.agents || []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast(message, "error");
    } finally {
      setAgentsLoading(false);
    }
  }, [toast]);

  // Defer the loader into a microtask so state updates land in a callback, not
  // synchronously in the effect body (avoids react-hooks/set-state-in-effect).
  useEffect(() => {
    void Promise.resolve().then(fetchAgents);
  }, [fetchAgents]);

  /**
   * Optimistically applies `patch` to the given agents, PATCHes the server,
   * and on failure re-fetches the canonical list rather than reverting to a
   * locally-captured snapshot — a snapshot can be stale if a second edit to
   * the same agent already landed successfully while this one was in flight.
   */
  async function updateAgents(
    ids: string[],
    patch: { enabled?: boolean; tag?: string },
    successMessage?: string
  ) {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    setAgents((prev) =>
      prev.map((a) => (idSet.has(a.agent_id) ? { ...a, ...patch } : a))
    );
    try {
      const res = await fetch("/api/admin/agents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentIds: ids, ...patch }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update agent(s)");
      }
      if (successMessage) toast(successMessage, "success");
    } catch (err: unknown) {
      fetchAgents();
      const message = err instanceof Error ? err.message : "Update failed";
      toast(message, "error");
    }
  }

  async function handleToggleAgent(agent: AgentRecord) {
    const nextEnabled = !agent.enabled;
    setTogglingAgentId(agent.agent_id);
    await updateAgents(
      [agent.agent_id],
      { enabled: nextEnabled },
      `${agent.agent_name || agent.agent_id} ${nextEnabled ? "enabled" : "disabled"}`
    );
    setTogglingAgentId(null);
  }

  async function handleTagChange(agent: AgentRecord, tag: string) {
    await updateAgents(
      [agent.agent_id],
      { tag },
      `${agent.agent_name || agent.agent_id} tagged ${tag === ALL_AGENTS_TAG ? "All" : tag}`
    );
  }

  async function handleToggleAllAgents(enabled: boolean) {
    if (agents.length === 0) return;
    setBulkToggling(true);
    await updateAgents(
      agents.map((a) => a.agent_id),
      { enabled },
      `All agents ${enabled ? "enabled" : "disabled"}`
    );
    setBulkToggling(false);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide">
          Agents
        </h3>
        {!agentsLoading && agents.length > 0 && (
          <div className="flex items-center gap-3">
            <button
              onClick={() => handleToggleAllAgents(true)}
              disabled={bulkToggling || agents.every((a) => a.enabled)}
              className="text-xs font-medium text-blue-600 hover:underline disabled:opacity-40 disabled:no-underline"
            >
              Enable All
            </button>
            <button
              onClick={() => handleToggleAllAgents(false)}
              disabled={bulkToggling || agents.every((a) => !a.enabled)}
              className="text-xs font-medium text-zinc-500 hover:underline disabled:opacity-40 disabled:no-underline"
            >
              Disable All
            </button>
          </div>
        )}
      </div>
      <p className="text-xs text-zinc-500 mb-3">
        Disabled agents are hidden from the homepage and cannot be tested.
        Tag an agent to a direction to only show matching test presets — &quot;All&quot; shows every preset.
      </p>
      {agentsLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="animate-spin text-zinc-400" size={24} />
        </div>
      ) : (
        <div className="space-y-2">
          {agents.map((agent) => (
            <div
              key={agent.agent_id}
              className="flex items-center gap-3 p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 text-sm"
            >
              <Bot size={16} className="shrink-0 text-zinc-400" />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">
                  {agent.agent_name || agent.agent_id}
                </div>
                <div className="text-xs text-zinc-500 truncate">
                  {agent.agent_id}
                </div>
              </div>
              <select
                value={agent.tag}
                onChange={(e) => handleTagChange(agent, e.target.value)}
                className="shrink-0 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5"
              >
                <option value={ALL_AGENTS_TAG}>All</option>
                {AGENT_TAGS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <button
                onClick={() => handleToggleAgent(agent)}
                disabled={togglingAgentId === agent.agent_id}
                role="switch"
                aria-checked={agent.enabled}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                  agent.enabled
                    ? "bg-blue-600"
                    : "bg-zinc-300 dark:bg-zinc-700"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    agent.enabled ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
          ))}
          {agents.length === 0 && (
            <div className="text-center py-10 text-zinc-500 text-sm">
              No agents found.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
