"use client";

import { useState, useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import { Loader2, Shield } from "lucide-react";
import Link from "next/link";
import { ToastProvider } from "@/components/Toast";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { WORKSPACE_META } from "@/lib/workspace";
import UsersTab from "@/components/admin/UsersTab";
import AgentsTab from "@/components/admin/AgentsTab";
import RubricTab from "@/components/admin/RubricTab";
import GradingTab from "@/components/admin/GradingTab";

const ADMIN_EMAILS = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase());

// Tab keys as constants (no magic strings). Order = display order.
const TAB = {
  users: "users",
  agents: "agents",
  rubric: "rubric",
  grading: "grading",
} as const;

type TabKey = (typeof TAB)[keyof typeof TAB];

const TABS: { key: TabKey; label: string }[] = [
  { key: TAB.users, label: "Users" },
  { key: TAB.agents, label: "Agents" },
  { key: TAB.rubric, label: "Rubric" },
  { key: TAB.grading, label: "Grading & Automation" },
];

function AdminContent() {
  const { user, isLoaded } = useUser();
  const { workspace } = useWorkspace();
  const [tab, setTab] = useState<TabKey>(TAB.users);
  // null = still probing server for admin status.
  const [isAdminUser, setIsAdminUser] = useState<boolean | null>(null);

  // Server-authoritative admin probe: a 403 from an admin route means not admin.
  // Mirrors the old "if we got data we're admin" gate, decoupled from the Users
  // tab now that each tab loads its own data.
  useEffect(() => {
    if (!isLoaded) return;
    let cancelled = false;
    const currentEmail = user?.emailAddresses[0]?.emailAddress?.toLowerCase();
    (async () => {
      try {
        const res = await fetch("/api/admin/config");
        // 200 = server confirmed admin; otherwise fall back to the client env
        // allowlist (matches the pre-tabs gate's intent).
        if (!cancelled) {
          setIsAdminUser(res.ok || ADMIN_EMAILS.includes(currentEmail || ""));
        }
      } catch {
        if (!cancelled) setIsAdminUser(ADMIN_EMAILS.includes(currentEmail || ""));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, user]);

  if (!isLoaded || isAdminUser === null) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-zinc-400" size={32} />
      </div>
    );
  }

  if (!isAdminUser) {
    return (
      <div className="text-center py-20">
        <Shield size={48} className="mx-auto text-zinc-300 mb-4" />
        <p className="text-zinc-500">You do not have admin access.</p>
        <Link
          href="/dashboard"
          className="mt-4 inline-flex items-center gap-2 text-sm text-blue-600 hover:underline"
        >
          Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Admin</h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            Editing workspace:{" "}
            <span className="font-medium text-blue-600 dark:text-blue-400 uppercase">
              {WORKSPACE_META[workspace].label}
            </span>
          </p>
        </div>
      </div>

      {/* Tab bar — active = blue bg, inactive = hover (shared app pattern) */}
      <div className="flex items-center gap-1 mb-8 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
              tab === t.key
                ? "bg-blue-600 text-white"
                : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === TAB.users && <UsersTab />}
      {tab === TAB.agents && <AgentsTab />}
      {tab === TAB.rubric && <RubricTab />}
      {tab === TAB.grading && <GradingTab />}
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
