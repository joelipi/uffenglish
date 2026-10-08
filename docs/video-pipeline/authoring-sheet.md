# Authoring sheet — sample and alternatives

The config generator (`scripts/generate-config-from-sheet.mjs`) reads a **published
CSV** with one row per spoken sentence. `docs/video-pipeline/sample-sheet.csv` is a
working example; import it into Google Sheets (File → Import → Upload) and edit it,
or use any of the alternatives below.

Regenerate the sample with `node scripts/write-sample-sheet.mjs` (it writes correct
RFC-4180 quoting for the multi-line `srt`/`cue_alt` cells).

## Columns

**Required** (a course missing any of these is skipped whole, with the missing
columns reported):

| Column | Meaning |
|---|---|
| `course_id` | Course slug (becomes `src/config/<course_id>.json`). One sheet may hold several. |
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

**Rules that are easy to trip on:**
- A lesson's `unit`, `mission`, `recap_sources`, `recap_overlay` must be identical on
  every one of its rows (they are lesson-level).
- A `video_file`'s rows must share one `response_type` (a `video_file` is one step).
- Any step whose slug ends in `-response-NN` must live in a lesson with
  `recap_sources=friend`.
- **`choose_step_next` and `choose_step_text` must both be set** (or neither) and carry the
  same number of lines; each `choose_step_next` line must be an integer ≥ 1. Malformed choice
  data is a structural error: the offending course is **not generated** (the error names the
  `video_file`) while other courses in the sheet still generate. The `choose_step_*` columns
  are only valid on a `branching` step.
- **`next_step` must be an integer ≥ 1** when set. A `branching` step with no `choose_step_*`
  still generates (the app falls back to a Continue button, which honors `next_step`).

## Localization columns

The sheet can carry translations alongside the English source. `scripts/translate-sheet.mjs`
reads the English columns, translates with DeepSeek (`deepseek-v4-flash`, via the shared
client in `scripts/lib/deepseek.js`), and writes the results back into the per-language
columns below. The config generator then reads those columns into the `{en,es,pt,bn}`
objects the app localizes from. Run the Action from the Actions UI ("Translate Authoring
Sheet" → Run workflow; it takes optional `dry_run` and `languages` inputs).

| English source | New columns (`lang` ∈ `es`, `pt`, `bn`) | Config output |
|---|---|---|
| `lesson_title` | `lesson_title_es`, `lesson_title_pt`, `lesson_title_bn` | `lesson.title[lang]` |
| `mission` | `mission_es`, `mission_pt`, `mission_bn` | `lesson.mission[lang]` |
| `cue` (single) | `cue_es`, `cue_pt`, `cue_bn` | `step.cue[lang]` |
| `cue_alt` | `cue_alt_es`, `cue_alt_pt`, `cue_alt_bn` | `step.cue[i][lang]` (one cell per alternative line) |
| `choose_step_text` | `choose_step_text_es`, `choose_step_text_pt`, `choose_step_text_bn` | `step.chooseStep[i].text[lang]` (one cell per choice line) |
| `subtitle_text` | `subtitle_text_es`, `subtitle_text_pt`, `subtitle_text_bn` | `step.subtitles[lang]` (only when `srt` is blank) |
| `srt` | `srt_es`, `srt_pt`, `srt_bn` | `step.subtitles[lang]` (localized video captions) |

That is 21 columns (7 fields × 3 languages). `srt` **is** translated, but only the cue
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
  English SRT. A re-timed step therefore never keeps an out-of-date translation. (A
  text-only English change with *unchanged* timings is not detectable this way; clear the
  `srt_<lang>` cell or run the CLI with `--force` to retranslate.)
- **The English source is never overwritten** and a sheet with none of these columns
  generates English-only output exactly as before.

**One-time setup (operator):** the Action writes with a Google **service account**.

1. Create a Cloud service account and download its JSON key.
2. Store the raw JSON as the Actions secret **`GOOGLE_SERVICE_ACCOUNT_JSON`** (raw JSON, not
   base64 — it is parsed in memory and never written to disk).
3. Open the sheet → **Share** → paste the service-account email
   (`<name>@<project>.iam.gserviceaccount.com`) → grant **Editor**; do not enable "Notify
   people".
4. Store the spreadsheet id (`docs.google.com/spreadsheets/d/<ID>/edit`) as the repo
   **variable** **`GOOGLE_SHEET_ID`** (a secret of the same name also works). The existing
   **`DEEPSEEK_API_KEY`** secret is reused for the translations.

The scope requested is exactly `https://www.googleapis.com/auth/spreadsheets`. The published
CSV read path is separate and unaffected.

## One-click pipeline (automatic)

Once the render finishes, the sheet steps run automatically — the operator only
records takes and presses **render**:

**record → render (Modal) → SRT write-back → translate → config generation**

- **The render reads the published sheet directly.** The Modal orchestrator
  fetches the sheet's published CSV over HTTP into its work dir, so there is
  **no manual `video_data.csv` upload** before a render — the sheet is the
  render's input. `pipeline-assets/video_data.csv` is only a **post-render output**
  (the render writes the computed `srt` column into it and uploads it back for
  `sync-srt.yml` to read). The published CSV lags a sheet edit by
  minutes; the render runs after the operator records takes, so that is fine.
  Point the render at another published CSV with `PIPELINE_SHEET_URL` (default:
  the recorder's published master).
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
  Actions UI.
- **No published-CSV lag in the post-render chain.** `configs.yml` runs the
  generator with `--from-api`, reading the sheet through the Sheets API so it
  sees the `srt` and `phrase_*` cells the preceding jobs just wrote. The
  published CSV still lags a Sheets API write by minutes; that affects the
  render's sheet input and **manual** reads (the recorder, and the local
  `npm run configs:generate` default), but the post-render chain is lag-free.

## Not using Google Sheets

The generator only needs a **URL that returns CSV**. Anything that serves a
published CSV works; Google Sheets is just the default. Options:

| Option | How | Notes |
|---|---|---|
| **Google Sheets** | File → Share → Publish to web → CSV | The default; the URL is pinned in `public/recorder.html` and the CLI. |
| **GitHub repo file** | Commit the CSV (e.g. `docs/video-pipeline/sheet.csv`) and point at its `raw.githubusercontent.com` URL | Versioned with the code — a natural fit here. Works for the Action. |
| **Cloudflare R2** | Put the CSV in the pipeline-assets bucket; point at its public URL | Already part of this stack. |
| **Any static host** | Netlify/Vercel/GitHub Pages/etc. serving a `.csv` | Anything with a stable public URL. |
| **A CMS / Airtable / Notion** | Use an export/CSV URL | Works if it emits real CSV. |

To switch, pass `--sheet-url=<url>` to the CLI, and change the `SHEET_URL`
constant (`scripts/generate-config-from-sheet.mjs`) and the recorder's
`spreadsheet_url` (`public/recorder.html`) for the default. Both are source-guarded
to match, so update them together.

**Why not "just a file on the server":** this sandbox is ephemeral, so nothing
lives here. Store the source of truth where it persists — a git-tracked CSV in this
repo, R2, or a hosted sheet — and the generator reads it over HTTP.
