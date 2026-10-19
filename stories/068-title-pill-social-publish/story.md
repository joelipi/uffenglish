# Compact title pill under the app blur + publish social twins to the private bucket

## Context

Two independent gaps in the lesson-video pipeline (`docs/video-pipeline/`), fixed in one story because both touch the render's outputs and both are verified by the same suites.

**Part 1 — the burned-in title pill pokes out below the app's top blur.** `create_overlay_html` in `docs/video-pipeline/video_pipeline.py` burns a wrapping white title pill with `title_base = max(10, int(video_height * 0.05))` (5% of video height) into the band `TITLE_TOP = 0.07` → `BODY_TOP = 0.17` (video_pipeline.py:1010–1027). But over non-branching steps the app draws only the compact blur: `VIDEO_HEADER_COMPACT_RATIO = 0.12` (`src/modules/video/video-header-logic.js:28`), realized as `height: calc(var(--video-header-ratio) * 100%)` on `.video-header-blur` (`src/assets/css/app.css`). The title band (down to 17%) extends 5 points below the blur (ends at 12%), so the pill's lower rows render unblurred under the progress/mission overlay. The fix restyles the title pill so the entire pill (text + padding) sits at or below the compact-blur line, keeping `TITLE_TOP = 0.07` as the chrome margin.

**Part 2 — the social twins are rendered and then abandoned.** Stage 3 composites each step's CRF-18 full-res master to `output/social/<name>.mp4` (`SOCIAL_CRF = 18`, video_pipeline.py:120–122; `social_path`/`web_path`, video_pipeline.py:158–163) and derives the web output from it (`write_web_from_master(master, web)`, video_pipeline.py:203+), but `modal_app.py` references `SOCIAL_DIR` only in the setup comment (`orchestrator`, modal_app.py:228) and `_publish` uploads `WEB_DIR` entries alone (modal_app.py:320–347). Only `output/web` reaches R2. The fix uploads each step's social twin plus its poster to the private bucket, where the operator downloads them from the R2 dashboard for posting to TikTok/IG.

## Out of Scope

- **Removing the title.** The pill stays; only its size/band changes.
- **Web-vs-social overlay differences.** There is a single render pass today (the social file is the master; web is re-encoded from it), so the overlay is output-independent by construction. No split is introduced.
- **Body/subtitle/footer band semantics.** `APP_CAPTION_TOP = 0.80`, `FOOTER_TOP`, `BODY_BOTTOM`, and what each band shows do not change; `BODY_TOP` moves only as far as the title-band shrink requires, and the body band keeps its existing floor derivations.
- **App blur behavior itself.** `VIDEO_HEADER_COMPACT_RATIO`, `videoHeaderBlurStyle`, and `.video-header-blur` are untouched; the pipeline conforms to them, not vice versa.
- **App/config changes for social.** Step slugs are unchanged and the app never reads the social keys.
- **Public CDN serving of social.** No new CDN rules, no `r2.ultrafastfluency.com` surface for social keys.
- **Lifecycle/TTL changes.** `pipeline-assets/` keeps its existing rule; social keys inherit it.
- **Re-encoding profiles.** `SOCIAL_CRF`, `SOCIAL_PRESET`, `SOCIAL_AUDIO_BITRATE` are untouched; the social twin uploads as-is with no web-budget re-encode.
- **Merging into `main`.** Push the story branch when verified; merging is a separate step.

## Implementation approach

### 1. Title pill: shrink into the compact-blur band (decision)

Keep `TITLE_TOP = 0.07`. Lower `BODY_TOP` from `0.17` toward `~0.12` and shrink `title_base` / `title_max_height` / `TITLE_PADDING_Y` so that the whole pill — `TITLE_TOP * H + title_max_height + 2 * TITLE_PADDING_Y` — sits at or below `0.12 * H` (the compact-blur line). Target `title_base ≈ 1.5 × body_min` (the body legibility floor, `video_height * 0.018`): at 1080×1920 that is ~52px against a ~96px title band, leaving room for padding without crossing the blur line. The exact constants are the implementer's to re-derive — `BODY_TOP` also anchors `.subtitle` / `mark` / `aside` tops (video_pipeline.py:1070, 1121, 1142) and the `OverlayBandGuardTest` floor derivations (`APP_CAPTION_TOP` → `FOOTER_TOP` → `BODY_BOTTOM`, test_pipeline_source.py:256–279) — but the two inequalities in Task 1 are non-negotiable and the existing guards stay green (updated only where their contract intentionally changes, each update re-proven failable by mutation).

Establish a single-variable tie between the pipeline's title-band bottom and `VIDEO_HEADER_COMPACT_RATIO` (e.g. a named `TITLE_BAND_BOTTOM` constant with a comment citing `src/modules/video/video-header-logic.js`), following the repo's existing pattern where one variable ties two layers (`VIDEO_HEADER_RATIO` ties the recap renderer to the blur layer via `video-header-logic.js:15–22`). Pin it with parity guards in both directions (Task 2): Python reads the raw JS constant, JS reads the raw Python constant, both mutation-proven — the same raw-text, scoped-slice style as `test_pipeline_parity.py` and `OverlayTitleAndAsideGuardTest`.

### 2. Social publish: new keys, extended plan, required upload (decision)

New `pipeline_lib.py` helpers `social_video_key(slug)` → `pipeline-assets/social/<slug>.mp4` and `social_poster_key(slug)` → `pipeline-assets/social/<slug>.jpg`, returning `None` for invalid slugs exactly like `published_video_key`/`published_poster_key` (pipeline_lib.py:61–66). `pipeline-assets/` is already in `PRIVATE_KEY_PREFIXES` (pipeline_lib.py:41), so `is_private_key`/`bucket_for_key` cover the new keys with zero changes — assert that. Mirror in `src/modules/video/pipeline-keys.js` as `socialVideoKey`/`socialPosterKey` with parity tests on both sides, the story-040 pattern (`KeyPatternParityTest`, `PrivateKeyParityTest` in test_pipeline_parity.py; `pipeline-keys.test.js` on the JS side).

This works without filename mapping because social and web twins share one name: `concatenate_video_group` writes `master = social_path(<prefix>_full.mp4)` and `web = web_path(<prefix>_full.mp4)` (video_pipeline.py:1494–1496), and joins likewise write both dirs under `<join>.mp4` (video_pipeline.py:1647–1648). Extend each `plan_publish` entry with `social_video_key` + `social_poster_key`, gated on the social listing exactly the way web keys are gated on the web listing (a missing social twin drops the entry just as a missing web file drops it today — `plan_publish`, pipeline_lib.py:317, 327–329). The orchestrator passes `os.listdir(pipeline.SOCIAL_DIR)` alongside `WEB_DIR` (cf. modal_app.py:273).

`_publish` uploads, per entry, the web file (existing budget/probe/re-encode path, byte-identical) plus the social twin as-is (no budget check, no re-encode — it is already the CRF-18 master) and a 0.2s social poster cut with `poster_args` from the social file, both to the private bucket. Missing-file semantics match today exactly: `if not os.path.exists(source): continue` skips the entry (modal_app.py:332–333) — no softer rule, no harder rule. Required-ness means what it means for web: no `try/except` swallow (unlike `_publish_intro_posters`, which is explicitly best-effort, modal_app.py:138–196) — an upload error propagates and fails the render — and every slug's social outcome is reported in the `done` status marker next to `published`. Join outputs ride the same plan entries as their web siblings (required); intro-posters get social twins under the same best-effort rule as their web siblings (extend `_publish_intro_posters`, still never failing the render).

### 3. Guard hygiene (decision)

All source assertions read raw file text (URLs and CSS contain `//`; comment-stripping breaks scheme assertions), slice to the target function/block (never whole-file `toContain` for repeated tokens), and are proven failable by injecting the forbidden/changed token before trust (AGENTS.md guard rules). The overlay-HTML value assertions (font size, band bottom) run against `create_overlay_html` output for a fixed 1080×1920 frame, not against live renders.

## Tasks

### Task 1 - Title pill fits under the compact blur

- 1080×1920 frame + `create_overlay_html` output parsed for title `font-size`, `.title` `top`/`max-height`, and span vertical padding
  - → `top + max-height + 2 × padding_px ≤ 0.12 × 1920` (whole pill at/below the compact-blur line)
  - → `title font-size` within ±2px of `1.5 × body_min` for the same frame
  - → `TITLE_TOP` still `0.07` in source (chrome margin kept)
- overlay source with `BODY_TOP` lowered + any of `title_base`, `title_max_height`, `TITLE_PADDING_Y` mutated upward past the blur line
  - → the band-bottom unit test fails (mutation-proven)
- full Python suite (`node scripts/run-python-tests.mjs`)
  - → green, including `OverlayBandGuardTest` (caption-floor derivations intact) and `OverlayTitleAndAsideGuardTest` (pill styling tokens updated only where the new sizing intentionally changes them, each updated assertion re-proven failable)
- social vs web output of the same step
  - → burned overlay bytes derive from the single `create_overlay_html` path (no per-output overlay branch in source; guard asserts one overlay call site feeds both `social_path` and `web_path` writes)

### Task 2 - Title-band ↔ compact-ratio parity guard, both directions

- Python guard reading raw `src/modules/video/video-header-logic.js`
  - → pipeline `TITLE_BAND_BOTTOM` (or equivalent single variable) equals the file's `VIDEO_HEADER_COMPACT_RATIO` value; changing either side's literal fails the guard
- JS guard (`src/modules/video/`, `*-logic.js` only — no component logic) reading raw `docs/video-pipeline/video_pipeline.py`
  - → asserts the same equality from the JS side; changing either side's literal fails the guard
- `npx vitest run` for the new JS guard file
  - → green; each assertion throws when the pinned token is injected into a scanned copy

### Task 3 - Social key helpers + JS mirror + parity

- `social_video_key("wouldyourather_a01")` + `social_poster_key("wouldyourather_a01")` + invalid slug (`"../x"`, `"a.mp4"`, 101 chars)
  - → `pipeline-assets/social/wouldyourather_a01.mp4`, `pipeline-assets/social/wouldyourather_a01.jpg`, `None` for each invalid input
- `is_private_key` + `bucket_for_key` over both new keys
  - → `True` / `"private"` with no change to `PRIVATE_KEY_PREFIXES` (already covers `pipeline-assets/`)
- `socialVideoKey` / `socialPosterKey` in `src/modules/video/pipeline-keys.js` over the story-040 accept/reject slug set
  - → identical accept/reject outcomes to `publishedVideoKey`/`publishedPosterKey` except for the `pipeline-assets/social/` prefix and extension
- new parity test class in `docs/video-pipeline/tests/test_pipeline_parity.py` + assertions in `src/modules/video/pipeline-keys.test.js`
  - → py↔js prefix/extension rules match exactly; mutating either side's literal fails its guard

### Task 4 - Social publish plan, upload, and status reporting

- `plan_publish` rows (plain step with `video_file`, joined step with `join`, row with neither) with both listings present
  - → every entry carries `social_video_key` + `social_poster_key` under `pipeline-assets/social/<slug>.mp4|.jpg`; joins emit one entry for the join slug (never per-take `processed_*`); rows with neither are skipped
- `plan_publish` with a slug present in the web listing but absent from the social listing (and vice versa)
  - → entry dropped, exactly as a missing web file drops it today (no softer rule)
- `_publish` over a 2-entry plan with stubbed storage + ffprobe (one entry over budget, one within)
  - → web path byte-identical to today (same probe/re-encode/upload/poster call sequence); each entry additionally uploads the social twin as-is (no re-encode) and a `poster_args` still from the social file to the private bucket keys
- `_publish` with a missing social file on disk
  - → entry skipped via the existing `continue`, same as a missing web file (source guard pins the shared missing-file branch covers both uploads)
- `_publish` with the storage upload raising for a social key
  - → exception propagates (no swallow); the render fails — unlike `_publish_intro_posters`, which stays best-effort
- orchestrator source + `_publish_intro_posters` source guards (raw text, scoped slices)
  - → orchestrator passes `os.listdir(pipeline.SOCIAL_DIR)` into planning and reports per-slug social outcomes in the `done` marker next to `published`; intro posters gain `pipeline-assets/social/<slug>.jpg` twins under the existing best-effort rule (a social intro-poster failure still cannot fail the render)
- `SOCIAL_CRF`, `SOCIAL_PRESET`, `SOCIAL_AUDIO_BITRATE` source
  - → byte-identical values (`18`, `"slow"`, `"256k"`); guard fails on mutation

### Task 5 - Docs + full verification

- `docs/product.md` Features list
  - → new entries for the compact title pill (title band at/below the 12% blur line, story link) and private social-twin publishing (`pipeline-assets/social/`, story link), matching the existing entry format
- `npx vitest run` + `node scripts/run-python-tests.mjs` + `npm run build` + `npm run lint`
  - → all green, verified locally; no workflow dispatched to test
- story branch, pushed
  - → `git push -u origin 068-title-pill-social-publish` with only the story file + implementation + tests committed (merging separate)

## Technical Context

- **Overlay layout (read before touching):** `create_overlay_html` in `docs/video-pipeline/video_pipeline.py:995–~1230`; bands `TITLE_TOP = 0.07`, `BODY_TOP = 0.17` (:1010–1011); pill math `TITLE_PADDING_Y = 18`, `title_base = 5%`, `title_max_height` (:1025–1027); body anchors `.subtitle top` (:1070), `mark top` (:1121), `aside top` (:1142); guards `OverlayBandGuardTest` + `OverlayTitleAndAsideGuardTest` in `docs/video-pipeline/tests/test_pipeline_source.py:256–304`.
- **Blur side (do not change):** `VIDEO_HEADER_COMPACT_RATIO = 0.12` (`src/modules/video/video-header-logic.js:28`); `videoHeaderBlurStyle` default compact (:46–48); `.video-header-blur` height rule (`src/assets/css/app.css:426`); existing ratio test (`src/modules/video/video-header-logic.test.js:53–55`).
- **Single render pass (why no split):** social master written first, web re-encoded from it (`write_web_from_master`, video_pipeline.py:203+; `concatenate_video_group`, :1487+; joins, :1623+); `_publish` + `_publish_intro_posters` in `docs/video-pipeline/modal_app.py:138–196, 320–347`; plan in `docs/video-pipeline/pipeline_lib.py:303–351`; its tests in `docs/video-pipeline/tests/test_pipeline_lib.py:75–190` and `test_modal_app_source.py`.
- **Key naming (mirror pattern):** `PUBLISHED_VIDEO_PREFIX = "assets/videos/"`, `PIPELINE_ASSET_PREFIX = "pipeline-assets/"`, `PRIVATE_KEY_PREFIXES` (`pipeline_lib.py:32–41`); JS side `src/modules/video/pipeline-keys.js` + `pipeline-keys.test.js`; parity `docs/video-pipeline/tests/test_pipeline_parity.py` (`KeyPatternParityTest:89`, `PrivateKeyParityTest:175`).
- **No new dependencies.** Bootstrap section deleted intentionally.
- **Verification (never CI):** `npx vitest run`, `node scripts/run-python-tests.mjs`, `npm run build`, `npm run lint`.

## Notes

- **Why private, not public:** the social twins are operator post-production masters, not app media — the app never reads them, so they need no CDN rule and must add no public surface. `pipeline-assets/` already lives in the private bucket (`uff-private`) and already persists like other pipeline assets (no TTL change, no lifecycle edit), and the operator's existing workflow is pulling files from the R2 dashboard. A public prefix would require CDN/cache review for zero benefit.
- **Why no web/social split anymore:** there never was one in the overlay — one `create_overlay_html` pass burns the titles, the social file is the master, and web is a re-encode of it. The only new things are the title style (same on both outputs automatically) and the social upload. Any future per-output styling must remain out of scope until a real product need appears.
- **What "required" means for social publish:** identical gating and identical missing-file skip to web today, plus exceptions propagate and per-slug outcomes land in the `done` marker. It deliberately does NOT mean retry logic, alerting, or blocking web publishing when social fails at the plan stage — those would be new semantics, not parity.
- **Non-automatable operator step (after merge):** download social twins from the R2 dashboard (`uff-private` bucket, `pipeline-assets/social/`) for posting; no dashboard secret/var changes are needed by this story.
- **Numerical anchor for reviewers:** at 1080×1920 the compact blur ends at ~230px; today's pill starts at ~134px with up to 156px of capped block height (~290px bottom) — about 60px of pill shows below the blur. The new pill must bottom at or above 230px on that frame.
