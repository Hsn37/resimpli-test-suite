# ReSimpli Test Suite

Next.js app for running and grading Retell agent test calls. Separate git repo;
the parent repo tracks it as a gitlink, so commit here first, then the parent.

## src/lib/tests.ts is generated — never edit it

`TEST_PRESETS` is built from the **parent** repo, not from this one:

```
../testing/dev_test_cases.json  +  ../testing/base_defaults.json
        ↓  conda run -n env python testing/make_presets.py   (run from the parent)
src/lib/tests.ts
```

Editing `tests.ts` directly is silently reverted by the next regeneration — that
has already cost 14 test cases once. To add or change a case, edit
`../testing/dev_test_cases.json` and regenerate.

A variable can only be overridden by a case if it already exists in
`base_defaults.json`; the generator errors otherwise.

Full playbook — variable tiers, agent-version diffing, verification, QA-sheet
export: the `test-suite-cases` skill in `.claude/skills/` (its commands run from
the parent repo root).
