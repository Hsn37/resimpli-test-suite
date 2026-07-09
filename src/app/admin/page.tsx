"use client";

import { useState, useEffect, useCallback } from "react";
import { useUser } from "@clerk/nextjs";
import {
  UserPlus,
  Trash2,
  Loader2,
  ArrowLeft,
  Mail,
  Shield,
  Bot,
} from "lucide-react";
import { ToastProvider, useToast } from "@/components/Toast";
import { AGENT_TAGS, ALL_AGENTS_TAG } from "@/lib/presets";
import Link from "next/link";

const ADMIN_EMAILS = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase());

interface UserRecord {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  createdAt: number;
  imageUrl: string;
}

interface PendingInvite {
  id: string;
  email: string;
  status: string;
  createdAt: number;
}

interface AgentRecord {
  agent_id: string;
  agent_name: string;
  enabled: boolean;
  tag: string;
}

function AdminContent() {
  const { user, isLoaded } = useUser();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [togglingAgentId, setTogglingAgentId] = useState<string | null>(null);
  const [bulkToggling, setBulkToggling] = useState(false);
  const { toast } = useToast();

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/users");
      if (res.status === 403) {
        toast("You do not have admin access", "error");
        return;
      }
      if (!res.ok) throw new Error("Failed to fetch users");
      const data = await res.json();
      setUsers(data.users || []);
      setPendingInvites(data.pendingInvites || []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast(message, "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

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

  useEffect(() => {
    if (isLoaded) {
      fetchUsers();
      fetchAgents();
    }
  }, [isLoaded, fetchUsers, fetchAgents]);

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

  async function handleInvite() {
    const email = inviteEmail.trim();
    if (!email) return;
    setInviting(true);
    try {
      const res = await fetch("/api/admin/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailAddress: email }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to invite");
      }
      toast(`Invitation sent to ${email}`, "success");
      setInviteEmail("");
      fetchUsers();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Invite failed";
      toast(message, "error");
    } finally {
      setInviting(false);
    }
  }

  async function handleDelete(userId: string) {
    if (!confirm("Remove this user? They will lose access.")) return;
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to remove user");
      }
      toast("User removed", "success");
      fetchUsers();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Delete failed";
      toast(message, "error");
    }
  }

  if (!isLoaded || loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-zinc-400" size={32} />
      </div>
    );
  }

  const currentEmail = user?.emailAddresses[0]?.emailAddress?.toLowerCase();
  const isAdminUser =
    ADMIN_EMAILS.includes(currentEmail || "") ||
    // Fallback: admin check happens server-side, if we got data we're admin
    users.length > 0;

  if (!isAdminUser && !loading) {
    return (
      <div className="text-center py-20">
        <Shield size={48} className="mx-auto text-zinc-300 mb-4" />
        <p className="text-zinc-500">You do not have admin access.</p>
        <Link
          href="/"
          className="mt-4 inline-flex items-center gap-2 text-sm text-blue-600 hover:underline"
        >
          <ArrowLeft size={14} />
          Back to app
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-semibold">User Management</h1>
        <Link
          href="/"
          className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 flex items-center gap-1 transition-colors"
        >
          <ArrowLeft size={14} />
          Back
        </Link>
      </div>

      {/* Invite form */}
      <div className="flex items-center gap-2 mb-8">
        <div className="relative flex-1">
          <Mail
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
          />
          <input
            type="email"
            placeholder="Email address to invite"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleInvite()}
            className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm"
          />
        </div>
        <button
          onClick={handleInvite}
          disabled={inviting}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        >
          {inviting ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <UserPlus size={16} />
          )}
          Invite
        </button>
      </div>

      {/* Pending invites */}
      {pendingInvites.length > 0 && (
        <div className="mb-8">
          <h3 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
            Pending Invites
          </h3>
          <div className="space-y-2">
            {pendingInvites.map((invite) => (
              <div
                key={invite.id}
                className="flex items-center gap-3 p-3 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 text-sm"
              >
                <Mail size={14} className="text-zinc-400" />
                <span className="flex-1">{invite.email}</span>
                <span className="text-xs text-amber-500 font-medium">
                  Pending
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Current users */}
      <div>
        <h3 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
          Team Members
        </h3>
        <div className="space-y-2">
          {users.map((u) => (
            <div
              key={u.id}
              className="flex items-center gap-3 p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 text-sm"
            >
              {u.imageUrl ? (
                <img
                  src={u.imageUrl}
                  alt=""
                  className="w-8 h-8 rounded-full"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-zinc-200 dark:bg-zinc-800" />
              )}
              <div className="flex-1 min-w-0">
                <div className="font-medium">
                  {u.firstName} {u.lastName}
                </div>
                <div className="text-xs text-zinc-500">{u.email}</div>
              </div>
              {u.email.toLowerCase() !== currentEmail && (
                <button
                  onClick={() => handleDelete(u.id)}
                  className="text-zinc-400 hover:text-red-500 transition-colors"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Agent management */}
      <div className="mt-10">
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
                Select all
              </button>
              <button
                onClick={() => handleToggleAllAgents(false)}
                disabled={bulkToggling || agents.every((a) => !a.enabled)}
                className="text-xs font-medium text-zinc-500 hover:underline disabled:opacity-40 disabled:no-underline"
              >
                Deselect all
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
    </div>
  );
}

export default function AdminPage() {
  return (
    <ToastProvider>
      <div className="min-h-screen p-8">
        <AdminContent />
      </div>
    </ToastProvider>
  );
}
