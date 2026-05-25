"use client";

import { useState, useCallback, useId } from "react";
import { Upload } from "lucide-react";
import { useToast } from "./Toast";

interface Props {
  onDrop: (vars: Record<string, string>) => void;
}

export default function JsonDropzone({ onDrop }: Props) {
  const [dragging, setDragging] = useState(false);
  const { toast } = useToast();
  const inputId = useId();

  const handleFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const parsed = JSON.parse(e.target?.result as string);
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            toast("JSON must be a flat object of key-value strings", "error");
            return;
          }
          const vars: Record<string, string> = {};
          for (const [k, v] of Object.entries(parsed)) {
            vars[k] = String(v);
          }
          onDrop(vars);
          toast("Variables loaded from JSON", "success");
        } catch {
          toast("Invalid JSON file", "error");
        }
      };
      reader.readAsText(file);
    },
    [onDrop, toast]
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
        <span className="text-xs text-zinc-500">JSON</span>
      </label>
    </div>
  );
}
