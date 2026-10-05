# Sheet-generated configs overwrite the existing config (the sheet is authoritative)

## Context

Story 042/046 shipped `scripts/generate-config-from-sheet.mjs`: it fetches the published Google Sheet CSV and writes one English-only `src/config/<courseId>.json` per course the sheet defines. Its write block (`scripts/generate-config-from-sheet.mjs:114-119`) refuses to replace an existing file unless `--force` is passed:

```js
const exists = await fs.access(outPath).then(() => true, () => false);
if (exists && !force) {
    skipped++;
    console.error(`SKIP course "${courseId}": ${outPath} already exists; refusing to overwrite (use --force to replace)`);
    continue;
}
```

`.github/workflows/configs.yml` runs the CLI as `node scripts/generate-config-from-sheet.mjs --check` and never passes `--force`, and its source guard (`scripts/configs-workflow.test.js:60-62`) asserts the string `--force` never appears in the workflow. So once a course's config is generated and committed, a later sheet edit to that same course **never propagates** — the run reports a benign `SKIP … already exists`. Story 046 named this the "existing-course update gap" (`stories/046-auto-generate-configs/story.md:307`) and deliberately deferred it to the operator.

The operator has now decided: **the sheet is the single source of truth.** If the sheet defines a course, the generator regenerates `src/config/<courseId>.json` and overwrites whatever is there — no `--force` gate, no allow-list nuance. Rationale stated by the operator: "if the spreadsheet is saying to overwrite the existing configs, then obviously I'm telling it to overwrite." This story makes overwrite the default and removes the `--force` gate (and the flag) entirely. `--dry-run` remains the preview; `--check` keeps its exit-code semantics; best-effort skips (missing columns / structural errors / invalid courseId / no course / no video rows) are unchanged.

**Implication the operator must understand (recorded here, not guarded):** generated configs are English-only, while hand-authored configs carry es/pt/bn (`src/config/wouldrather.json`, `model.json`, etc.). Overwriting a hand-authored, localized course with a generated one **drops those translations**. That is the intended consequence of "sheet is authoritative": do not point the sheet at a hand-authored/localized course that you are not migrating to the sheet. No guard re-introduces the refusal.

## Out of Scope

- **No localization.** Generated configs stay English-only (`en`); the DeepSeek `translateReal` pass is still a later story. Dropping es/pt/bn on overwrite is an accepted consequence, documented above, not mitigated.
- **No allow-list change.** `scripts/lib/generated-configs.json`, its registration semantics, and the contract guard (`src/config/generated-config-contract.test.js`) are untouched. A course already in the allow-list stays there; a first-time write still appends it.
- **No change to the transform.** `scripts/lib/sheet-config-utils.js` (`parseCsv`, `buildCourseConfig`, `buildCourseConfigs`, `isValidCourseId`, `REQUIRED_COLUMNS`) is not edited.
- **No change to the workflow's behavior.** `configs.yml` already never passed `--force`; it keeps not passing it, and its source guard keeps asserting `--force` is absent. Its "Report skips" step description of the refusal skip is corrected, but the step's behavior is unchanged.
- **No change to `--check` / `--dry-run` semantics,** no new flags, and no new npm dependencies.
- **No change to the render path, R2 layout, or pipeline.**

## Implementation approach

### 1. CLI write block (`scripts/generate-config-from-sheet.mjs`)

Replace the exists/refusal block (`:114-119`) with an unconditional write. Keep the `dryRun` early-continue (`:109-112`) exactly as is, and keep the `WROTE <path>` line and the `wrote++` counter and the default-path-only allow-list registration (`:128`).

Delete the `force` binding (`:66`) and every remaining reference to `--force`:
- `:11-12` comment ("Existing configs are never overwritten without `--force`.") → reword to "The sheet is authoritative: the generator overwrites `src/config/<courseId>.json`."
- `:15` usage line → drop `[--force]`.
- `:46` `--force` help line → delete.
- `:66` `const force = args.includes('--force');` → delete.

**Decision — drop `--force` entirely (recommended):** with overwrite always on, `--force` has no state left to change. A retained no-op flag would be a trap: it would silently accept `--force` (suggesting a behavior that no longer exists) while adding a help entry and a guard surface that contradict the workflow guard's "`--force` is absent" assertion. Dropping it is the cleanest and keeps the help honest. Tradeoff: an operator script or muscle-memory invocation with `--force` will now fail arg parsing? It will **not** fail — unknown flags are ignored by the current parser (`args.includes` never rejects unknown tokens), so `--force` degrades to a harmless no-op instead of an error. That is acceptable for an operator-only tool; a hard error would require new validation logic that is not worth it here. The story's source guard pins that the CLI no longer *reads* or *documents* `--force` and no longer contains the refusal string.

### 2. Overwrite is atomic-ish (write-temp-then-rename)

Write to a sibling temp file in the same directory, then `fs.rename` it over the target:

```js
await fs.mkdir(path.dirname(outPath), { recursive: true });
const tmpPath = `${outPath}.tmp-${process.pid}`;
await fs.writeFile(tmpPath, JSON.stringify(result.config, null, 2) + '\n');
await fs.rename(tmpPath, outPath);
```

Rationale: `fs.writeFile` truncates the destination in place, so a killed process or a concurrent reader can observe a partially written file. Configs here are up to ~341 KB (`src/config/gt2.json`), and the file is regenerated on every run, so a rename makes the replacement atomic (same-directory rename is atomic on POSIX). The generated bytes are unchanged: `JSON.stringify(config, null, 2) + '\n'` (2-space indent, one trailing newline), matching every committed `src/config/*.json` (verified: `wouldrather.json` ends in `\n`). The temp file is same-directory so the rename never crosses a filesystem. If `fs.writeFile` throws, the temp file may remain; do not add cleanup logic — a stray `.tmp-<pid>` is harmless and gitignored-by-absence from the commit set (the workflow stages only `src/config` and the allow-list, but note: a stray temp inside `src/config` **would** be staged by `git add src/config`, so the temp name must not collide with a real config and must be removed on failure). Simplest correct approach: wrap the write+rename so the temp is removed on failure:

```js
const tmpPath = `${outPath}.tmp-${process.pid}`;
try {
    await fs.writeFile(tmpPath, JSON.stringify(result.config, null, 2) + '\n');
    await fs.rename(tmpPath, outPath);
} catch (err) {
    await fs.rm(tmpPath, { force: true });
    throw err;
}
```

### 3. Workflow (`configs.yml`)

The command line is unchanged (`--check`, no `--force`). Only the explanatory comment is corrected: the comment at `:50-52` currently says an "already exists; refusing to overwrite" skip is expected on every run after the first and is not an error. That skip no longer exists. Rewrite the comment to say missing-column skips are the only `SKIP` reason annotatable as an error. Do **not** add `--force` to the invocation; the existing guard (`scripts/configs-workflow.test.js`) asserting `--force` is absent stays green and unchanged.

### 4. Tests

`scripts/generate-config-from-sheet.test.js`:
- Replace `refuses to overwrite without --force (all files byte-identical)` (`:92-104`) with **`re-run overwrites existing files (content updated)`**: run once, corrupt both files with `{"stale":true}`, run again with the same `--out` dir and **no flags**, expect exit 0 and both files restored to valid configs with the matching `courseId`.
- Replace `--force replaces existing configs` (`:106-118`) — it is subsumed by the new test above. A single replacement test that corrupts + re-runs without `--force` covers both. Delete the `--force` case rather than keep a duplicate.
- Update the `--help` flag list (`:69`) to `['--sheet-url', '--course', '--out', '--dry-run', '--check']` — drop `--force`.
- Add a CI-path test: run once into a dir, run again with `--check` and no `--force`, expect **exit 0** and files rewritten (this is the exact `configs.yml` invocation over already-present configs).
- Keep unchanged: multi-course write, mixed-skip (`--check` and non-`--check`), structural-error, allow-list registration, `--out` not touching the tracked allow-list, `--course` filter/unknown, traversal guard, `--dry-run`, and the default-URL source guard.

`scripts/configs-workflow.test.js`: unchanged. Its `never passes --force` guard stays. The comment at `:49` ("overwrite-refusals are expected") is stale — update the comment text only (the assertion stays).

### 5. Source guard pinning the new behavior (must be provably failable, `AGENTS.md`)

Add a `describe`/test to `scripts/generate-config-from-sheet.test.js` (a `scripts/` test, so it may read the CLI raw source; it does **not** mention the recorder page, so the `src/**` scanner is irrelevant):

- Read the CLI source raw (do **not** comment-strip).
- Assert the refusal string is absent: `expect(cli).not.toContain('refusing to overwrite')`.
- Assert `--force` does not appear as a documented/read flag: `expect(cli).not.toContain('--force')`.
- Assert overwrite is unconditional: the write block contains `await fs.rename(` and does not contain `fs.access(`.
- Prove failable: render these assertions against a mutated copy (re-insert the refusal line / a `--force` mention / replace `fs.rename` with `fs.access`) and expect each to throw. Follow the mutation-test pattern already used in `scripts/configs-workflow.test.js:64-83` (mutate the real text, assert the custom assertion throws), not a bare in-memory smoke check.

Do not use whole-file `toContain` for a token that appears in more than one place; the refusal string and `--force` are each expected to be absent, so a whole-file `not.toContain` is the correct (and failable) shape — mutating in the forbidden token makes it fail.

### 6. Supersede 046

This story supersedes specific lines of `stories/046-auto-generate-configs/story.md`. Do **not** rewrite 046's file (it is a merged historical record); instead add a short "Superseded by 047" note near the top of 046 and list the exact changed clauses here. The contradictions to resolve, with the new truth:

| 046 location | 046 says | 047 supersedes it to |
|---|---|---|
| Out of Scope `:21` | "Editing or overwriting hand-authored configs. The generator only creates files; `--force` is the sole overwrite path and the Action never passes it." | Overwrite is the default; the Action still never passes `--force` but no longer needs to — the CLI always overwrites. |
| Implementation approach `:81` | "**Never overwrite without `--force`, per file.**" | Always overwrite per file; no `--force`. |
| Task 4 ACs `:220-223` | re-run without `--force` → non-zero + byte-identical; with `--force` → replaced | re-run (no flags) → exit 0, files rewritten with fresh content. |
| Task 4 AC `:245` | `--help` documents `--force` | `--help` documents `--sheet-url`, `--course`, `--out`, `--dry-run`, `--check` (no `--force`). |
| Task 5 AC `:265-266` | Action never passes `--force` | Unchanged and still asserted; now also true that the CLI has no `--force`. |
| Technical Context `:285` | "the remaining assertions (never-overwrite … `--force`) remain valid" | never-overwrite/`--force` assertions are removed; overwrite + `--force`-absent assertions replace them. |
| Notes `:307` | "Existing-course updates are an operator decision (documented gap) … a course config generated once is **not** overwritten" | Closed: the sheet is authoritative; regeneration overwrites. |

Add to 046 (top, after the title): a one-line note, `> Superseded by [047-overwrite-configs](../047-overwrite-configs/story.md): the generator now overwrites existing configs unconditionally; the "never overwrite without --force" rule, the --force flag, and the "existing-course update gap" note no longer apply.` Do not edit any other 046 text.

### 7. Docs

- `README.md:102`: replace "It never overwrites an existing config without `--force`" with the authoritative-overwrite statement, and keep the English-only caveat: e.g. "It **overwrites** an existing `src/config/<courseId>.json` — the sheet is the source of truth — and it does not translate (es/pt/bn is a later pass), so do not point the sheet at a hand-authored/localized course you are not migrating." Also mention `--dry-run` as the preview and that `--force` is gone.
- `docs/product.md:46`: replace "it never overwrites an existing config without `--force`" with "it overwrites the existing `src/config/<courseId>.json` (the sheet is authoritative)".
- `docs/product.md:47-48` (the 046 feature entries): no factual change needed — they do not mention `--force` — but the `:46` edit must not leave the "source of truth" claim contradicted.

## Tasks

### Task 1 - CLI overwrites unconditionally; `--force` removed

- a sheet whose course already has an output file + CLI run with no flags
  - → exits 0
  - → the file is rewritten with the newly generated config (byte-different from the corrupted/stale prior content, parsed `courseId` matches)
  - → stdout contains `WROTE <path>`
- a stale/corrupt existing file (`{"stale":true}`) + CLI run
  - → exit 0; the file is valid JSON with the generated `courseId`; no temp file (`*.tmp-*`) remains beside it
- the CLI source read raw + inspected
  - → does not contain `refusing to overwrite`
  - → does not contain `--force`
- the write path + a write failure simulated by making the output path a directory
  - → the run exits non-zero and the error is surfaced via `ERROR: <message>` (no silent skip)
- `--help` + invoked
  - → exits 0 and lists `--sheet-url`, `--course`, `--out`, `--dry-run`, `--check`
  - → does not list `--force`

### Task 2 - Overwrite output format and atomic rename

- a course written to a temp `--out` dir + file read back
  - → is valid JSON, 2-space indented, and ends in exactly one `\n`
  - → a second run produces byte-identical bytes for an unchanged sheet (idempotent)
- a success write + inspection of the directory during/after
  - → no `*.tmp-*` file remains in the output directory
- a write that throws + caught
  - → the temp file is removed (`fs.rm(tmpPath, { force: true })` path exercised) and the original target is untouched

### Task 3 - CI path: `--check` over already-present configs

- the two-course fixture run once, then re-run with `--check` and no `--force`
  - → exits 0
  - → both files rewritten (content equal to a fresh direct generation)
- a mixed sheet where course A is missing a required column and both A and B already exist + `--check`
  - → exits 0
  - → B is overwritten, A is untouched (still skipped whole, never a partial config)
  - → stderr contains `SKIP course "A": missing required column(s): …` and stdout `SKIPPED 1 course(s), WROTE 1`
- a structural-error course + `--check` over an existing config for the bad course
  - → exits 0; the bad course's existing file is left unchanged; the valid course is overwritten

### Task 4 - Source guard for the new behavior (failable)

- the CLI source + the guard's assertions
  - → passes on the real source
- the CLI source with the refusal string re-inserted into a mutated copy + guard re-run
  - → the guard throws (proves the `not.toContain('refusing to overwrite')` assertion can fail)
- the CLI source with `--force` re-inserted + guard re-run
  - → the guard throws (proves the `not.toContain('--force')` assertion can fail)
- the CLI source with `fs.rename` replaced by `fs.access` + guard re-run
  - → the guard throws (proves the unconditional-overwrite assertion can fail)
- `.github/workflows/configs.yml` + the existing guard
  - → `--force` still does not appear (guard unchanged and green)

### Task 5 - Supersede 046 and update docs

- `stories/046-auto-generate-configs/story.md` + read
  - → contains the "Superseded by 047" note naming the changed clauses
- `README.md` + read
  - → the operator paragraph says the generator **overwrites** the existing config (sheet authoritative) and no longer says "never overwrites without `--force`"
  - → it retains the English-only / translations caveat and names `--dry-run` as the preview
- `docs/product.md` + read
  - → line 46 no longer claims "never overwrites without `--force`"; it states the config is overwritten

## Technical Context

- **No new dependencies.** `scripts/generate-config-from-sheet.mjs` continues to use only Node built-ins (`node:fs` `promises`, `node:path`, `node:url`, global `fetch`). `package.json` is unchanged (`configs:generate` / `configs:generate:ci` scripts exist).
- **Node version in CI:** workflows use `node-version: 20` (`configs.yml:37`); `fs.rename`, `fs.rm`, `fs.writeFile` (promises) are all available on Node 20. Local dev is Node 22.x.
- **Test tooling:** Vitest 4.1.6 (devDependency); `npm test` = `vitest`. CLI tests live in `scripts/generate-config-from-sheet.test.js` and already expose `runCli`, `tmpDir`, `CONFIG_OUT_DIR`, `GENERATED_CONFIGS_ALLOWLIST` seams. The workflow guard is `scripts/configs-workflow.test.js`.
- **Exact bytes written (must not change):** `JSON.stringify(result.config, null, 2) + '\n'` — 2-space indent, single trailing newline. Verified every committed `src/config/*.json` ends in `\n` (e.g. `wouldrather.json`).
- **Why the source guard lives under `scripts/`:** `src/modules/video/recorder-page.test.js` scans every `src/**` file for a `/recorder` / `recorder.html` reference and fails on any hit. The CLI guard reads `scripts/generate-config-from-sheet.mjs`, so it stays in `scripts/` and never mentions the recorder page.
- **Guard hygiene (`AGENTS.md`):** assert on raw source (no comment-stripping — the CLI contains `https://` in `SHEET_URL`); the forbidden-token assertions are whole-file `not.toContain`, which is correct only because the tokens must be entirely absent; prove each guard can fail by mutating the real text (as `scripts/configs-workflow.test.js:64-83` does).
- **Unknown flags are ignored:** the CLI reads flags via `args.includes` / `flagValue` (`scripts/lib/cli-utils.js`); an invocation still carrying `--force` degrades to a no-op rather than an error. This is acceptable for an operator-only tool and is recorded as a deliberate tradeoff, not tested.
- **The workflow's commit step stages `git add src/config scripts/lib/generated-configs.json`** (`configs.yml:60`). A stray `src/config/<courseId>.json.tmp-<pid>` left behind would be staged by `git add src/config`; hence the temp file is removed on failure and the normal path renames it away. The temp name is not a `.json` file, so it cannot collide with a real config.

## Notes

- **Translations dropped is intended, not a bug.** Generated configs are English-only; overwriting `wouldrather.json`/`model.json`/etc. with a generated config drops es/pt/bn. `src/config/wouldrather.test.js` and `model-config.test.js` guard the *hand-authored* configs' locales, and those configs are not in the allow-list, so the guard keeps working until an operator deliberately migrates a course to the sheet. Do not re-introduce a refusal guard.
- **Allow-list is orthogonal.** `scripts/lib/generated-configs.json` starts `[]`; a course already listed stays listed and its config is overwritten; a first write appends the id (default-path run only). The contract guard's English-only check applies to listed courses and now also runs after overwrites — a deliberate, correct tightening.
- **`--dry-run` is the only preview.** It still writes nothing (including no temp file) and prints the would-be path per course.
- **No CI behavior change.** `configs.yml` already ran without `--force`; the only workflow edit is a corrected comment. Because overwrite is now the default, a re-run with sheet edits produces a diff and the bot commits it — the intended fix.
- **Operator guidance (non-automatable).** Before pointing the sheet at an existing course, confirm you intend to replace that file's hand-authored/localized content. The sheet is authoritative for any course it defines.
