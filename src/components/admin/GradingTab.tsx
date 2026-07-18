"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, Save, CheckCircle2, XCircle } from "lucide-react";
import { useToast } from "@/components/Toast";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { APP_CONFIG_KEYS } from "@/lib/graderRubric";

interface GradingConfig {
  grader_model: string;
  tracking_start_date: string;
  agent_id_allowlist: string[];
  automation_enabled: boolean;
}

const INPUT_CLASS =
  "w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm";
const LABEL_CLASS = "block text-sm font-medium mb-1.5";
const HINT_CLASS = "text-xs text-zinc-500 mb-2";

// Grading & Automation tab: edit grader_model, tracking_start_date,
// agent_id_allowlist, and automation_enabled per active workspace. Also shows a
// boolean "OpenAI key present" — the key itself is never sent to the client.
// The Retell ingestion *triggers* live on the dashboard (IngestionTriggers).
export default function GradingTab() {
  const { workspace } = useWorkspace();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<GradingConfig | null>(null);
  const [allowlistText, setAllowlistText] = useState("");
  const [openaiKeyPresent, setOpenaiKeyPresent] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/config");
      if (!res.ok) throw new Error("Failed to load config");
      const data = await res.json();
      const c = data.config as GradingConfig;
      setConfig(c);
      setAllowlistText((c.agent_id_allowlist || []).join("\n"));
      setOpenaiKeyPresent(Boolean(data.openaiKeyPresent));
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Load failed", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Reload when the active workspace changes — each workspace has its own config.
  // Deferred into a microtask so state updates land in a callback (avoids
  // react-hooks/set-state-in-effect).
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load, workspace]);

  function update<K extends keyof GradingConfig>(key: K, value: GradingConfig[K]) {
    setConfig((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  // Split the textarea into a clean agent-id list on newlines or commas.
  function parseAllowlist(text: string): string[] {
    return text
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async function handleSave() {
    if (!config) return;
    setSaving(true);
    try {
      const body = {
        [APP_CONFIG_KEYS.graderModel]: config.grader_model,
        [APP_CONFIG_KEYS.trackingStartDate]: config.tracking_start_date,
        [APP_CONFIG_KEYS.agentIdAllowlist]: parseAllowlist(allowlistText),
        [APP_CONFIG_KEYS.automationEnabled]: config.automation_enabled,
      };
      const res = await fetch("/api/admin/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Save failed");
      }
      toast("Grading config saved", "success");
      load();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading || !config) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-zinc-400" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* OpenAI key presence — boolean only, never the key itself */}
      <div className="flex items-center gap-2 p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 text-sm">
        {openaiKeyPresent ? (
          <CheckCircle2 size={16} className="text-green-600" />
        ) : (
          <XCircle size={16} className="text-amber-500" />
        )}
        <span className="font-medium">OpenAI API key</span>
        <span className="text-zinc-500">
          {openaiKeyPresent
            ? "present on the server — live grading is possible."
            : "not set — grading returns errors until it's configured."}
        </span>
      </div>

      <div>
        <label className={LABEL_CLASS}>Grader model</label>
        <p className={HINT_CLASS}>OpenAI model used for the 2-layer grader.</p>
        <input
          value={config.grader_model}
          onChange={(e) => update("grader_model", e.target.value)}
          className={INPUT_CLASS}
        />
      </div>

      <div>
        <label className={LABEL_CLASS}>Tracking start date</label>
        <p className={HINT_CLASS}>Calls before this date are ignored by grading/ingestion.</p>
        <input
          type="date"
          value={config.tracking_start_date}
          onChange={(e) => update("tracking_start_date", e.target.value)}
          className={`${INPUT_CLASS} w-48`}
        />
      </div>

      <div>
        <label className={LABEL_CLASS}>Agent ID allowlist</label>
        <p className={HINT_CLASS}>
          One agent ID per line (or comma-separated). Empty = all agents in this workspace.
        </p>
        <textarea
          value={allowlistText}
          onChange={(e) => setAllowlistText(e.target.value)}
          rows={4}
          placeholder="agent_abc123&#10;agent_def456"
          className={`${INPUT_CLASS} font-mono`}
        />
      </div>

      <div className="flex items-center justify-between p-3 rounded-lg border border-zinc-200 dark:border-zinc-800">
        <div>
          <div className="text-sm font-medium">Automation enabled</div>
          <div className="text-xs text-zinc-500">
            Auto-grade new calls in this workspace as they come in.
          </div>
        </div>
        <button
          onClick={() => update("automation_enabled", !config.automation_enabled)}
          role="switch"
          aria-checked={config.automation_enabled}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
            config.automation_enabled ? "bg-blue-600" : "bg-zinc-300 dark:bg-zinc-700"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              config.automation_enabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          Save changes
        </button>
      </div>
    </div>
  );
}
