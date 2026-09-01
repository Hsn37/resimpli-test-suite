"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Eye, Loader2, Plus, Save, Trash2, X } from "lucide-react";
import TestDetailsPanel from "@/components/TestDetailsPanel";
import {
  BUTTON_CLASS,
  GHOST_BUTTON_CLASS,
  INPUT_CLASS,
  LABEL_CLASS,
  SECTION_TITLE_CLASS,
  textareaRows,
} from "@/components/admin/formStyles";
import {
  AGENT_CONFIGS,
  AGENT_SCOPES,
  CALL_TYPES,
  PRIORITIES,
  composePreset,
  presetId,
  validateTestPreset,
  type PresetDefaults,
  type TestPresetInput,
} from "@/lib/testPreset";
import OverridesEditor from "./OverridesEditor";

interface Props {
  draft: TestPresetInput;
  defaults: PresetDefaults;
  groups: string[];
  isNew: boolean;
  saving: boolean;
  onChange: (patch: Partial<TestPresetInput>) => void;
  onSave: () => void;
  onCancel: () => void;
}

/** Select bound to a fixed option list — the four enum fields all share it. */
function EnumSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className={LABEL_CLASS}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${INPUT_CLASS} w-full mt-1`}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2"
    >
      <span
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          checked ? "bg-blue-600" : "bg-zinc-300 dark:bg-zinc-700"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </span>
      <span className={LABEL_CLASS}>{label}</span>
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
  rows = 1,
  placeholder,
  mono = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <label className="block">
      <span className={LABEL_CLASS}>{label}</span>
      {rows > 1 ? (
        <textarea
          value={value}
          rows={rows}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`${INPUT_CLASS} w-full mt-1 ${mono ? "font-mono" : ""}`}
        />
      ) : (
        <input
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`${INPUT_CLASS} w-full mt-1 ${mono ? "font-mono" : ""}`}
        />
      )}
    </label>
  );
}

/**
 * Full editor for one case. Sections mirror what a tester sees in
 * TestDetailsPanel, and the live preview renders that exact component off the
 * draft so the author checks their own work before saving.
 */
export default function PresetEditor({
  draft,
  defaults,
  groups,
  isNew,
  saving,
  onChange,
  onSave,
  onCancel,
}: Props) {
  const [showPreview, setShowPreview] = useState(false);

  const errors = useMemo(
    () => validateTestPreset(draft, defaults),
    [draft, defaults]
  );

  const preview = useMemo(
    () =>
      composePreset(
        {
          ...draft,
          id: presetId(draft.test_no),
          active: true,
          updated_by: "",
          updated_at: 0,
        },
        defaults
      ),
    [draft, defaults]
  );

  function patchMessage(index: number, value: string) {
    const next = [...draft.user_messages];
    next[index] = value;
    onChange({ user_messages: next });
  }

  function moveMessage(index: number, delta: number) {
    const next = [...draft.user_messages];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange({ user_messages: next });
  }

  function removeMessage(index: number) {
    onChange({ user_messages: draft.user_messages.filter((_, i) => i !== index) });
  }

  return (
    <div className="space-y-8">
      {/* Sticky action bar */}
      <div className="sticky top-0 z-10 -mx-1 px-1 py-3 bg-white/90 dark:bg-zinc-950/90 backdrop-blur flex items-center justify-between gap-3 border-b border-zinc-200 dark:border-zinc-800">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold truncate">
            {isNew ? `New case · ${presetId(draft.test_no)}` : presetId(draft.test_no)}
          </h2>
          <p className="text-xs text-zinc-500 truncate">
            {draft.scenario || "Untitled scenario"}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowPreview((v) => !v)}
            className={GHOST_BUTTON_CLASS}
          >
            <Eye size={14} />
            {showPreview ? "Hide" : "Preview"}
          </button>
          <button type="button" onClick={onCancel} className={GHOST_BUTTON_CLASS}>
            <X size={14} />
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving || errors.length > 0}
            title={errors[0]}
            className={BUTTON_CLASS}
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Save
          </button>
        </div>
      </div>

      {errors.length > 0 && (
        <ul className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-700 dark:text-amber-400 space-y-1">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="flex-1 min-w-0 space-y-8">
          {/* Identity */}
          <section className="space-y-3">
            <h3 className={SECTION_TITLE_CLASS}>Identity</h3>
            <Field
              label="Scenario"
              value={draft.scenario}
              placeholder="Short title, shown in the picker"
              onChange={(scenario) => onChange({ scenario })}
            />
            <label className="block">
              <span className={LABEL_CLASS}>Group</span>
              <input
                list="preset-groups"
                value={draft.group_name}
                placeholder="Inbound · Offer"
                onChange={(e) => onChange({ group_name: e.target.value })}
                className={`${INPUT_CLASS} w-full mt-1`}
              />
              <datalist id="preset-groups">
                {groups.map((group) => (
                  <option key={group} value={group} />
                ))}
              </datalist>
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <EnumSelect
                label="Agent"
                value={draft.agent_scope}
                options={AGENT_SCOPES}
                onChange={(agent_scope) => onChange({ agent_scope })}
              />
              <EnumSelect
                label="Call type"
                value={draft.call_type}
                options={CALL_TYPES}
                onChange={(call_type) => onChange({ call_type })}
              />
              <EnumSelect
                label="Priority"
                value={draft.priority}
                options={PRIORITIES}
                onChange={(priority) => onChange({ priority })}
              />
              <EnumSelect
                label="Agent config"
                value={draft.agent_config}
                options={AGENT_CONFIGS}
                onChange={(agent_config) => onChange({ agent_config })}
              />
            </div>
            <div className="flex items-center gap-6 pt-1">
              <Toggle
                label="High risk (smoke set)"
                checked={draft.high_risk}
                onChange={(high_risk) => onChange({ high_risk })}
              />
              <Toggle
                label="Needs a staged lead"
                checked={draft.needs_lead_profile}
                onChange={(needs_lead_profile) => onChange({ needs_lead_profile })}
              />
            </div>
          </section>

          {/* Variables */}
          <section className="space-y-3">
            <h3 className={SECTION_TITLE_CLASS}>Variables</h3>
            <OverridesEditor
              callType={draft.call_type}
              defaults={defaults[draft.call_type] ?? {}}
              overrides={draft.overrides}
              onChange={(overrides) => onChange({ overrides })}
            />
          </section>

          {/* Tester script */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className={SECTION_TITLE_CLASS}>
                Tester script ({draft.user_messages.length})
              </h3>
              <button
                type="button"
                onClick={() => onChange({ user_messages: [...draft.user_messages, ""] })}
                className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
              >
                <Plus size={14} />
                Add turn
              </button>
            </div>
            <div className="space-y-2">
              {draft.user_messages.map((message, index) => (
                <div key={index} className="flex items-start gap-2">
                  <span className="text-xs font-mono text-zinc-400 pt-3 w-6 shrink-0">
                    {index + 1}
                  </span>
                  <textarea
                    value={message}
                    rows={textareaRows(message, 4)}
                    onChange={(e) => patchMessage(index, e.target.value)}
                    className={`${INPUT_CLASS} w-full resize-none`}
                  />
                  <div className="flex items-center gap-0.5 pt-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => moveMessage(index, -1)}
                      disabled={index === 0}
                      className="p-1 text-zinc-300 hover:text-blue-500 disabled:opacity-30 transition-colors"
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveMessage(index, 1)}
                      disabled={index === draft.user_messages.length - 1}
                      className="p-1 text-zinc-300 hover:text-blue-500 disabled:opacity-30 transition-colors"
                    >
                      <ArrowDown size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeMessage(index)}
                      className="p-1 text-zinc-300 hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
              {draft.user_messages.length === 0 && (
                <p className="text-sm text-zinc-400 py-3">
                  No turns yet — add what the tester should say, in order.
                </p>
              )}
            </div>
          </section>

          {/* Expectations */}
          <section className="space-y-3">
            <h3 className={SECTION_TITLE_CLASS}>Expectations</h3>
            <Field
              label="Expected path"
              value={draft.expected_path}
              placeholder="OPENER -> DISCOVERY -> ROUTING"
              mono
              onChange={(expected_path) => onChange({ expected_path })}
            />
            <Field
              label="Expected behavior (include explicit fail conditions)"
              value={draft.expected_behavior}
              rows={4}
              onChange={(expected_behavior) => onChange({ expected_behavior })}
            />
            <Field
              label="Sample line the agent should say"
              value={draft.sample}
              rows={2}
              onChange={(sample) => onChange({ sample })}
            />
            <Field
              label="Setup (manual staging, if any)"
              value={draft.setup}
              rows={2}
              onChange={(setup) => onChange({ setup })}
            />
            <Field
              label="Tester notes — say which single turn decides pass/fail"
              value={draft.tester_notes}
              rows={3}
              onChange={(tester_notes) => onChange({ tester_notes })}
            />
          </section>

          {/* QA sheet */}
          <section className="space-y-3">
            <h3 className={SECTION_TITLE_CLASS}>QA sheet columns</h3>
            <p className="text-xs text-zinc-500">
              Used by the QA-sheet CSV export only — the turn-by-turn script stays above.
            </p>
            <Field
              label="What to Say"
              value={draft.sheet_what_to_say}
              rows={3}
              onChange={(sheet_what_to_say) => onChange({ sheet_what_to_say })}
            />
            <Field
              label="What to Watch For"
              value={draft.sheet_what_to_watch_for}
              rows={3}
              onChange={(sheet_what_to_watch_for) => onChange({ sheet_what_to_watch_for })}
            />
          </section>
        </div>

        {showPreview && (
          <div className="lg:w-96 lg:shrink-0">
            <div className="lg:sticky lg:top-24">
              <p className={`${LABEL_CLASS} mb-2 block`}>Tester&apos;s view</p>
              <TestDetailsPanel testCase={preview} accentClass="text-blue-600" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
