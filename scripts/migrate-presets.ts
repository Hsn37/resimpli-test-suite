// One-time import of the 141 live-call test presets into Turso, moving the
// source of truth off the JSON + make_presets.py pipeline and into the DB
// (where the admin panel can edit them without a redeploy).
//
// Reads the PARENT repo's files, which is where they still live:
//   ../testing/base_defaults.json   -> preset_defaults   (per call type)
//   ../testing/dev_test_cases.json  -> test_presets      (overrides only)
//
// Reading dev_test_cases.json rather than the generated tests.ts is deliberate:
// tests.ts carries composed variables and drops sheet_what_to_say /
// sheet_what_to_watch_for entirely, so it cannot round-trip a case. The JSON
// also expresses a null override natively (stage the variable as ABSENT),
// which three cases depend on — T-130 / T-135 / T-140.
//
// Idempotent: re-running upserts the same rows by id. Guarded — a dry run
// reports and writes nothing unless --apply is passed:
//   npx tsx --conditions=react-server scripts/migrate-presets.ts
//   npx tsx --conditions=react-server scripts/migrate-presets.ts --apply
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  listPresetDefaults,
  listTestPresetRecords,
  upsertPresetDefault,
  upsertTestPresetRecord,
} from "../src/lib/db";
import {
  presetId,
  validateTestPreset,
  type PresetDefaults,
  type OverrideValue,
  type TestPresetInput,
} from "../src/lib/testPreset";

const TESTING_DIR = resolve(process.cwd(), "..", "testing");
const CASES_PATH = resolve(TESTING_DIR, "dev_test_cases.json");
const BASE_PATH = resolve(TESTING_DIR, "base_defaults.json");

// Documentation key in base_defaults.json, not a call type.
const COMMENT_KEY = "_comment";
const ACTOR = "migration";

interface SourceCase {
  test_no: number;
  agent: string;
  scenario: string;
  priority: string;
  high_risk: boolean;
  needs_lead_profile: boolean;
  agent_config: string;
  setup: string;
  group: string;
  callType: string;
  sheet_what_to_say: string;
  sheet_what_to_watch_for: string;
  overrides: Record<string, OverrideValue>;
  userMessages: string[];
  expectedBehavior: string;
  expectedPath: string;
  sample: string;
  testerNotes: string;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Source-file case -> DB record shape. Field renames only, no composition. */
function toInput(c: SourceCase): TestPresetInput {
  return {
    test_no: c.test_no,
    scenario: c.scenario,
    group_name: c.group,
    agent_scope: c.agent,
    call_type: c.callType,
    priority: c.priority,
    high_risk: c.high_risk,
    needs_lead_profile: c.needs_lead_profile,
    agent_config: c.agent_config,
    setup: c.setup ?? "",
    sheet_what_to_say: c.sheet_what_to_say ?? "",
    sheet_what_to_watch_for: c.sheet_what_to_watch_for ?? "",
    overrides: c.overrides ?? {},
    user_messages: c.userMessages ?? [],
    expected_path: c.expectedPath ?? "",
    expected_behavior: c.expectedBehavior ?? "",
    sample: c.sample ?? "",
    tester_notes: c.testerNotes ?? "",
  };
}

async function main() {
  const apply = process.argv.includes("--apply");

  const baseRaw = readJson<Record<string, Record<string, string>>>(BASE_PATH);
  const defaults: PresetDefaults = Object.fromEntries(
    Object.entries(baseRaw).filter(([key]) => key !== COMMENT_KEY)
  );
  const cases = readJson<{ tests: SourceCase[] }>(CASES_PATH).tests;

  const defaultCount = Object.values(defaults).reduce(
    (n, vars) => n + Object.keys(vars).length,
    0
  );
  console.log(`source: ${CASES_PATH}`);
  console.log(
    `        ${cases.length} cases, ` +
      `${Object.keys(defaults).length} call types, ${defaultCount} default variables`
  );

  // Validate everything before writing anything — a half-migrated table is
  // worse than a failed run.
  const problems: string[] = [];
  const seen = new Set<number>();
  for (const c of cases) {
    if (seen.has(c.test_no)) problems.push(`${presetId(c.test_no)}: duplicate test_no`);
    seen.add(c.test_no);
    for (const error of validateTestPreset(toInput(c), defaults)) {
      problems.push(`${presetId(c.test_no)}: ${error}`);
    }
  }
  if (problems.length > 0) {
    console.error(`\n${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }
  const nullOverrides = cases.filter((c) =>
    Object.values(c.overrides ?? {}).some((v) => v === null)
  );
  console.log(
    `validated: all ${cases.length} cases OK ` +
      `(${nullOverrides.length} stage an absent variable: ` +
      `${nullOverrides.map((c) => presetId(c.test_no)).join(", ")})`
  );

  if (!apply) {
    console.log("\ndry run — nothing written. Re-run with --apply to migrate.");
    return;
  }

  for (const [callType, vars] of Object.entries(defaults)) {
    for (const [key, value] of Object.entries(vars)) {
      await upsertPresetDefault(callType, key, value);
    }
  }
  for (const c of cases) {
    await upsertTestPresetRecord({ ...toInput(c), active: true }, ACTOR, "import");
  }

  // Verify what landed matches what we read.
  const writtenDefaults = await listPresetDefaults();
  const writtenCases = await listTestPresetRecords(true);
  const writtenDefaultCount = Object.values(writtenDefaults).reduce(
    (n, vars) => n + Object.keys(vars).length,
    0
  );
  console.log(
    `\nwrote: ${writtenCases.length}/${cases.length} cases, ` +
      `${writtenDefaultCount}/${defaultCount} default variables`
  );
  if (writtenCases.length !== cases.length || writtenDefaultCount !== defaultCount) {
    console.error("MISMATCH — counts differ, inspect before relying on this data.");
    process.exit(1);
  }
  console.log("migration complete.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
