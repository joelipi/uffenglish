# Auto-caption new simple videos with local Whisper + DeepSeek

## Context

Simple-video steps (`step.simpleVideoUrl` / legacy `question.simpleVideoUrl`) render `step.subtitles`
through `SimpleVideoStateController.initSubtitles()`: a string containing `-->` is parsed as timed SRT,
otherwise it scrolls as static text (`src/modules/video/simple-video-controller.js`). Today subtitles are
hand-authored and sparse — of the tracked configs, `model.json` has 30 `simpleVideoUrl` steps and only 17
carry any `subtitles`. Lesson content is about to split into many per-lesson config files, and hand-writing
an English transcript plus five translations for every new simple video does not scale.

The repo already runs Whisper in the browser: `@huggingface/transformers@3.8.1` (a direct dependency) with
its Node backend `onnxruntime-node@1.21.0` (transitive, already in `package-lock.json`), and the demo worker
pins `onnx-community/whisper-tiny.en` (`src/workers/whisper/whisper-worker-demo.js:48,94`). The browser
worker itself cannot run in CI (it uses `importScripts`, `caches`, and `WebAssembly.instantiateStreaming`),
but the engine and a Whisper model run headlessly in Node — verified during planning: ffmpeg → raw f32 PCM →
`pipeline('automatic-speech-recognition', 'onnx-community/whisper-base.en', { dtype: { encoder_model: 'q8',
decoder_model_merged: 'q8' } })` returned `{ text, chunks: [{ timestamp: [start, end], text }] }` in ~1s for
a 4.2s clip. So speech-to-text is local and free. Translation is the only cloud step, using DeepSeek — already
used by `.github/scripts/generate_spec.js` (`https://api.deepseek.com/v1/chat/completions`).

## Out of Scope

- No captions for videos/steps that already exist or already lack captions. Only slugs newly introduced in a push are processed; `gt2.json` (73 uncaptioned), `model.json` (13), `t.json` (2) are never touched.
- No changes to `interactiveVideoUrl` or `introBackgroundVideoUrl` steps — `simpleVideoUrl` only.
- No PR/review flow and no schedule. The Action commits generated captions back to the pushed branch.
- No cloud speech-to-text provider. STT is local Whisper only.
- No app runtime changes: the player already parses SRT, and `getLocalizedTranslation()` already resolves `fr`/`hi`/`bn` keys (it lowercases the stored `native_language` code and falls back to `en`).
- No language-picker changes. Bengali is not selectable in `GuestLoginModal.web.jsx`/`SignupForm.web.jsx` today; the `bn` track is generated for future use but not surfaced.
- No backfill or migration of existing subtitle strings, and no changes to `src/config/model.test.js` or `video-processor-logic.js`'s six-language CTA map.

## Implementation approach

**1. Trigger and workflow — `.github/workflows/captions.yml`.**
Runs on `push` to any branch. A per-ref concurrency group serialises runs so two quick pushes cannot race
their commits. `permissions: contents: write` is required to push the caption commit. The job is skipped
when `github.actor == 'github-actions[bot]'` or the head commit message contains `[skip captions]`.

Base resolution: use `${{ github.event.before }}` when it matches `/^[0-9a-f]{40}$/`, is not all zeros, and
`git cat-file -e <sha>^{commit}` succeeds; otherwise (new branch, `before == 000…0`) fetch the default branch
and use `git merge-base HEAD origin/main`. Changed files are
`git diff --name-only "$BASE" "$HEAD" -- 'src/config/*.json'`. When that list is empty the generation,
commit, and push steps are skipped entirely.

```yaml
name: Generate Captions
on:
  push:
    branches: ['**']
permissions:
  contents: write
concurrency:
  group: captions-${{ github.ref }}
  cancel-in-progress: false
jobs:
  captions:
    runs-on: ubuntu-latest
    if: github.actor != 'github-actions[bot]' && !contains(github.event.head_commit.message, '[skip captions]')
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: sudo apt-get update && sudo apt-get install -y ffmpeg
      - name: Resolve changed config files
        id: changed
        run: bash .github/scripts/captions-changed.sh
      - name: Cache Whisper model
        if: steps.changed.outputs.files != ''
        uses: actions/cache@v4
        with:
          path: ${{ runner.temp }}/uff-caption-model
          key: uff-whisper-base-en
      - name: Generate captions
        if: steps.changed.outputs.files != ''
        env:
          DEEPSEEK_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
          CAPTION_MODEL_CACHE: ${{ runner.temp }}/uff-caption-model
        run: node scripts/generate-captions.mjs --base "${{ steps.changed.outputs.base }}" --head "${{ github.sha }}" --files "${{ steps.changed.outputs.files }}"
      - name: Commit captions
        if: steps.changed.outputs.files != ''
        run: |
          git config user.name "uff-captions-bot"
          git config user.email "actions@users.noreply.github.com"
          git add src/config
          if git diff --cached --quiet; then
            echo "no caption changes"
          else
            git commit -m "chore(captions): add generated SRT for new simple videos [skip captions]"
            git push origin "HEAD:${{ github.ref_name }}"
          fi
```

**2. New-video detection (pure).** `findNewSimpleVideoTargets(beforeConfig, afterConfig)` walks
`lessons[].steps` and `lessons[].questions`, collects every `simpleVideoUrl` present in the before revision,
and returns one target `{ slug, lessonIndex, stepKey, stepIndex }` for each after-revision occurrence whose
slug is NOT in the before set, skipping any step that already has a `subtitles` property. This is what
enforces "new videos only" and "never overwrite": existing uncaptioned slugs are in the before set, and
authored subtitles are skipped.

**3. Audio + local Whisper.** Download `https://r2.ultrafastfluency.com/assets/videos/<slug>.mp4` (the
production URL from `src/modules/video/video-url.js`; hardcode the base as `scripts/generate-thumbnails.mjs:31`
does, because `video-url.js` reads `import.meta.env`). Extract PCM with
`ffmpeg -y -loglevel error -i <mp4> -vn -ar 16000 -ac 1 -f f32le <out.f32>`, read it into a `Float32Array`,
and run the ASR pipeline with `onnx-community/whisper-base.en` (q8 encoder/decoder) using
`{ return_timestamps: true, chunk_length_s: 30 }`. Set `env.cacheDir` to `process.env.CAPTION_MODEL_CACHE ||
path.join(os.tmpdir(), 'uff-caption-model')` so the cached model lives outside the repo and is `actions/cache`-able.

**4. SRT construction.** `chunksToSrt(chunks)` emits `HH:MM:SS,mmm --> HH:MM:SS,mmm` cues, 1-based, trimming
each chunk's text, skipping chunks with empty text or a non-finite start, and using `end ?? start` when
Whisper reports a null end. The format matches what `SimpleVideoStateController` parses (it splits the second
field on `[,.]`).

**5. Translation.** For each of `es`, `pt`, `fr`, `hi`, `bn`, POST the English SRT to
`https://api.deepseek.com/v1/chat/completions` with `model: deepseek-v4-flash`,
`response_format: { type: 'json_object' }`, and a prompt requiring a JSON object `{ "srt": "<translated SRT>" }`
that preserves cue numbers and timestamps exactly, translating only subtitle text and leaving the taught
English target phrase (e.g. after `Say:` / `Di:` / `Diga:`) in English. `validateTranslatedSrt(englishSrt,
translatedSrt)` parses both and requires identical cue count and matching `start`/`end` within 1 ms; any
mismatch throws and the job fails before writing. If `DEEPSEEK_API_KEY` is unset the CLI exits non-zero with a clear message before any file is written.

**6. Format-preserving injection.** Insert with `jsonc-parser@3.3.1`: for each target, sequentially
`applyEdits(text, modify(text, ['lessons', lessonIndex, stepKey, stepIndex, 'subtitles'], captionObject,
{ formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' } }))`. A test proved this keeps existing
inline `cue` objects byte-identical, adds only the new block (plus the preceding comma), and preserves
non-ASCII (`hi`/`bn`) text. Caption objects use keys `['en','es','pt','fr','hi','bn']` (matching the
`CTA_LOCALE_MAP` six-language convention in `src/modules/video/video-processor-logic.js:22`).

**7. Orchestration seam for tests.** `buildCaptionEdits({ beforeText, afterText, transcribe, translate,
languages })` performs steps 2/4/5/6 using injected `transcribe(slug) -> chunks` and
`translate(englishSrt, lang) -> srt` functions and returns `{ text, generated }`. `scripts/generate-captions.mjs` is a thin CLI that supplies the
real git/R2/ffmpeg/Whisper/DeepSeek implementations and writes the file. All network and process work lives
behind the injected functions, so the whole pipeline is unit-tested with fakes.

**8. Commit semantics note.** `GITHUB_TOKEN`-authored pushes do not trigger further workflow runs, so the
caption commit neither loops nor auto-redeploys: captions become live on the next human push (or a manual
`deploy.yml` dispatch). This is the accepted trade-off of "commit back, no PR."

## Tasks

### Task 1 - Pure caption utilities and orchestration

- config where a `simpleVideoUrl` step is added in `afterText` with no `subtitles` + `findNewSimpleVideoTargets(before, after)` called
  - → returns exactly one target with the new slug, correct `lessonIndex`, `stepKey: 'steps'`, `stepIndex`
- slug present in `before` (uncaptioned) + new step added that reuses it
  - → returns `[]` (existing videos are never captioned)
- added `simpleVideoUrl` step that already has a `subtitles` object
  - → returns `[]` (no overwrite)
- added step with only `interactiveVideoUrl` or only `introBackgroundVideoUrl`
  - → returns `[]`
- legacy config using `questions` instead of `steps`
  - → target has `stepKey: 'questions'`
- two added steps share one new slug
  - → two targets (both occurrences are captioned)
- `beforeText` is `null`/file is new + `findNewSimpleVideoTargets`
  - → every uncaptioned `simpleVideoUrl` step in the file is returned
- `secondsToSrtTimestamp(0)` / `(3.5)` / `(3661.007)`
  - → `00:00:00,000` / `00:00:03,500` / `01:01:01,007`
- `chunksToSrt([{ timestamp: [0.5, 3], text: ' Hello' }, { timestamp: [3.5, 6], text: 'World' }])`
  - → cue 1 uses `00:00:00,500 --> 00:00:03,000` and text `Hello`; cue 2 is numbered `2`
- `chunksToSrt([])`, a chunk with empty/whitespace text, and a chunk with `timestamp: [2, null]`
  - → `''`; empty chunk skipped; null end becomes `end === start`
- `parseSrt(chunksToSrt(chunks))`
  - → cue count, start/end (within 1 ms), and text match the input chunks
- `chunksToSrt` output passed to `new SimpleVideoStateController({}).initSubtitles(srt)` (imported from `src/modules/video/simple-video-controller.js`)
  - → `state.isTimedSubtitles === true` and `state.timedSubtitles.length` equals the cue count (player compatibility)
- `validateTranslatedSrt(enSrt, translatedWithSameCues)`
  - → `{ ok: true }`
- translated SRT with a different cue count, or a shifted timestamp
  - → `{ ok: false, reason }`
- `applyCaptionsToText(text, targets, captionsBySlug)` with a 2-space config containing inline `cue` objects
  - → every target step gains `subtitles` with keys exactly `['en','es','pt','fr','hi','bn']`
  - → a pre-chosen unrelated inline `cue` line is byte-identical before and after
  - → `JSON.parse` of the output round-trips without data loss
- target whose step already has `subtitles` + `applyCaptionsToText`
  - → text returned unchanged
- `applyCaptionsToText` called twice with the same arguments
  - → second call returns text identical to the first (idempotent)
- target slug missing from `captionsBySlug` + `applyCaptionsToText`
  - → throws an Error naming the slug
- `buildCaptionEdits` with fake `transcribe`/`translate`, a new slug, and `languages = ['en','es','pt','fr','hi','bn']`
  - → `transcribe` called once per unique slug; `translate` called once per non-English language
  - → returned `text` contains an `en` track equal to `chunksToSrt` of the fake chunks
  - → returned `generated` lists the slug
- fake `translate` returning a shape-mismatched SRT + `buildCaptionEdits`
  - → rejects with an error and no `subtitles` is written for that slug
- `isUsableBaseSha('0'.repeat(40))`, `isUsableBaseSha('not-a-sha')`, `isUsableBaseSha(<valid 40-hex>)`
  - → `false`, `false`, `true`
- module constants
  - → `WHISPER_MODEL === 'onnx-community/whisper-base.en'` and `DEEPSEEK_MODEL === 'deepseek-v4-flash'`

### Task 2 - CLI wiring, workflow, and regression guard

- `scripts/generate-captions.mjs` invoked with `--help`
  - → exits 0 and prints the supported flags
- `.github/workflows/captions.yml`
  - → exists and contains `push`, `contents: write`, `fetch-depth: 0`, `DEEPSEEK_API_KEY`, `ffmpeg`, `node scripts/generate-captions.mjs`, and `git push`
  - → contains no `gh pr create` and no `pull_request` trigger (commit-back requirement)
- `.github/scripts/captions-changed.sh`
  - → exists and contains `merge-base` and `src/config` (base fallback + pathspec)
- `scripts/generate-captions.mjs` source
  - → imports `buildCaptionEdits` from `./lib/caption-utils.js`
  - → does not construct a pull request

### Task 3 - Documentation

- `docs/product.md` read
  - → Features contains a bullet describing auto-generated six-language simple-video captions linking to `stories/009-auto-caption-simple-videos/story.md`
- `README.md` read
  - → mentions `scripts/generate-captions.mjs` and the `DEEPSEEK_API_KEY` secret
- `agents.md` read
  - → instructs that new `simpleVideoUrl` steps get captions automatically on push and must not be hand-backfilled for existing videos

## Bootstrap

```bash
npm install --save-dev jsonc-parser@3.3.1   # updates package.json + package-lock.json
sudo apt-get install -y ffmpeg              # already present in CI (deploy.yml); needed for local runs
npm test -- --run                           # verification gate
```

## Technical Context

- `jsonc-parser@3.3.1` — current `npm view jsonc-parser version`; used solely for format-preserving JSON edits. Named ESM imports (`import { modify, applyEdits } from 'jsonc-parser'`) were verified to work under Node 22.
- `@huggingface/transformers@3.8.1` — already a direct dependency (`package.json`). Node ASR pipeline verified during planning against `onnx-community/whisper-base.en` with `dtype { encoder_model: 'q8', decoder_model_merged: 'q8' }` and `return_timestamps: true`; no new model-hosting work is required (the model is fetched from Hugging Face and disk-cached).
- `onnxruntime-node@1.21.0` — transitive dependency of `transformers@3.8.1` (present in `package-lock.json`), so no new install. `whisper-base.en` was chosen over the existing `whisper-tiny.en` because tiny mis-transcribed "role play" as "robot play" on the planning fixture, whereas base.en produced a closer transcription of the same clip.
- ffmpeg 6.1.1 — CI installs it in `deploy.yml`; the caption workflow installs it the same way. `-f f32le` output is read directly into `Float32Array`.
- DeepSeek — endpoint `https://api.deepseek.com/v1/chat/completions`, model `deepseek-v4-flash` (the default in `workers/deepseek-proxy/index.js:57`; `.github/scripts/generate_spec.js` uses the `deepseek-v4-pro` variant). Requires the `DEEPSEEK_API_KEY` Actions secret, which `.github/scripts/generate_spec.js` already references — the implementer must confirm the secret value exists before relying on it.
- R2 media base `https://r2.ultrafastfluency.com/assets/videos/` — matches `src/modules/video/video-url.js:5`; `scripts/generate-thumbnails.mjs:31` is the precedent for hardcoding it in a CI script.
- Subtitle SRT shape and parsing — `src/modules/video/simple-video-controller.js` `_timeToSeconds`/`initSubtitles` (times split on `[,.]`, blocks split on blank lines, `-->` marks timed cues).
- Six-language convention — `src/modules/video/video-processor-logic.js:22` `CTA_LOCALE_MAP` (`EN, ES, PT, FR, HI, BN`), asserted in `src/modules/video/video-processor-share-cta.test.js`.
- Test discovery — `vitest.config.js` has no `include`, so the default `**/*.test.js` glob runs unless excluded; `**/tests/**` and `**/*.spec.js` are excluded. Place tests in `scripts/`.
- Verification gate is `npm test -- --run` (`docs/learnings.md`: eslint/knip are not runnable in this repo).

## Notes

- `GITHUB_TOKEN` pushes do not retrigger workflows, so the caption commit will not loop and will not immediately redeploy; captions ship on the next push unless a `workflow_dispatch` of `deploy.yml` is added later (deliberately out of scope).
- Branch protection that rejects direct bot pushes to `main` would make the commit step fail; no such protection is evident (commits land on `main` directly per `agents.md`), but this is the one environment assumption.
- Machine-generated captions are committed without human review, per the "no PR" decision. Local `whisper-base.en` accuracy is below cloud `whisper-large-v3`, and DeepSeek translations for `hi`/`bn` are unreviewed; a bad cue can reach the app. The SRT-shape validation only guarantees timing/text alignment, not translation quality.
- A slug reused from another config inside a newly added file is treated as new for that file (the before revision for that file is empty), so it gets its own inline captions. Authored `subtitles` are never replaced.
- The Whisper model cache is ~76 MB of ONNX files for `base.en` (22 MB q8 encoder + 51 MB q8 decoder + tokenizer); `actions/cache` is keyed statically (`uff-whisper-base-en`) because the model id is a constant.
- Local manual verification: `DEEPSEEK_API_KEY=… node scripts/generate-captions.mjs --base HEAD~1 --head HEAD --files "src/config/<file>.json" --dry-run` prints the planned edits without writing; drop `--dry-run` to write, then run `npm test -- --run` and load the lesson at `http://localhost:3000/course/model/lesson/g` to confirm timed captions render.
- `docs/product.md` is the product file for this story and is updated in this planning commit; the implementer still adds the README/`agents.md` notes described in Task 3.
