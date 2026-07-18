"use client";

import { useState, useEffect, useCallback } from "react";
import { useUser } from "@clerk/nextjs";
import { UserPlus, Trash2, Loader2, Mail } from "lucide-react";
import { useToast } from "@/components/Toast";

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

// User management tab. Moved verbatim from the pre-tabs admin page: invite,
// pending invites, and the team-members list. No behavior change.
export default function UsersTab() {
  const { user } = useUser();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
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

  // Defer the loader into a microtask so state updates land in a callback, not
  // synchronously in the effect body (avoids react-hooks/set-state-in-effect).
  useEffect(() => {
    void Promise.resolve().then(fetchUsers);
  }, [fetchUsers]);

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

  const currentEmail = user?.emailAddresses[0]?.emailAddress?.toLowerCase();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-zinc-400" size={32} />
      </div>
    );
  }

  return (
    <div>
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
    </div>
  );
}
