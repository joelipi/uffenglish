# Authoring — source file to master CSV

The lesson script lives in `sources/wouldyourather.source.txt` (the `sources/`
directory, edited on the GitHub web UI). Saving it regenerates the committed `public/wouldyourather.master.csv`
— one row per spoken sentence — and every consumer reads that file: the recorder
fetches it same-origin, the config generator (`scripts/generate-config-from-sheet.mjs`)
reads it from disk, and the Modal render fetches it over HTTP. There is no remote
sheet anywhere in the loop.

`docs/video-pipeline/sample-sheet.csv` is a small authoring-shape example (kept as a
test fixture). Regenerate it with `node scripts/write-sample-sheet.mjs` (it writes
correct RFC-4180 quoting for the multi-line `srt`/`cue_alt` cells).

## Columns

**Required** (a course missing any of these is skipped whole, with the missing
columns reported):

| Column | Meaning |
|---|---|
| `course_id` | Course slug (becomes `src/config/<course_id>.json`). One CSV may hold several. |
| `course_name` | Display name. Constant per course. |
| `lesson_id` | Lesson slug. Constant within a lesson's rows. |
| `lesson_title` | Lesson title. Constant within a lesson. |
| `response_type` | One of `lessonIntro`, `viewAndContinue`, `friendClosedResponse`, `closedResponse`, `openResponse`, `branching`, `success`. |
| `video_file` | The rendered video's slug (the config's `simpleVideoUrl`; `introBackgroundVideoUrl` for `lessonIntro`). **One `video_file` = one step.** |
| `order` | Integer; step order within the lesson. |

**Optional** (blank is fine; defaults apply):

| Column | Meaning |
|---|---|
| `unit` | Lesson unit label. |
| `mission` | Lesson mission sentence. |
| `cue` | The prompt shown for a response step (single). |
| `cue_alt` | Alternatives, one per line — becomes a `cue` array (mutually exclusive with `cue`). |
| `next_step` | Integer ≥ 1. A step-level advance override (an offset from the step's own index) emitted as `step.nextStep`. Optional; applies to any `response_type`. |
| `choose_step_next` | Newline-separated 1-based offsets, one line per choice — emitted as `chooseStep[i].nextStep`. A `branching` step's multiple-choice targets. |
| `choose_step_text` | Newline-separated choice labels, line-paired with `choose_step_next` — emitted as `chooseStep[i].text`. |
| `subtitle_text` | Static subtitle text (used only if `srt` is blank). |
| `srt` | Exact SRT cues. Written by the render pipeline's `srt` column; can be pasted here. The translator fills `srt_<lang>` with cue-text-only translations (timings preserved). |
| `recap_sources` | `system` / `friend` / `none` (lesson-level; default `none`). |
| `recap_overlay` | `fluency` / `shareCta` / `none` (lesson-level; default `shareCta`). |
| `publish_lesson_id` | Step-level. The ask-lesson id a "responders become challengers" step's recording publishes under (emitted as `step.publishLessonId`). |

**Rules that are easy to trip on:**
- A lesson's `unit`, `mission`, `recap_sources`, `recap_overlay` must be identical on
  every one of its rows (they are lesson-level).
- A `video_file`'s rows must share one `response_type` (a `video_file` is one step).
- Any step whose key is a `{friendCode}` reference must live in a lesson with
  `recap_sources=friend`.
- **`choose_step_next` and `choose_step_text` must both be set** (or neither) and carry the
  same number of lines; each `choose_step_next` line must be an integer ≥ 1. Malformed choice
  data is a structural error: the offending course is **not generated** (the error names the
  `video_file`) while other courses in the CSV still generate. The `choose_step_*` columns
  are only valid on a `branching` step.
- **`next_step` must be an integer ≥ 1** when set. A `branching` step with no `choose_step_*`
  still generates (the app falls back to a Continue button, which honors `next_step`).

## Course intro clips (`intros`)

A course may declare three short, course-level opener clips in its source file
(`sources/<course>.source.txt`). They are ordinary `simpleVideoUrl` slugs, reused
across the whole ABABAB chain — three clips per course, not per lesson:

```json
"intros": {
  "first": "You're asking your friend which cartoon character you most resemble. ...",
  "respond": "Your friend is asking you what cartoon character they resemble. ...",
  "ask": "Now it's your turn to ask your friend the same questions. ..."
}
```

- **All three or none.** A partial block (or a blank/over-long script — 80 words
  max) fails the source regeneration instead of dropping clips silently.
- **Slugs are derived, never authored:** `{course}-intro-first`,
  `{course}-intro-respond`, `{course}-intro-ask`. A re-record replaces the
  object at the same URL.
- The bridge writes one sheet column, `intro_kinds` (`first|respond|ask`), on
  every row; the generator places the slugs:

  | Clip | Where it plays |
  |---|---|
  | `-intro-first` | Lesson A's first ask branch (frames the whole course). |
  | `-intro-respond` | Every answer lesson (B onward), as a `viewAndContinue` step immediately after the lesson intro and before the friend's clip. |
  | `-intro-ask` | Every later lesson's first ask-phase branch ("now it's your turn"). The closing lesson has no ask phase, so it never plays this clip. |

- **Record, upload, then merge.** The clips are not sheet rows: record each one,
  upload it to R2 (`npx wrangler r2 object put
  uff/assets/videos/<slug>.mp4 --file <path> --content-type video/mp4`), and let
  `captions.yml` fill the six-language subtitles from the audio on the push that
  adds the slugs to the config. Until the upload, those steps have no media.
- `docs/video-pipeline` keeps the media pipeline unchanged: these clips never
  enter a render plan, so they get no poster from the Modal render. Run
  `npm run posters:upload` once the object is on R2 if the step's poster is
  wanted.

## Overlay master → config fields

The **overlay master** (`title_text, Order, phrase, subtitle_text, join, video_file, …`, the
committed CSV the recorder and `video_pipeline.py` read) is the single source of truth for
the app config too. The generator detects that shape by the `phrase` header and maps its columns to
config fields:

| Master column(s) | Config field |
|---|---|
| `join` else `video_file` | the step key → `simpleVideoUrl` (or `introBackgroundVideoUrl` for a synthesized `lessonIntro`) |
| `response_type` | `responseType` |
| `phrase` (ordered by `Order` within the step) | `cue` (an ordered array) |
| `srt` / `srt_<lang>` | `subtitles` (localized) — **system steps only** |
| `subtitle_text` | burnt-in overlay markup — never app `subtitles` |
| `next_step` | `nextStep` |
| `choose_step_next` + `choose_step_text` | `chooseStep` |

**Grouping: a step is the `join` value when non-blank, else the `video_file`.** Every row
sharing that key within a lesson is one step; a non-blank `join` is the joined video and the
published slug, and its rows' `phrase` values become the ordered `cue` array. A row with
neither `join` nor `video_file` defines no step and is ignored.

**A friend UGC clip gets no app `subtitles`.** A step whose key is a `{friendCode}`
reference is a friend's published clip, which already carries its speaker's caption
burned into the video, so the generator emits **no** `subtitles` for it — regardless
of `srt`/`srt_<lang>`/`subtitle_text`. (The runtime classifier is `isUgcSlug` in
`src/modules/video/video-source.js`, which matches the share codes in play; the
generator identifies the sheet-level `{friendCode}` placeholder, so a system step
whose slug merely contains `response` — e.g. `my-response-video` — is unaffected.)

**`row_purpose` (informational).** The seeded master appends a `row_purpose` column that
describes the config output each row produces — `step "<key>"`, then any of
`→ simpleVideoUrl`, `→ joined step "<join>"`, `→ cue`, `→ chooseStep`, `→ nextStep`,
`→ publishLessonId`, `→ lessonIntro "<slug>"`, `→ success "<slug>"`, and finally either
`→ subtitles` or `friend UGC clip — no app subtitles (caption burned in)`. It is derived
(refreshed on every re-seed) and **ignored by the generator and translator** — it is not in
`CONFIG_COLUMNS`, so no generator/translator path reads it.

## Localization columns

The master CSV carries translations alongside the English source. `scripts/translate-master-csv.mjs`
reads the English columns, translates with Gemini (`gemini-3.5-flash-lite`, via the shared
client in `scripts/lib/gemini.js`), and commits the results back into the file's
per-language columns below. The config generator then reads those columns into the
`{en,es,pt,bn,fr,hi}` objects the app localizes from. Run the Action from the Actions UI
("Translate Master CSV" → Run workflow; it takes optional `dry_run` and `languages` inputs).

| English source | New columns (`lang` ∈ `es`, `pt`, `bn`, `fr`, `hi`) | Config output |
|---|---|---|
| `lesson_title` | `lesson_title_es`, `lesson_title_pt`, `lesson_title_bn`, `lesson_title_fr`, `lesson_title_hi` | `lesson.title[lang]` |
| `mission` | `mission_es`, `mission_pt`, `mission_bn`, `mission_fr`, `mission_hi` | `lesson.mission[lang]` |
| `cue` (single) | `cue_es`, `cue_pt`, `cue_bn`, `cue_fr`, `cue_hi` | `step.cue[lang]` |
| `cue_alt` | `cue_alt_es`, `cue_alt_pt`, `cue_alt_bn`, `cue_alt_fr`, `cue_alt_hi` | `step.cue[i][lang]` (one cell per alternative line) |
| `choose_step_text` | `choose_step_text_es`, `choose_step_text_pt`, `choose_step_text_bn`, `choose_step_text_fr`, `choose_step_text_hi` | `step.chooseStep[i].text[lang]` (one cell per choice line) |
| `subtitle_text` | `subtitle_text_es`, `subtitle_text_pt`, `subtitle_text_bn`, `subtitle_text_fr`, `subtitle_text_hi` | `step.subtitles[lang]` (only when `srt` is blank) |
| `srt` | `srt_es`, `srt_pt`, `srt_bn`, `srt_fr`, `srt_hi` | `step.subtitles[lang]` (localized video captions) |

That is 35 columns (7 fields × 5 languages). `srt` **is** translated, but only the cue
text: the translator uses `translateSrt`, which preserves cue numbers and timestamps
exactly, and refuses to write a translation whose cue count or timings drifted. SRT
timings stay the caption pipeline's job — the translator never retimes. A step with
`srt` and blank `srt_<lang>` columns keeps `subtitles = {en: <srt>}` (English-only).

**Rules:**

- **Translation fills blanks only.** A cell that already has a translation is left alone, so
  editing a translation cell by hand is respected — the next config generation uses your
  text. To force a machine retranslation, clear the cell and run the Action again (or run
  the CLI with `--force`, which the Action never passes).
- **`cue_alt` pairs lines by index.** Write the same number of newline-separated lines in
  `cue_alt_<lang>` as in `cue_alt`; line *i* translates English line *i*. A shorter or blank
  language list simply omits that language for the extra English lines (which stay
  English-only).
- **`choose_step_text` pairs lines by index too.** `choose_step_text_<lang>` carries one line
  per English choice line (the same count as `choose_step_next`); line *i* translates choice
  *i*. The translator refuses a translation that changes the line count, so a choice is never
  silently dropped.
- **`cue` and `cue_alt` are mutually exclusive**, and each language column pairs only with
  its own shape (`cue_es` with `cue`, `cue_alt_es` with `cue_alt`). The generator ignores a
  stray language column on the wrong shape.
- **`srt` translations preserve cue numbers and timestamps.** The translator sends the
  unescaped English SRT to `translateSrt` and validates the result with `validateTranslatedSrt`
  (cue count + start/end within 1 ms); a drift aborts the run before any cell is written.
  The generator applies the same check when it reads `srt_<lang>`: a non-blank value whose
  timings do not match the English `srt` is a structural error that **skips the whole course**
  (every step and language in it, reported as a skip) rather than shipping a mistimed caption
  — so a stale translation can never reach the app even if configs are generated without the
  translate step first. Run the translator (or clear the bad cell) to recover.
  On the overlay master the SRT is one document per step (written to every row of a `join`),
  so the translator plans it once per step and the generator reads it once — never
  concatenating sub-group SRTs. Note the escaping asymmetry: the pipeline writes the English
  `srt` cell JSON-escaped (literal `\n`), while `srt_<lang>` holds literal multi-line SRT
  (real newlines) — the form the app reads and the generator emits verbatim.
- **A re-render re-translates `srt_<lang>` automatically.** The render pipeline rewrites the
  English `srt` column on every render, so the translator treats a stored `srt_<lang>` as
  stale — and re-plans it — whenever its cue count or timings no longer match the current
  English SRT. A re-timed step therefore never keeps an out-of-date translation (each
  re-timed step costs one Gemini call per language (retried with backoff on free-tier throttling). (A text-only English change with
  *unchanged* timings is not detectable this way; clear the `srt_<lang>` cell or run the CLI
  with `--force` to retranslate.)
- **The English source is never overwritten** and a CSV with none of these columns
  generates English-only output exactly as before.

**One-time setup (operator):** the Action commits with the repo's push-capable bot
token and translates with Gemini — a `GOOGLE_API_KEY` secret holds the key.

1. Store a fine-grained PAT with **Contents: read and write** as the Actions
   secret **`GH_NEW_TOKEN`** (the same bot token `configs.yml` uses).
2. Store the Gemini key as **`GOOGLE_API_KEY`** (AI Studio free tier suffices).

## One-click pipeline (automatic)

Once the render finishes, the file steps run automatically — the operator only
records takes and presses **render**:

**record → render (Modal) → SRT write-back → translate → config generation**

- **The render reads the committed master CSV directly.** The Modal orchestrator
  fetches the file over HTTP into its work dir, so there is
  **no manual `video_data.csv` upload** before a render — the committed CSV is the
  render's input. `pipeline-assets/video_data.csv` is only a **post-render output**
  (the render writes the computed `srt` column into it and uploads it back for
  `sync-srt.yml` to read). The render reads the committed revision straight from
  `raw.githubusercontent.com`, so a bot commit is live for the next render with
  no publish delay. Point the render at another CSV with `PIPELINE_SHEET_URL`
  (default: the committed master).
- **Modal dispatches `render-complete`.** After a successful publish the
  orchestrator POSTs a GitHub `repository_dispatch` (`event_type:
  render-complete`). It is **best-effort**: if the secret's `GH_DISPATCH_REPO` /
  `GH_DISPATCH_TOKEN` **values** are unset the dispatch is skipped with a warning,
  and a failed dispatch is recorded in the job's `done` status (`dispatch:
  "sent" | "failed: …" | "skipped"`) — it never fails the render (the videos are
  already published). Only the values are optional; the `uff-github` secret itself
  must exist (see below).
- **One Modal secret, `uff-github` — a deploy prerequisite.** The orchestrator is
  declared with `secrets=[uff-r2, uff-github]`, and `modal.Secret.from_name`
  raises at invocation when the secret does not exist, so create it **before** the
  orchestrator runs. Add `GH_DISPATCH_REPO` (`joelipi/uffenglish`) and
  `GH_DISPATCH_TOKEN` (a fine-grained PAT with **Contents: read and write**, which
  `repository_dispatch` requires) as its keys; the secret must exist even when
  those keys are unset (the dispatch is then simply skipped). Redeploy once
  (`modal deploy docs/video-pipeline/modal_app.py`) to attach it; secret values
  are read at call time, so rotating the token needs no redeploy.
- **`.github/workflows/pipeline.yml`** owns the `render-complete` trigger (and a
  manual `workflow_dispatch`) and chains the three actions as reusable
  workflows — `srt` → `translate` → `configs`, ordered by `needs:` — so a single
  event runs the whole chain. Each action stays independently runnable from the
  Actions UI. `configs.yml` runs the generator with `--require-videos`, so a
  course whose steps still lack published videos is skipped whole (reported,
  non-fatal) instead of shipping a videoless config — the config for a course
  is created only once all of its videos are up.
- **No publish lag in the post-render chain.** Every job checks out the repo
  fresh after the preceding job's push, so it sees the `srt` and translation
  cells the earlier jobs just committed. The one freshness caveat left is the
  recorder's copy: Pages serves the last deployed `dist/`, so a bot commit is
  visible in `/recorder` only after `deploy.yml` finishes (**manual** reads of
  the raw file or the render never wait).

## Editing the script on the GitHub web UI (push-the-button authoring)

The friend-course script lives at `sources/wouldyourather.source.txt` (in the
`sources/` directory, on `main`). Edit it directly on the GitHub website — no local checkout, no
commands. Saving the edit pushes to `main`, and
`.github/workflows/source-to-csv.yml` validates the source (JSON + structure)
and regenerates the committed `public/wouldyourather.master.csv` (translations
carried over where their English source is byte-identical). A bad edit fails
the run red with the reason; nothing is written. Then record takes and press
render as usual — the one-click chain (SRT → translate → configs) is unchanged.
The push trigger is `main`-only (an unreviewed branch never rewrites the shared
file).

## Retired: remote sheets (history)

Up to story 064 the master lived in a published remote sheet: the recorder,
generator, and render all fetched its CSV over HTTP (with a minutes-long
publish lag), and the translator + SRT write-back wrote cells back through an
API. Story 065 replaced it with the committed `public/wouldyourather.master.csv`
— same columns, same consumers, no remote store, no extra secrets. Nothing in
this guide refers to the old sheet anymore; `stories/` keeps the record.
