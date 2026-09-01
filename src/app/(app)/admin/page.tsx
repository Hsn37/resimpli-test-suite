"use client";

import { useState } from "react";
import Link from "next/link";
import { ListChecks } from "lucide-react";
import { ToastProvider } from "@/components/Toast";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { WORKSPACE_META } from "@/lib/workspace";
import AdminGate from "@/components/admin/AdminGate";
import { GHOST_BUTTON_CLASS } from "@/components/admin/formStyles";
import UsersTab from "@/components/admin/UsersTab";
import AgentsTab from "@/components/admin/AgentsTab";
import RubricTab from "@/components/admin/RubricTab";
import GradingTab from "@/components/admin/GradingTab";

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
  const { workspace } = useWorkspace();
  const [tab, setTab] = useState<TabKey>(TAB.users);

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
        <Link href="/admin/presets" className={`${GHOST_BUTTON_CLASS} shrink-0`}>
          <ListChecks size={14} />
          Test Cases
        </Link>
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
        <AdminGate>
          <AdminContent />
        </AdminGate>
      </div>
    </ToastProvider>
  );
}
