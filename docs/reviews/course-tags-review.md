# Code Review: Course-level tags

**Range:** `origin/main..HEAD`
**Verdict:** Pass

## Commits reviewed

- `cf6cbc8a` — Add course-level tags to every course config (the `tags` data + the
  `src/config/course-tags.test.js` guard + the recorder-page allowlist entries).
- `1dbcb4aa` — the first review report (see "First pass" below).
- `263cce2a` — docs-only reflection (AGENTS.md + docs/learnings.md).
- `773b7583` — Carry hand-authored course tags over a config regeneration
  (`withCarriedTags` + the generator write path + tests).

## First pass: Fail (score 6) — resolved by `773b7583`

The tags were hand-added to a config the config bot **overwrites**. The generator
emits only `courseId` / `courseName` / `courseHeroImage` / `courseMission`, so the
hand-authored `tags` array on the one generator-owned config
(`src/config/wouldyourather.json`) would have been silently dropped by the next
`configs.yml` run — taking the new guard's data with it.

Fix: `withCarriedTags` (`scripts/lib/sheet-config-utils.js`) reads the file being
overwritten and carries its `tags` into the new config (course level, right after
`courseName`); `scripts/generate-config-from-sheet.mjs` applies it in the write
path via `readExistingConfig`. The sheet stays authoritative — a `tags` array
already present in the generated config wins — and a missing or unparsable
previous file simply yields no tags. Covered by unit tests for the helper and a
CLI test that regenerates a config and asserts the tags survive.

## Final pass

### Correctness Issues

None.

### Simplicity Issues

None.

### Security Issues

None.

### Concurrency Issues

None.

### Other Notes

- `263cce2a` is docs-only; no runtime code changed there.
- The master CSV defines exactly one course (`wouldyourather`), so
  `src/config/wouldyourather.json` is the only generator-owned config; the other
  nine configs are hand-maintained and are never rewritten by the bot.
- Verified end-to-end: regenerating `wouldyourather.json` from
  `public/wouldyourather.master.csv` into a temp dir keeps
  `tags: ["preferences", "money", "getting to know you"]` with the key order
  `courseId, courseName, tags, courseHeroImage, courseMission, lessons`.

### Suggestions

None.

### Verdict

**Pass**

**Reasoning:** The regeneration-drop concern from the first pass is addressed by
`withCarriedTags` (sheet authoritative, carry-over from the overwritten file,
validated by unit and CLI tests), and the rest of the range (tags data, guard,
allowlist, docs reflection) is consistent. Local verification at this HEAD:
`npx vitest run` -> 255 files / 3879 tests pass; `npm run lint` -> 0 errors.
