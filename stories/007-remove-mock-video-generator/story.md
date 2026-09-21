# Remove the mock video generator

## Context

`scripts/generate-mock-videos.mjs` generates placeholder lesson videos (solid-colour background + ffmpeg `flite` TTS voice) and, with `--upload`, pushes them to R2. It was originally a one-off tool to stand in for a couple of missing clips, but its `SLUGS` map grew to cover shared lesson slugs (`gtests-1-0`…`gtests-1-3`, `success`, `testvideo01`–`08`, the grocery slugs) and the upload path was run globally.

Because `uploadAll()` calls `wrangler r2 object put uff/assets/videos/<slug>.mp4` (`scripts/generate-mock-videos.mjs:139-141`) and `put` unconditionally overwrites an existing object, and because `generateOne()` renders locally with `ffmpeg ... -y` (`:114-124`), the tool destroyed real teacher recordings that occupied those slugs. The R2 evidence matches: `gtests-1-0`…`gtests-1-3` and `success` were last modified `2026-09-10 07:44:17–24`, one minute before commit `123ac01` (2026-09-10 07:45:38) introduced the tool. R2 has no object versioning, so the originals could not be restored.

The tool has no legitimate ongoing role: lesson media is real teacher video hosted on Cloudflare R2 and uploaded deliberately. The safest outcome is to delete the generator entirely so nothing can silently overwrite production media again, and to make the "real media on R2" workflow explicit in the docs that currently advertise the generator.

## Out of Scope

- No deletion of existing R2 objects. The mock videos already uploaded (`gtests-*`, `success`, `testvideo01`–`08`, grocery slugs) stay in place; lessons continue to render them until real recordings are uploaded to the same slugs. No `wrangler r2 object delete` commands are added.
- No changes to `src/config/*.json` video slugs. Lessons `new`/`a`/`w`/`g` keep their current slugs; re-uploading real recordings to those slugs is a separate, manual operation.
- No changes to `scripts/generate-thumbnails.mjs`, `scripts/verify-thumbnails.mjs`, `scripts/fix-video-sync.mjs`, or the CI poster pipeline. ffmpeg is still required for poster generation.
- Historical story documents `stories/001-webcam-only-share-cta/story.md` and `stories/003-add-wf-video-player-step/story.md` are left untouched. They are dated records of work as it was done at the time and are explicitly excluded from the regression scan.
- No new production module is added for the guard; the scan helper lives inside the test file.
- No change to `src/modules/video/video-url.js` URL resolution.

## Implementation approach

1. **Delete the script.** `git rm scripts/generate-mock-videos.mjs`. It is tracked (`git ls-files` confirms), so it must be removed from git, not just the working tree.

2. **`.gitignore`.** Remove the eleven mock-specific video paths (`assets/videos/do_you_have_*.mp4`, `assets/videos/where_is_the_bread_aisle.mp4`, `assets/videos/gtests-*.mp4`, `assets/videos/success.mp4`, currently lines 22–32) and the "Generated mock lesson videos" comment (line 34). Keep exactly one video ignore rule, `public/assets/videos/*.mp4`, and re-label it so its intent is clear (videos live on R2 and are too large to commit):
   - replace the removed block with: `# Lesson media lives on Cloudflare R2 (assets/videos/<slug>.mp4) — never commit local video files`
   - the line `public/assets/videos/*.mp4` is retained verbatim.
   Predicate for "a specific (non-generic) video ignore": a line matching `/(?:gtests|testvideo|do_you_have|success)\S*\.mp4/` — there must be none.

3. **Docs (README.md, agents.md).**
   - `README.md:96` — replace the `**Mock lesson videos:**` paragraph with a real-media paragraph: lesson videos live on R2 at `https://r2.ultrafastfluency.com/assets/videos/<slug>.mp4` (dev serves `/assets/videos/<slug>.mp4` through the Vite proxy, `vite.config.js:72`); video files are gitignored and never committed; upload recordings to R2 and reference the slug in `src/config/*.json`; uploads are manual (no generator).
   - `agents.md:12` — delete the clause "the spoken text for mock videos is in `scripts/generate-mock-videos.mjs`" so the sentence only describes where lesson content lives.
   - `agents.md:54` — replace the `**Mock lesson videos ...**` paragraph with a `**Lesson media (real recordings only):**` paragraph: every slug in `src/config/*.json` resolves to a real file on R2 (`src/modules/video/video-url.js`); files are never committed; upload manually with `npx wrangler r2 object put uff/assets/videos/<slug>.mp4 --file <path> --content-type video/mp4`; do not add a placeholder/mock generator.

4. **Regression guard.** Add `src/modules/video/no-mock-video-generator.test.js` (vitest; the `src/**/*.test.js` glob is included, `tests/**` and `*.spec.js` are excluded per `vitest.config.js`). The file contains a self-contained scanner plus the assertions:
   - `scanForToken(root, token, opts)` recursively walks `root`, skipping directories in `EXCLUDED_DIRS = { node_modules, .git, dist, stories, .wrangler, coverage, test-results }`, skipping the guard file itself by absolute path, and reading only text files whose extension is in `TEXT_EXTENSIONS = { .js, .jsx, .mjs, .cjs, .ts, .tsx, .json, .jsonc, .md, .markdown, .yml, .yaml, .toml, .html, .css, .txt }` or whose basename is in `TEXT_FILENAMES = { .gitignore, .env.example }`. Binary reads are skipped on error.
   - Assertions:
     1. scanner finds the token in a synthetic temp fixture (proves the guard actually detects a reintroduction);
     2. scanner over the real repo root returns `[]` for `generate-mock-videos` (historical `stories/**` excluded);
     3. `scripts/generate-mock-videos.mjs` does not exist;
     4. `.gitignore` contains `public/assets/videos/*.mp4` and no line matches `/(?:gtests|testvideo|do_you_have|success)\S*\.mp4/`;
     5. `package.json` `scripts` contains no key or command matching `/mock/i`.

## Tasks

### Task 1 — Delete the generator and its ignore/doc references

- `scripts/generate-mock-videos.mjs` present in the tracked tree + `git rm` applied
  - → `fs.existsSync(path.join(repoRoot, 'scripts/generate-mock-videos.mjs'))` is false
  - → `git ls-files scripts/generate-mock-videos.mjs` prints nothing
- repository (tracked files) searched for `generate-mock-videos` with `stories/**` and the guard file excluded
  - → zero matches outside `stories/**` and the guard file
- `.gitignore` read after edit
  - → one line exactly `public/assets/videos/*.mp4` is present
  - → no line matches `/(?:gtests|testvideo|do_you_have|success)\S*\.mp4/`
- `README.md` read after edit
  - → does not contain `generate-mock-videos`
  - → contains `assets/videos/<slug>.mp4` and `r2.ultrafastfluency.com`
- `agents.md` read after edit
  - → does not contain `generate-mock-videos`
  - → does not contain the phrase `Mock lesson videos`
  - → states lesson media lives on R2 and is uploaded manually

### Task 2 — Regression guard

- guard scanner run against a temp fixture directory containing `docs/ref.md` with the text `generate-mock-videos`
  - → scanner returns the absolute path of that fixture file
- guard scanner run against the repository root with the documented exclusions
  - → scanner returns an empty list
  - → the generator script path does not exist
- `npm test -- --run`
  - → the new `src/modules/video/no-mock-video-generator.test.js` passes
  - → the full vitest suite remains green

## Technical Context

- No new dependencies. The guard uses Node built-ins only: `node:fs`, `node:path`, `node:os`, `node:url` (`fileURLToPath`). Vitest runs on Node even with `environment: 'jsdom'`, so `fs`/`path` are available.
- Test discovery: `vitest.config.js` excludes `**/tests/**` and `**/*.spec.js` and includes the default `**/*.test.js` glob. `src/modules/video/no-mock-video-generator.test.js` is therefore run by `npm test -- --run`. Existing colocated tests (`src/modules/video/video-url.test.js`) confirm the pattern.
- URL resolution referenced by the docs rewrite: `src/modules/video/video-url.js:5` (`CDN_BASE = 'https://r2.ultrafastfluency.com/assets/videos/'`), `:21-24` (DEV → `/assets/videos/<slug>.mp4`, prod → `${CDN_BASE}<slug>.mp4`), and the Vite proxy at `vite.config.js:72-75`.
- `scripts/generate-mock-videos.mjs` is not referenced by `package.json` scripts, `.github/workflows/deploy.yml`, `knip.jsonc`, or any test — deletion has no build/CI impact. ffmpeg remains installed in CI for `generate-thumbnails.mjs`.
- `docs/product.md` is updated in this planning commit (the placeholder limitation at line 32 is replaced with the R2 media reality), so the implementer does not need to touch it.

## Notes

- Decision recorded during planning: historical stories `stories/001-webcam-only-share-cta/story.md` and `stories/003-add-wf-video-player-step/story.md` keep their references to the generator. They document what happened at the time; editing them would rewrite history and provide no product value. `stories/**` is excluded from the regression scan for this reason.
- R2 mock objects are intentionally left in place (product decision). Lesson `new` and the other lessons referencing `gtests-*`/`success`/`testvideo*` will keep playing those placeholders until real recordings are uploaded to the same slugs. This is a media-content task, not a code task.
- Videos are always gitignored (`public/assets/videos/*.mp4`) because they are too large for the repository; the CDN (Cloudflare R2) is the system of record. Never commit video files or reintroduce a local video generator.
- Manual verification: `npm test -- --run` green; `git grep -n "generate-mock"` returns matches only under `stories/**`; `ls scripts/` shows no `generate-mock-videos.mjs`.
