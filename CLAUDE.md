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

## Cost dashboard (`/costs`)

Retell spend per workspace and per agent, open to every signed-in user (not
admin-only — it shows spend, never call content). Retell has no account-level
billing API: cost comes from each call's `call_cost` (cents), fetched with
`POST /v3/list-calls`. Twilio telephony is billed outside Retell and is not
included.

```
Retell v3/list-calls ─► call_costs        one row per call, every workspace,
                                          kept RAW_RETENTION_DAYS (12 months)
                     ─► call_cost_daily   workspace × day × agent roll-up,
                                          kept forever; the page reads only this
```

Days are US Central calendar days (`COST_TIMEZONE` in `src/lib/costs.ts`),
assigned per call at sync time, so DST is handled once and every viewer sees
the same "Sep 30". The cron tick (`/api/cron/tick`, `CRON_SECRET` required)
syncs all four workspaces at most every 15 min (`SYNC_INTERVAL_MS`), one run
per workspace at a time (an `app_config` lock): forward from a high-water mark
that never passes an in-progress call, a resumable backfill to
`COST_HISTORY_START`, roll-up rebuilds for days queued before their rows are
written (today at most every 5 min), then a daily prune.
First load or a deeper history is faster locally:
`npx tsx --conditions=react-server scripts/backfill-costs.ts [--since YYYY-MM-DD]`.
Bump `ROLLUP_VERSION` in `costSync.ts` to rebuild roll-ups after changing
their shape.

## Other conventions

Batch/simulation test cases (`test_case_sets`, `/batch-tests`) are a separate
system from the live-call cases above — don't conflate them.
