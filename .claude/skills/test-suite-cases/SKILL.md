---
name: test-suite-cases
description: Use when adding, editing, or auditing test cases (presets) in the ReSimpli test suite, or when a Retell agent version changes and its dynamic variables need to reach the presets. Covers the dev_test_cases.json -> make_presets.py -> tests.ts pipeline, the three variable tiers, and the QA-sheet CSV export.
---

# ReSimpli test-suite cases

Test cases are called **presets** in the UI. They stage a set of Retell dynamic
variables plus a tester script, so a human can place a live call that reproduces
one specific scenario.

## The pipeline

This skill lives in `resimpli_test_suite/.claude/skills/`, but the pipeline it
describes straddles both repos and **every command below is run from the parent
repo root** (`~/Desktop/resimpli`), which is where the paths resolve.

```
testing/base_defaults.json     per-callType variable defaults
testing/dev_test_cases.json    one entry per case (SOURCE OF TRUTH)
        ↓  testing/make_presets.py
resimpli_test_suite/src/lib/tests.ts   GENERATED — never hand-edit
        ↓  imported by
resimpli_test_suite/src/components/CallSetup.tsx
```

Regenerate with:

```bash
cd ~/Desktop/resimpli && conda run -n env python testing/make_presets.py
```

`preset = base_defaults[callType] + test.overrides`. The generator hard-fails on
an override key that is not already in the base, on an unknown `group`, and on a
bad `priority` — so **add a variable to `base_defaults.json` before any case can
override it.**

Note the two repos: `testing/` is in the parent repo, `resimpli_test_suite/` is
a separate repo tracked as a gitlink. A change to the cases touches both, and
the inner repo must be committed first so the parent can record its new SHA.

### Source of truth

`tests.ts` carries a "do not edit by hand" header for a reason. In Aug 2026 a
commit added 14 presets (T-72..T-85) straight into `tests.ts` without touching
`dev_test_cases.json`; the two files silently disagreed (85 vs 71) until the
next regeneration deleted all 14. If you ever find the counts disagreeing,
back-port before regenerating — reconstruct each case's `overrides` as the
variables that differ from `base_defaults[callType]`, which round-trips exactly.

Check for drift before doing anything:

```bash
python3 -c "import json;print(len(json.load(open('testing/dev_test_cases.json'))['tests']))"
grep -c '^  {"id"' resimpli_test_suite/src/lib/tests.ts
```

## The three variable tiers

Only the first tier belongs in a preset.

| Tier | Examples | In presets? | Why |
|---|---|---|---|
| Staged CRM / config | `stage_of_lead`, `property_type`, `business_state`, `next_step_type` | **yes** | this is what a preset *is* |
| `section_*` | `section_opener`, `section_discovery`, `section_routing`, `section_scheduling` | **no** | built at call time by the agent's `setup_*` code tools |
| `edv_*` | `edv_property_type`, `edv_country`, `edv_seller_name` | **no** | written mid-call by the `sync_known_info` extract-dynamic-variable tool |

Including a `section_*` or `edv_*` key would overwrite what the agent generates
for itself. The `_comment` at the top of `base_defaults.json` records this.

## When a new agent version lands

Diff the agent's variable surface against the base defaults. Variables come from
two places: `{{...}}` in `general_prompt`, and `dv.<name>` inside the `code` tools.

```python
import json, re
d = json.load(open("<agent>.json"))
llm = d["retellLlmData"]
prompt_vars = set(re.findall(r"\{\{\s*([A-Za-z0-9_]+)\s*\}\}", llm["general_prompt"]))
tool_vars = set()
for t in llm["general_tools"]:
    if t.get("type") == "code":
        tool_vars |= set(re.findall(r"\bdv\.([A-Za-z0-9_]+)", t["code"]))
needed = {v for v in prompt_vars | tool_vars
          if not v.startswith(("section_", "edv_"))}
base = json.load(open("testing/base_defaults.json"))["inbound"]
print("missing:", sorted(needed - set(base)))
print("unused :", sorted(set(base) - needed))
```

Any variable referenced in `general_prompt` but absent from the preset renders as
a literal `{{name}}` in the agent's context — so the prompt-referenced set is
mandatory, not optional. Variables only read via `dv.` inside a tool are safe to
omit (they read as `undefined` -> `""`), but include them anyway if a case needs
to control that branch.

Against the live agent this prints `missing: ['utilities_value']` and
`unused: []`. That one is expected and deliberate: `setup_call` reads it only as
a legacy fallback, `dv.utilities_access_value || dv.utilities_value`, and the
prompt uses the former. Do not add it. Anything ELSE in `missing` is a real gap —
that is how `callback_rep_name` was caught on 2026-08-11.

Also dump the `setup_*` tool code and read it. The generated section bodies are
where most behaviour actually lives, and the prompt alone will mislead you:

```python
for t in llm["general_tools"]:
    if t.get("type") == "code":
        open(f"/tmp/{t['name']}.js", "w").write(t["code"])
```

## Adding a case

1. Pick the next free `test_no`. Ids are `T-{n:02d}`, and `n` is also the QA
   sheet's row number — keep them aligned.
2. Add any new variables to **all** call-type blocks of `base_defaults.json`
   that need them.
3. Append the entry to `dev_test_cases.json`. Add the `group` to `group_order`
   first if it is new.
4. Regenerate, then verify nothing else moved (see below).

Entry shape — every field is required:

```jsonc
{
  "test_no": 86,
  "agent": "Inbound",              // Inbound | Outbound | STL | Any -> agentScope
  "scenario": "short title",       // becomes "#86 · short title"
  "priority": "P0",                // P0 | P1 | P2 | Obs
  "high_risk": true,               // the smoke set run on every dev push
  "needs_lead_profile": false,     // true = a real staged lead in REsimpli
  "agent_config": "Default",       // Variant = non-default dashboard config
  "setup": "manual staging, if any",
  "group": "v2.3 Ticket Regressions",
  "callType": "inbound",           // inbound | outbound_followup | speed_to_lead
  "sheet_what_to_say": "",         // QA-sheet columns; documentation only,
  "sheet_what_to_watch_for": "",   // make_presets does not read these two
  "overrides": {},                 // keys MUST exist in base_defaults[callType]
  "userMessages": ["...", "..."],  // what the tester says, in order
  "expectedBehavior": "incl. explicit fail conditions",
  "expectedPath": "OPENER -> DISCOVERY (...) -> ROUTING",
  "sample": "one line the agent should say",
  "testerNotes": "staging notes, the discriminator turn, cross-refs"
}
```

**Scope deliberately.** `agentScope: "Any"` shows a case on every agent. Only
the Inbound agent is on v2.3; scoping a v2.3-only fix as `Any` surfaces it on
the v2 Outbound/Speed-to-Lead agents and produces false failures. Scope to
`Inbound` unless the behaviour is genuinely shared.

**Write the discriminator into `testerNotes`.** Say which single turn decides
pass/fail. Most of these cases fail on one specific turn and pass everywhere
else, and a tester reading a wall of expected behaviour will miss it.

## Verifying a regeneration

Confirm existing cases are untouched and only the intended ones changed:

```bash
cd resimpli_test_suite && node -e '
const fs=require("fs"),cp=require("child_process");
const P=s=>s.split("\n").filter(l=>l.trim().startsWith("{\"id\"")) 
            .map(l=>JSON.parse(l.trim().replace(/,$/,"")));
const o=P(cp.execSync("git show HEAD:src/lib/tests.ts").toString());
const n=Object.fromEntries(P(fs.readFileSync("src/lib/tests.ts","utf8")).map(p=>[p.id,p]));
let bad=0;
for(const p of o){const q=n[p.id];
  for(const k of Object.keys(p)) if(k!=="variables"&&JSON.stringify(p[k])!==JSON.stringify(q[k])){console.log("CHANGED",p.id,k);bad++}
  for(const[k,v]of Object.entries(p.variables)) if(q.variables[k]!==v){console.log("VAR",p.id,k);bad++}}
console.log(bad?"PROBLEMS "+bad:"OK");'
npx tsc --noEmit
```

## QA-sheet CSV export

`testing/make_qa_sheet.py` exports a test-number range in the tester's column
layout, with `tested by / Pass-Fail / Call Rating / Notes / Link` left blank:

```bash
conda run -n env python testing/make_qa_sheet.py 86 106 "out.csv"
```

The `What to Say` / `What to Watch For` columns come from `sheet_what_to_say`
and `sheet_what_to_watch_for`, so populate those when a case originates from a
QA sheet. The full turn-by-turn script stays in `userMessages`.

## Inbound v2.3 specifics

**Versioning note.** The agent, the prompt and the QA sheet are all on one
version number now: **v2.3**. Earlier notes called this same agent "v3.1"; that
label is retired — if you find it anywhere, it means v2.3. The one exception is
`Inbound (Prod v3.1 with EDV)` below, which is the literal name of a *different*
dashboard agent and is not this one.

Verified 2026-08-11 against the **live** agent `Inbound v2.3 - LATEST`:

| Field | Value |
|---|---|
| Agent ID | `agent_fc8f01185272badf345f7f8f3d` |
| LLM ID | `llm_ae1a65b6cc360869023cb07baa17` |
| Agent / LLM version | 8 / 8, GPT-5.4, 11labs-Hailey |

There is no local JSON export of this agent, and `agents/CLAUDE.md` does not
track it — pull it before diffing (read-only, key from the parent `.env`):

```bash
curl -s -H "Authorization: Bearer $RETELL_API_KEY" \
  https://api.retellai.com/get-retell-llm/llm_ae1a65b6cc360869023cb07baa17 -o /tmp/inbound.json
```

Do not diff against `agent_latest.json` (no `retellLlmData`) or against
`Inbound (Prod v2)` / `Inbound (Prod v3.1 with EDV)` — neither carries
`stage_of_lead` or `callback_rep_name`, so both report a clean surface and hide
exactly the variables you are checking for. Re-verify each of the following when
a new version lands.

- **Discovery order is hardcoded, not CSV-driven.** `setup_call` emits
  `Order, mandatory: ...` from a fixed `fields` array:
  occupancy -> condition -> timeline -> reason -> price_expectation ->
  mortgage_liens -> decision_makers -> deal_killers -> alternatives.
  `lead_qualification_res_selected_csv` only *enables/disables* fields; its
  sequence is ignored. This changed from v2, which was CSV-ordered
  (condition-first) — several v2-era cases (T-06 and others) still document the
  old order in their notes.
- **`lead_qualification_property_type_focus` defaults to `residential`** in the
  base. That keeps `mustAskType` false so the "house or vacant land?" question
  never fires. Blank it (plus `property_type`) in a case that needs the type ask
  armed — T-102 does this.
- **`stage_of_lead`** is lowercased, stripped to letters, then tested against
  the **anchored** `/^(the)?undercontract$/` — in `setup_call` (replaces the
  entire discovery section), `setup_routing` (replaces routing) and
  `setup_scheduling` (returns an EMPTY scheduling section). Anchored, not a
  substring: `"Under Contract"` and `"The Under Contract"` hit, while
  `"Not Under Contract"`, `"Under Contract - Cancelled"`, `"No Longer Under
  Contract"` and `"Pre Under Contract"` all fall through to the normal path —
  which is the whole point of T-107. Always run the branch case with a control
  and a guard (T-103 / T-104 / T-105). The rep named in the hand-off comes from
  `phone_rep_name`, then `in_person_rep_name`, then
  `"one of our acquisition specialists"`.
- **`callback_rep_name`** is read by `setup_routing` and interpolated into the
  single callback close (`"<rep> will reach out about next steps"`). It is
  referenced in `general_prompt`, so it is mandatory in every inbound preset —
  it is in `base_defaults.json` (blank by default). A value of ≤1 character, or
  any of `test|demo|n/a|null|unknown`, is discarded in favour of the literal
  fallback `"One of our acquisition specialists"`. T-111 / T-112 are the named
  and blank cases; do not stage a placeholder name in T-111 or the guard eats
  it. `callback_ask_for_time` is a separate switch and is only true on the
  string `"true"`.
- **Canada** is resolved in `setup_opener` from `business_state` being a
  province code, or a letter-digit-letter `business_zip` / `property_zip` — that
  path is known before the call starts. The caller-driven path goes through
  `edv_country` and only flips after `sync_known_info` runs, so the first
  address ask can legitimately still say "ZIP".
- **`section_routing` timing.** Objection handling (incl. the price-fear rule)
  lives in `section_routing`, built by `setup_routing`. Only `setup_call` and
  `setup_opener` are documented as running at call start, so a mid-discovery
  objection may hit before those rules are in context. Check the tool-call
  timeline before blaming prompt wording.
- **Land fields** (`acreage_*`, `parcel_location_value`, `land_type_use_value`,
  `road_access_value`, `utilities_access_value`, `zoning_use_value`) exist but
  have no cases yet.

## Gotchas

- `conda run -n env python - <<'EOF'` does **not** forward the heredoc. Write
  the script to a file and pass the path.
- `json.dump(..., ensure_ascii=False)` always, per the project CLAUDE.md.
- Ids sort as strings unless handled: `T-100` sorts before `T-86`.
  `make_presets.py` sorts on the parsed number — keep it that way.
- `sheet_what_to_say` / `sheet_what_to_watch_for` are not read by
  `make_presets.py`. They exist for the CSV export and for provenance.

## Files

Paths are relative to the parent repo root (`~/Desktop/resimpli`).

| Path | Role |
|---|---|
| `resimpli_test_suite/.claude/skills/test-suite-cases/` | this skill |
| `testing/dev_test_cases.json` | source of truth, one entry per case |
| `testing/base_defaults.json` | per-callType variable defaults |
| `testing/make_presets.py` | generator |
| `testing/make_qa_sheet.py` | QA-sheet CSV export |
| `resimpli_test_suite/src/lib/tests.ts` | generated output, do not edit |
| `resimpli_test_suite/src/lib/presets.ts` | `TestPreset` type, agent-tag scoping |
| `resimpli_test_suite/src/components/CallSetup.tsx` | preset picker UI |
| `agents/CLAUDE.md` | agent ids, LLM ids, Retell API workflow |
