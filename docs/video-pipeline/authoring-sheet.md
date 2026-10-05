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
| `response_type` | One of `lessonIntro`, `viewAndContinue`, `friendClosedResponse`, `closedResponse`, `openResponse`, `success`. |
| `video_file` | The rendered video's slug (the config's `simpleVideoUrl`; `introBackgroundVideoUrl` for `lessonIntro`). **One `video_file` = one step.** |
| `order` | Integer; step order within the lesson. |

**Optional** (blank is fine; defaults apply):

| Column | Meaning |
|---|---|
| `unit` | Lesson unit label. |
| `mission` | Lesson mission sentence. |
| `cue` | The prompt shown for a response step (single). |
| `cue_alt` | Alternatives, one per line — becomes a `cue` array (mutually exclusive with `cue`). |
| `subtitle_text` | Static subtitle text (used only if `srt` is blank). |
| `srt` | Exact SRT cues. Written by the render pipeline's `srt` column; can be pasted here. |
| `recap_sources` | `system` / `friend` / `none` (lesson-level; default `none`). |
| `recap_overlay` | `fluency` / `shareCta` / `none` (lesson-level; default `shareCta`). |

**Rules that are easy to trip on:**
- A lesson's `unit`, `mission`, `recap_sources`, `recap_overlay` must be identical on
  every one of its rows (they are lesson-level).
- A `video_file`'s rows must share one `response_type` (a `video_file` is one step).
- Any step whose slug ends in `-response-NN` must live in a lesson with
  `recap_sources=friend`.

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
