---
name: test-suite-cases
description: Use when adding, editing or auditing live-call test cases (presets) in the ReSimpli test suite, or when a Retell agent version changes and its dynamic variables need to reach the cases. Covers the DB-backed case library, the admin panel, the JSON interchange format, the three variable tiers and the QA-sheet export.
---

# ReSimpli test-suite cases

Test cases stage a set of Retell dynamic variables plus a tester script, so a
human can place a live call reproducing one specific scenario. They are called
**presets** in some older code.

## Where they live

**The database is the source of truth.** Cases are edited in the app, not in
this repo:

```
Admin > Test Cases        /admin/presets
  ├─ Test Cases tab       add / edit / duplicate / retire a case
  └─ Defaults tab         the per-call-type variable base
Import & Export           /admin/presets/import
```

```
preset_defaults   call_type -> key -> value      the base every case inherits
test_presets      one row per case, OVERRIDES only
        │
        │  composePreset()  =  defaults[callType] + overrides
        ▼
GET /api/test-presets  ->  CallSetup.tsx  ->  the tester's picker
```

Cases store **overrides, not composed variables**. Adding a variable in the
Defaults tab therefore reaches every case of that call type immediately, with no
backfill. An override VALUE of `null` deletes the key from the payload, staging
an **absent** variable rather than a blank one — T-130 / T-135 / T-140 depend on
this.

`src/lib/tests.ts` is a **frozen fallback**, not the source of truth. It is the
snapshot from when the cases moved into the DB and is only used when the
test-case service is unreachable (the picker shows an "offline copy" badge).
Adding cases there does nothing. The old `testing/make_presets.py` pipeline is
retired; `testing/dev_test_cases.json` remains only as a historical archive.

## Adding cases as an agent

You do not write to the API — there is no service token by design. You produce
JSON, the human pastes it into **Import & Export**.

1. Ask the human to click **Copy agent instructions** on `/admin/presets/import`
   and paste the result to you. It is generated from the live defaults, so it
   carries the real variable names, the current group list and the next free
   test number. Work from that, not from memory.
2. Emit `{"tests": [ ... ]}` in the interchange format (same shape the export
   downloads). Omit `test_no` to let the importer allocate.
3. The human pastes it back, hits **Validate**, and commits. Invalid rows are
   reported per row and skipped — they are never partially written.

If you cannot get the instructions, the contract is: `test_no?`, `agent`
(Inbound | Outbound | STL | Any), `scenario`, `priority` (P0 | P1 | P2 | Obs),
`high_risk`, `needs_lead_profile`, `agent_config` (Default | Variant), `setup`,
`group`, `callType` (inbound | outbound_followup | speed_to_lead),
`sheet_what_to_say`, `sheet_what_to_watch_for`, `overrides`, `userMessages`,
`expectedBehavior`, `expectedPath`, `sample`, `testerNotes`.

**Scope deliberately.** `agent: "Any"` shows a case on every agent. Only the
Inbound agent is on v2.3; scoping a v2.3-only fix as `Any` surfaces it on the v2
Outbound/Speed-to-Lead agents and produces false failures. Use `Inbound` unless
the behaviour is genuinely shared.

**Write the discriminator into `testerNotes`.** Name the single turn that
decides pass/fail. Most cases fail on one turn and pass everywhere else, and a
tester reading a wall of expected behaviour will miss it.

## The three variable tiers

Only the first tier belongs in a case or in the defaults.

| Tier | Examples | Staged? | Why |
|---|---|---|---|
| Staged CRM / config | `stage_of_lead`, `property_type`, `business_state`, `next_step_type` | **yes** | this is what a case *is* |
| `section_*` | `section_opener`, `section_discovery`, `section_routing`, `section_scheduling` | **no** | built at call time by the agent's `setup_*` code tools |
| `edv_*` | `edv_property_type`, `edv_country`, `edv_seller_name` | **no** | written mid-call by the `sync_known_info` extract-dynamic-variable tool |

Staging a `section_*` or `edv_*` key would overwrite what the agent generates
for itself. The API rejects both prefixes on write, in the Defaults tab and in
imports — you cannot land one by accident any more.

`call_type` is also locked: Call Setup pins it from the call direction.

## When a new agent version lands

Diff the agent's variable surface against the Defaults tab. Variables come from
two places: `{{...}}` in `general_prompt`, and the `code` tools — where a tool
reads them **either** as `dv.<name>` **or** through the string-keyed helpers the
tools define at the top (`const s=k=>String(dv[k]||"").trim(), sl=k=>s(k).toLowerCase()`,
called as `s("name")` / `sl("name")`). Match both forms or the diff lies: a
`dv\.`-only regex reports a clean surface while missing every helper-read
variable. `offer_already_delivered` hid that way until 2026-08-27.

Export the current defaults from `/api/admin/presets/export?format=json` (or ask
for a download), then:

```python
import json, re
d = json.load(open("<agent>.json"))
llm = d["retellLlmData"]
prompt_vars = set(re.findall(r"\{\{\s*([A-Za-z0-9_]+)\s*\}\}", llm["general_prompt"]))
tool_vars = set()
for t in llm["general_tools"]:
    if t.get("type") == "code":
        tool_vars |= set(re.findall(r"\bdv\.([A-Za-z0-9_]+)", t["code"]))
        tool_vars |= set(re.findall(r"\b(?:s|sl)\(\"([A-Za-z0-9_]+)\"\)", t["code"]))
needed = {v for v in prompt_vars | tool_vars
          if not v.startswith(("section_", "edv_"))}
# `base` = the inbound block of the Defaults tab.
print("missing:", sorted(needed - set(base)))
print("unused :", sorted(set(base) - needed))
```

Any variable referenced in `general_prompt` but absent from a case renders as a
literal `{{name}}` in the agent's context — so the prompt-referenced set is
mandatory, not optional. Variables only read via `dv.` inside a tool are safe to
omit (they read as `undefined` -> `""`), but add them anyway if a case needs to
control that branch.

Against the live agent this prints `missing: ['utilities_value']` and
`unused: []`. That one is expected and deliberate: `setup_call` reads it only as
a legacy fallback, `dv.utilities_access_value || dv.utilities_value`, and the
prompt uses the former. Do not add it. Anything ELSE in `missing` is a real gap —
that is how `callback_rep_name` was caught on 2026-08-11.

Missing variables are added in the **Defaults tab**, per call type, before any
case can override them.

Also dump the `setup_*` tool code and read it. The generated section bodies are
where most behaviour actually lives, and the prompt alone will mislead you:

```python
for t in llm["general_tools"]:
    if t.get("type") == "code":
        open(f"/tmp/{t['name']}.js", "w").write(t["code"])
```

## Deleting a default

The Defaults tab reports how many active cases override a variable and requires
an explicit confirmation before removing it — those overrides would be orphaned.

It cannot warn you about the other risk: a variable referenced in
`general_prompt` renders as a literal `{{name}}` once it is gone. Run the diff
above before removing anything the agent might read.

## QA sheet

`/admin/presets/import` exports the tester's column layout as CSV, optionally
for a test-number range, with `tested by / Pass-Fail / Call Rating / Notes /
Link` left blank. The `What to Say` / `What to Watch For` columns come from
`sheet_what_to_say` and `sheet_what_to_watch_for`, so populate those on any case
that originates from a QA sheet. The full turn-by-turn script stays in
`userMessages`.

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
  referenced in `general_prompt`, so it is mandatory in every inbound case — it
  is in the inbound defaults (blank by default). A value of ≤1 character, or any
  of `test|demo|n/a|null|unknown`, is discarded in favour of the literal
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
- Test numbers are immutable. Renumbering a case is a retire + create, so old QA
  sheets and call notes keep resolving to one case.
- Retired cases are soft-deleted, never removed, and their numbers are never
  reused.

## Files

| Path | Role |
|---|---|
| `src/lib/testPreset.ts` | types, enums, validator, `composePreset` |
| `src/lib/presetImport.ts` | JSON interchange, QA-sheet CSV, agent instructions |
| `src/lib/db.ts` | `test_presets` / `preset_defaults` / `test_preset_revisions` |
| `src/app/api/test-presets/` | read path for Call Setup |
| `src/app/api/admin/presets/` | admin CRUD, import, export |
| `src/app/(app)/admin/presets/` | the two-tab editor + import page |
| `src/components/admin/presets/` | list, editor, overrides editor, defaults, import |
| `src/lib/tests.ts` | frozen offline fallback — not the source of truth |
| `scripts/migrate-presets.ts` | the one-time JSON -> DB migration (done) |
| `agents/CLAUDE.md` (parent repo) | agent ids, LLM ids, Retell API workflow |
