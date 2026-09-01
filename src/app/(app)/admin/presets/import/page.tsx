"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ToastProvider } from "@/components/Toast";
import AdminGate from "@/components/admin/AdminGate";
import { GHOST_BUTTON_CLASS } from "@/components/admin/formStyles";
import ImportPanel from "@/components/admin/presets/ImportPanel";

export default function PresetImportPage() {
  return (
    <ToastProvider>
      <div className="min-h-screen p-8">
        <AdminGate>
          <div className="w-full max-w-4xl mx-auto">
            <div className="flex items-start justify-between gap-4 mb-8">
              <div>
                <h1 className="text-2xl font-semibold">Import &amp; Export</h1>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Bulk-add cases from JSON, or download the library.
                </p>
              </div>
              <Link href="/admin/presets" className={`${GHOST_BUTTON_CLASS} shrink-0`}>
                <ArrowLeft size={14} />
                Back to test cases
              </Link>
            </div>
            <ImportPanel />
          </div>
        </AdminGate>
      </div>
    </ToastProvider>
  );
}
