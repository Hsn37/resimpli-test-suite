"use client";

import { useState, type ReactNode } from "react";
import { Loader2, Download, Mic, Gauge } from "lucide-react";
import { useToast } from "@/components/Toast";
import { useWorkspace } from "@/components/WorkspaceProvider";

// Ingestion trigger endpoints (no magic strings).
const ROUTE = {
  backfill: "/api/dashboard/backfill",
  syncVoices: "/api/dashboard/sync-voices",
  gradePending: "/api/dashboard/grade-pending",
} as const;

// Safety cap on the client-driven backfill/grade loops so a UI click can't spin
// forever if a route keeps reporting work.
const MAX_LOOP_ITERATIONS = 100;

type TriggerKey = "backfill" | "syncVoices" | "gradePending";

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/**
 * The Retell ingestion controls — run Backfill / Sync voices / Grade pending for
 * the active workspace, each a press-until-done loop that drains its queue
 * (resumable server-side). Shared so the dashboard hosts it while the admin
 * panel keeps only the config. The routes are admin-gated, so non-admins 403.
 */
export default function IngestionTriggers() {
  const { workspace } = useWorkspace();
  const { toast } = useToast();
  const [running, setRunning] = useState<TriggerKey | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  // Backfill loops (press-until-done) so one click drains the queue; each chunk
  // is resumable server-side via app_config.backfill_cursor.
  async function handleBackfill() {
    setRunning("backfill");
    setStatus(null);
    try {
      let ingested = 0;
      let graded = 0;
      for (let i = 0; i < MAX_LOOP_ITERATIONS; i++) {
        const r = await postJson(ROUTE.backfill);
        ingested += r.counters?.ingested ?? 0;
        graded += r.counters?.graded ?? 0;
        setStatus(`Backfill: ${ingested} ingested, ${graded} graded${r.done ? " — done." : "…"}`);
        if (r.done) break;
      }
      toast("Backfill complete", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Backfill failed", "error");
    } finally {
      setRunning(null);
    }
  }

  async function handleSyncVoices() {
    setRunning("syncVoices");
    setStatus(null);
    try {
      const r = await postJson(ROUTE.syncVoices);
      setStatus(
        `Voices: ${r.agents_upserted} agents synced, ${r.calls_backfilled} calls updated.`
      );
      toast("Voice sync complete", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Voice sync failed", "error");
    } finally {
      setRunning(null);
    }
  }

  // Grade-pending loops until the server reports remaining=0.
  async function handleGradePending() {
    setRunning("gradePending");
    setStatus(null);
    try {
      let graded = 0;
      let failed = 0;
      for (let i = 0; i < MAX_LOOP_ITERATIONS; i++) {
        const r = await postJson(ROUTE.gradePending);
        graded += r.graded ?? 0;
        failed += r.failed ?? 0;
        setStatus(
          `Grading: ${graded} graded, ${failed} errors, ${r.remaining ?? 0} remaining…`
        );
        if ((r.remaining ?? 0) === 0 && (r.batch ?? 0) === 0) break;
      }
      toast("Grade-pending complete", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Grade-pending failed", "error");
    } finally {
      setRunning(null);
    }
  }

  return (
    <div>
      <p className="text-xs text-zinc-500 mb-3">
        Run the Retell → analytics pipeline for the{" "}
        <span className="font-medium text-blue-600 dark:text-blue-400 uppercase">
          {workspace}
        </span>{" "}
        workspace. The cron loop runs these automatically when automation is on.
      </p>
      <div className="flex flex-wrap gap-2">
        <TriggerButton
          icon={<Download size={16} />}
          label="Backfill from Retell"
          active={running === "backfill"}
          disabled={running !== null}
          onClick={handleBackfill}
        />
        <TriggerButton
          icon={<Mic size={16} />}
          label="Sync voices"
          active={running === "syncVoices"}
          disabled={running !== null}
          onClick={handleSyncVoices}
        />
        <TriggerButton
          icon={<Gauge size={16} />}
          label="Grade pending"
          active={running === "gradePending"}
          disabled={running !== null}
          onClick={handleGradePending}
        />
      </div>
      {status && (
        <p className="mt-3 text-xs font-mono text-zinc-500 whitespace-pre-wrap">{status}</p>
      )}
    </div>
  );
}

// A single ingestion-trigger button (shared markup — DRY across the three).
function TriggerButton({
  icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-2 border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-900 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
    >
      {active ? <Loader2 size={16} className="animate-spin" /> : icon}
      {label}
    </button>
  );
}
