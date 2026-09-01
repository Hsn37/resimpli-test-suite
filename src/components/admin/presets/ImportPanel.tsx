"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ClipboardCopy,
  Download,
  Loader2,
  Upload,
} from "lucide-react";
import { useToast } from "@/components/Toast";
import {
  BUTTON_CLASS,
  GHOST_BUTTON_CLASS,
  INPUT_CLASS,
  LABEL_CLASS,
  SECTION_TITLE_CLASS,
} from "@/components/admin/formStyles";
import { buildAgentInstructions, parseExchangePayload } from "@/lib/presetImport";
import { presetId, type PresetDefaults, type TestPresetRecord } from "@/lib/testPreset";

const IMPORT_ENDPOINT = "/api/admin/presets/import";
const EXPORT_ENDPOINT = "/api/admin/presets/export";

interface RowResult {
  index: number;
  id: string;
  test_no: number;
  scenario: string;
  action: "create" | "update";
  errors: string[];
}

interface ImportResponse {
  applied: boolean;
  results: RowResult[];
  validCount: number;
  invalidCount: number;
}

export default function ImportPanel() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<TestPresetRecord[]>([]);
  const [defaults, setDefaults] = useState<PresetDefaults>({});
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ImportResponse | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/presets");
      if (!res.ok) throw new Error("Failed to load test cases");
      const data = await res.json();
      setRecords(data.records ?? []);
      setDefaults(data.defaults ?? {});
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Load failed", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  const nextTestNo = useMemo(
    () => records.reduce((max, r) => Math.max(max, r.test_no), 0) + 1,
    [records]
  );
  const groups = useMemo(
    () => [...new Set(records.map((r) => r.group_name))],
    [records]
  );

  async function copyInstructions() {
    // Built from the live defaults, so the variable list the agent is handed is
    // always the real one — that is what stops it inventing variable names.
    const instructions = buildAgentInstructions(defaults, nextTestNo, groups);
    try {
      await navigator.clipboard.writeText(instructions);
      toast("Instructions copied — paste them into your AI agent", "success");
    } catch {
      toast("Clipboard blocked by the browser", "error");
    }
  }

  async function send(apply: boolean) {
    let tests: Record<string, unknown>[];
    try {
      tests = parseExchangePayload(text);
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Invalid JSON", "error");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(IMPORT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tests, apply }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Import failed");
      setPreview(data as ImportResponse);
      if (apply) {
        toast(
          `Imported ${data.validCount} case${data.validCount === 1 ? "" : "s"}` +
            (data.invalidCount ? `, skipped ${data.invalidCount}` : ""),
          "success"
        );
        await load();
      }
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Import failed", "error");
    } finally {
      setBusy(false);
    }
  }

  function readFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      setText(String(e.target?.result ?? ""));
      setPreview(null);
    };
    reader.readAsText(file);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-zinc-400" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {/* Step 1 — instructions for the agent */}
      <section className="space-y-3">
        <h3 className={SECTION_TITLE_CLASS}>1 · Brief your AI agent</h3>
        <p className="text-xs text-zinc-500">
          Copies a full spec — field contract, the four enums, every variable name for each call
          type, and the rules an import is rejected on. Paste it into your agent along with the
          scenarios you want, and it returns JSON you can paste below. Next free number is{" "}
          <code className="font-mono">{presetId(nextTestNo)}</code>.
        </p>
        <button type="button" onClick={copyInstructions} className={BUTTON_CLASS}>
          <ClipboardCopy size={16} />
          Copy agent instructions
        </button>
      </section>

      {/* Step 2 — paste and validate */}
      <section className="space-y-3">
        <h3 className={SECTION_TITLE_CLASS}>2 · Paste the JSON</h3>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setPreview(null);
          }}
          rows={10}
          placeholder='{"tests": [ … ]}  — or a bare array of cases'
          className={`${INPUT_CLASS} w-full font-mono text-xs leading-relaxed`}
        />
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => send(false)}
            disabled={busy || !text.trim()}
            className={BUTTON_CLASS}
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            Validate
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className={GHOST_BUTTON_CLASS}
          >
            <Upload size={14} />
            Upload a .json file
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) readFile(file);
              e.target.value = "";
            }}
          />
        </div>
      </section>

      {/* Step 3 — preview + commit */}
      {preview && (
        <section className="space-y-3">
          <h3 className={SECTION_TITLE_CLASS}>3 · Review</h3>
          <p className="text-xs text-zinc-500">
            {preview.validCount} ready
            {preview.invalidCount > 0 && `, ${preview.invalidCount} with problems (skipped)`}
            {preview.applied && " · imported"}
          </p>
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-900">
            {preview.results.map((row) => (
              <div key={row.index} className="flex items-start gap-3 px-3 py-2">
                {row.errors.length === 0 ? (
                  <Check size={14} className="text-green-500 mt-1 shrink-0" />
                ) : (
                  <AlertTriangle size={14} className="text-red-500 mt-1 shrink-0" />
                )}
                <code className="text-xs font-mono text-zinc-400 shrink-0 w-12 pt-0.5">
                  {row.id}
                </code>
                <span className="text-[10px] font-medium uppercase text-zinc-400 shrink-0 w-14 pt-1">
                  {row.action}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate">{row.scenario || "(no scenario)"}</p>
                  {row.errors.map((error) => (
                    <p key={error} className="text-xs text-red-500">
                      {error}
                    </p>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {!preview.applied && preview.validCount > 0 && (
            <button
              type="button"
              onClick={() => send(true)}
              disabled={busy}
              className={BUTTON_CLASS}
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
              Import {preview.validCount} case{preview.validCount === 1 ? "" : "s"}
              {preview.invalidCount > 0 && ` (skip ${preview.invalidCount})`}
            </button>
          )}
        </section>
      )}

      {/* Export */}
      <section className="space-y-3 border-t border-zinc-200 dark:border-zinc-800 pt-8">
        <h3 className={SECTION_TITLE_CLASS}>Export</h3>
        <p className="text-xs text-zinc-500">
          JSON is the same shape this page imports — commit it as an offline archive. CSV is the
          QA-sheet column layout, with the tester columns left blank.
        </p>
        <ExportControls count={records.length} />
      </section>
    </div>
  );
}

/** Range + format picker. Downloads go straight to the export route. */
function ExportControls({ count }: { count: number }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (from.trim()) params.set("from", from.trim());
    if (to.trim()) params.set("to", to.trim());
    return params;
  }, [from, to]);

  function href(format: string) {
    const params = new URLSearchParams(query);
    params.set("format", format);
    return `${EXPORT_ENDPOINT}?${params.toString()}`;
  }

  return (
    <div className="flex items-end gap-2 flex-wrap">
      <label className="block">
        <span className={LABEL_CLASS}>From #</span>
        <input
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          placeholder="1"
          className={`${INPUT_CLASS} mt-1 w-24`}
        />
      </label>
      <label className="block">
        <span className={LABEL_CLASS}>To #</span>
        <input
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder={String(count)}
          className={`${INPUT_CLASS} mt-1 w-24`}
        />
      </label>
      <a href={href("json")} className={BUTTON_CLASS}>
        <Download size={16} />
        JSON
      </a>
      <a href={href("csv")} className={GHOST_BUTTON_CLASS}>
        <Download size={14} />
        QA sheet CSV
      </a>
    </div>
  );
}
