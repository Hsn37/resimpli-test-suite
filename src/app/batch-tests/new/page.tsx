"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { ArrowLeft, FlaskConical, Loader2, Play, Save, Trash2 } from "lucide-react";
import { ToastProvider, useToast } from "@/components/Toast";
import AgentSelect from "@/components/AgentSelect";
import TestCaseSetEditor from "@/components/TestCaseSetEditor";
import type { ResponseEngine } from "@/lib/retell";
import type { TestCase } from "@/lib/testCase";

type CaseDraft = Omit<TestCase, "id">;
type Screen = "agent" | "set" | "editor";

const STEPS: { key: Screen; label: string }[] = [
  { key: "agent", label: "Agent" },
  { key: "set", label: "Test Cases" },
  { key: "editor", label: "Run" },
];

interface TestCaseSetSummary {
  id: string;
  name: string;
  case_count: number;
}

interface RawAgentVersion {
  version: number;
  response_engine?: ResponseEngine;
}

function NewBatchTestContent() {
  const [screen, setScreen] = useState<Screen>("agent");
  const [agentId, setAgentId] = useState("");
  const [agentName, setAgentName] = useState("");
  const [version, setVersion] = useState<number | undefined>();
  const [responseEngine, setResponseEngine] = useState<ResponseEngine | null>(null);

  const [sets, setSets] = useState<TestCaseSetSummary[]>([]);
  const [loadingSets, setLoadingSets] = useState(false);
  const [newSetName, setNewSetName] = useState("");

  const [setId, setSetId] = useState<string | null>(null);
  const [setName, setSetName] = useState("");
  const [cases, setCases] = useState<CaseDraft[]>([]);
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);

  const { toast } = useToast();
  const { user } = useUser();
  const router = useRouter();

  async function handleAgentSelect(id: string, name: string, ver?: number) {
    setAgentId(id);
    setAgentName(name);
    setVersion(ver);

    try {
      const res = await fetch(`/api/agents/${id}`);
      if (!res.ok) throw new Error("Failed to fetch agent details");
      const data = await res.json();
      const versions = (data.versions ?? []) as RawAgentVersion[];
      const match = ver !== undefined ? versions.find((v) => v.version === ver) : undefined;
      const engine: ResponseEngine | undefined = match?.response_engine ?? data.agent?.response_engine;
      if (!engine) throw new Error("Could not resolve a response engine for this agent");
      setResponseEngine(engine);
      setScreen("set");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to resolve response engine";
      toast(message, "error");
    }
  }

  useEffect(() => {
    if (screen !== "set") return;
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setLoadingSets(true);
    fetch("/api/test-case-sets")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch test case sets");
        return res.json();
      })
      .then((data: TestCaseSetSummary[]) => setSets(data))
      .catch((err) => toast(err.message, "error"))
      .finally(() => setLoadingSets(false));
  }, [screen, toast]);

  async function selectExistingSet(id: string, name: string) {
    try {
      const res = await fetch(`/api/test-case-sets/${id}`);
      if (!res.ok) throw new Error("Failed to fetch test case set");
      const data = await res.json();
      setSetId(id);
      setSetName(name);
      setCases(data.cases);
      setScreen("editor");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to load set";
      toast(message, "error");
    }
  }

  async function handleDeleteSet(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This can't be undone.`)) return;
    try {
      const res = await fetch(`/api/test-case-sets/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete test case set");
      setSets((prev) => prev.filter((s) => s.id !== id));
      toast(`Deleted "${name}"`, "success");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to delete set";
      toast(message, "error");
    }
  }

  function createNewSet() {
    const name = newSetName.trim();
    if (!name) return;
    setSetId(null);
    setSetName(name);
    setCases([]);
    setScreen("editor");
  }

  /** Persists the current name/cases to the DB (creating the set on first
   * save), independent of running a batch — so edits aren't only saved as a
   * side effect of starting a run. Returns the set's id. */
  async function saveSet(): Promise<string> {
    if (setId) {
      const res = await fetch(`/api/test-case-sets/${setId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: setName, cases }),
      });
      if (!res.ok) throw new Error("Failed to save test case set");
      return setId;
    }
    const res = await fetch("/api/test-case-sets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: setName, cases }),
    });
    if (!res.ok) throw new Error("Failed to create test case set");
    const data = await res.json();
    setSetId(data.id);
    return data.id;
  }

  async function handleSave() {
    if (cases.length === 0) {
      toast("Add at least one test case before saving", "error");
      return;
    }
    setSaving(true);
    try {
      await saveSet();
      toast("Test case set saved", "success");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to save test case set";
      toast(message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleRun() {
    if (!responseEngine || cases.length === 0) {
      toast("Add at least one test case before running", "error");
      return;
    }
    if (selectedIndices.length === 0) {
      toast("Select at least one test case to run", "error");
      return;
    }
    setSubmitting(true);
    try {
      const currentSetId = await saveSet();

      const res = await fetch("/api/batch-tests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          set_id: currentSetId,
          agent_id: agentId,
          agent_name: agentName,
          version,
          response_engine: responseEngine,
          user_email: user?.emailAddresses[0]?.emailAddress,
          case_indices: selectedIndices.length < cases.length ? selectedIndices : undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to start batch test");
      }
      const data = await res.json();
      router.push(`/batch-tests/${data.id}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to start batch test";
      toast(message, "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-8">
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/batch-tests"
          className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
        >
          <ArrowLeft size={18} />
        </Link>
        <h1 className="font-semibold text-lg flex items-center gap-2 flex-1">
          <FlaskConical size={18} />
          New Batch Test
        </h1>
        <div className="flex items-center gap-1.5 text-xs">
          {STEPS.map((step, i) => {
            const stepIndex = STEPS.findIndex((s) => s.key === screen);
            const isActive = step.key === screen;
            const isDone = i < stepIndex;
            return (
              <div key={step.key} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-zinc-300 dark:text-zinc-700">/</span>}
                <span
                  className={
                    isActive
                      ? "font-semibold text-zinc-900 dark:text-zinc-100"
                      : isDone
                        ? "text-zinc-500"
                        : "text-zinc-300 dark:text-zinc-700"
                  }
                >
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {screen === "agent" && <AgentSelect onSelect={handleAgentSelect} />}

      {screen === "set" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-zinc-500">
              Agent: <span className="font-medium text-zinc-700 dark:text-zinc-300">{agentName}</span>
            </p>
            <button
              onClick={() => setScreen("agent")}
              className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
            >
              Change agent
            </button>
          </div>

          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide">
            Choose a test case set
          </h2>

          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            {loadingSets ? (
              Array.from({ length: 3 }, (_, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between px-3 py-2.5 border-b border-zinc-100 dark:border-zinc-900 last:border-0"
                >
                  <div className="h-4 w-1/2 rounded bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
                  <div className="h-3 w-16 rounded bg-zinc-200 dark:bg-zinc-800 animate-pulse shrink-0" />
                </div>
              ))
            ) : sets.length === 0 ? (
              <p className="text-sm text-zinc-500 py-6 text-center">No saved test case sets yet.</p>
            ) : (
              sets.map((s) => (
                <div
                  key={s.id}
                  className="w-full flex items-center gap-2 px-3 py-2.5 border-b border-zinc-100 dark:border-zinc-900 last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors"
                >
                  <button
                    onClick={() => selectExistingSet(s.id, s.name)}
                    className="flex-1 flex items-center justify-between text-left min-w-0"
                  >
                    <span className="font-medium text-sm truncate">{s.name}</span>
                    <span className="text-xs text-zinc-500 tabular-nums shrink-0 ml-2">{s.case_count} cases</span>
                  </button>
                  <button
                    onClick={() => handleDeleteSet(s.id, s.name)}
                    className="text-zinc-400 hover:text-red-500 transition-colors shrink-0"
                    title="Delete set"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800">
            <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">
              Or create a new set
            </label>
            <div className="flex items-center gap-2 mt-2">
              <input
                type="text"
                placeholder="Set name..."
                value={newSetName}
                onChange={(e) => setNewSetName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createNewSet()}
                className="flex-1 text-sm px-2.5 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
              <button
                onClick={createNewSet}
                disabled={!newSetName.trim()}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {screen === "editor" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">{setName}</h2>
              <p className="text-xs text-zinc-500">
                Agent: {agentName}
                {version !== undefined && ` · v${version}`}
              </p>
            </div>
            <button
              onClick={() => setScreen("set")}
              className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
            >
              Change set
            </button>
          </div>

          <TestCaseSetEditor cases={cases} onChange={setCases} onSelectionChange={setSelectedIndices} />

          <div className="sticky bottom-0 pt-4 pb-2 bg-white dark:bg-zinc-950 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-end gap-2">
            <button
              onClick={handleSave}
              disabled={saving || submitting || cases.length === 0}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
              Save
            </button>
            <button
              onClick={handleRun}
              disabled={submitting || saving || cases.length === 0 || selectedIndices.length === 0}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? <Loader2 className="animate-spin" size={16} /> : <Play size={16} />}
              Run {selectedIndices.length > 0 && selectedIndices.length < cases.length
                ? `${selectedIndices.length} Selected`
                : "Batch Test"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function NewBatchTestPage() {
  return (
    <ToastProvider>
      <NewBatchTestContent />
    </ToastProvider>
  );
}
