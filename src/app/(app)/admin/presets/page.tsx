"use client";

import { useState } from "react";
import Link from "next/link";
import { Upload } from "lucide-react";
import { ToastProvider } from "@/components/Toast";
import AdminGate from "@/components/admin/AdminGate";
import { GHOST_BUTTON_CLASS } from "@/components/admin/formStyles";
import TestCasesTab from "@/components/admin/presets/TestCasesTab";
import DefaultsTab from "@/components/admin/presets/DefaultsTab";

// Tab keys as constants (no magic strings). Order = display order.
const TAB = {
  cases: "cases",
  defaults: "defaults",
} as const;

type TabKey = (typeof TAB)[keyof typeof TAB];

const TABS: { key: TabKey; label: string }[] = [
  { key: TAB.cases, label: "Test Cases" },
  { key: TAB.defaults, label: "Defaults" },
];

function PresetsContent() {
  const [tab, setTab] = useState<TabKey>(TAB.cases);

  return (
    <div className="w-full max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Test Cases</h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            The live-call cases testers pick in Call Setup. Changes take effect immediately — no
            deploy.
          </p>
        </div>
        <Link href="/admin/presets/import" className={`${GHOST_BUTTON_CLASS} shrink-0`}>
          <Upload size={14} />
          Import / Export
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

      {tab === TAB.cases && <TestCasesTab />}
      {tab === TAB.defaults && <DefaultsTab />}
    </div>
  );
}

export default function PresetsPage() {
  return (
    <ToastProvider>
      <div className="min-h-screen p-8">
        <AdminGate>
          <PresetsContent />
        </AdminGate>
      </div>
    </ToastProvider>
  );
}
