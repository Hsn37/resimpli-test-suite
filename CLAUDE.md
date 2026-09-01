# ReSimpli Test Suite

Next.js app for running and grading Retell agent test calls. Separate git repo;
the parent repo tracks it as a gitlink, so commit here first, then the parent.

## Live-call test cases live in the database

They are edited in the app at **Admin > Test Cases** (`/admin/presets`), not in
this repo. Changes take effect on the next page load — no regeneration, no
deploy.

```
preset_defaults   per-call-type variable base    (Defaults tab)
test_presets      one row per case, OVERRIDES only
        │  composePreset() = defaults[callType] + overrides
        ▼
GET /api/test-presets  ->  CallSetup.tsx
```

Cases store **overrides, not composed variables**, so adding a variable in the
Defaults tab reaches every case of that call type with no backfill. An override
value of `null` stages the variable as **absent** (deleted from the payload)
rather than blank.

`src/lib/tests.ts` is a **frozen fallback**, not the source of truth — the
snapshot from when the cases moved into the DB, used only when the test-case
service is unreachable. Adding cases there does nothing. The old
`testing/make_presets.py` pipeline is retired and `testing/dev_test_cases.json`
is a historical archive.

Bulk changes go through **Import & Export** (`/admin/presets/import`): *Copy
agent instructions* produces a spec built from the live defaults, an AI agent
turns your notes into JSON, you paste it back and validate. The same page
exports the library as JSON (an archive you can commit) or as the QA-sheet CSV.

Full playbook — variable tiers, agent-version diffing, the Inbound v2.3
specifics: the `test-suite-cases` skill in `.claude/skills/`.

## Other conventions

Batch/simulation test cases (`test_case_sets`, `/batch-tests`) are a separate
system from the live-call cases above — don't conflate them.
