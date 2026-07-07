"use client";

import { useCallback, useId, useState } from "react";
import { Upload } from "lucide-react";
import { useToast } from "./Toast";
import type { TestCase } from "@/lib/testCase";

interface Props {
  onImport: (cases: Omit<TestCase, "id">[]) => void;
}

/**
 * Like JsonDropzone, but accepts an array of test-case objects (the same
 * shape produced by the retell_automation Python pipeline's
 * test_cases/*.json files) instead of a flat key/value map.
 */
export default function TestCaseJsonImport({ onImport }: Props) {
  const [dragging, setDragging] = useState(false);
  const { toast } = useToast();
  const inputId = useId();

  const handleFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const parsed = JSON.parse(e.target?.result as string);
          if (!Array.isArray(parsed)) {
            toast("JSON must be an array of test case objects", "error");
            return;
          }
          const cases: Omit<TestCase, "id">[] = parsed.map((raw, i) => {
            const r = raw as Record<string, unknown>;
            return {
              name: typeof r.name === "string" ? r.name : `Case ${i + 1}`,
              user_prompt: typeof r.user_prompt === "string" ? r.user_prompt : "",
              metrics: Array.isArray(r.metrics) ? r.metrics.map(String) : [],
              dynamic_variables:
                r.dynamic_variables && typeof r.dynamic_variables === "object"
                  ? Object.fromEntries(
                      Object.entries(r.dynamic_variables as Record<string, unknown>).map(
                        ([k, v]) => [k, String(v)]
                      )
                    )
                  : {},
              tool_mocks: Array.isArray(r.tool_mocks) ? r.tool_mocks : [],
              llm_model: typeof r.llm_model === "string" ? r.llm_model : "gpt-5.4",
            };
          });
          onImport(cases);
          toast(`Imported ${cases.length} test case${cases.length === 1 ? "" : "s"}`, "success");
        } catch {
          toast("Invalid JSON file", "error");
        }
      };
      reader.readAsText(file);
    },
    [onImport, toast]
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
      }}
      className={`border border-dashed rounded-lg px-3 py-2 transition-colors cursor-pointer shrink-0 ${
        dragging
          ? "border-blue-500 bg-blue-500/10"
          : "border-zinc-300 dark:border-zinc-700 hover:border-zinc-400"
      }`}
    >
      <input
        type="file"
        accept=".json"
        className="hidden"
        id={inputId}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />
      <label htmlFor={inputId} className="cursor-pointer flex items-center gap-1.5">
        <Upload size={14} className="text-zinc-400" />
        <span className="text-xs text-zinc-500">Import JSON</span>
      </label>
    </div>
  );
}
