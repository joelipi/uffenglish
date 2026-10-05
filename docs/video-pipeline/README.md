# Video pipeline — single script, social + web outputs

`video_pipeline.py` is one script that runs the whole pipeline and writes **two
versions of every final video, in separate folders with the same filename**:

```
output/social/<name>.mp4   # very high quality, for social upload
output/web/<name>.mp4      # web-optimized, for the app / web
```

```
rawvideos/
    │  Stage 1: mirror (optional) + CFR + silence removal
    ▼
no_silence/
    │  Stage 2: background removal (Modal / BiRefNet)
    ▼
no_silence_bg_removed/
    │  Stage 3: overlays, effects, audio, concatenation
    ▼
output/social/  +  output/web/
```

The social file is rendered once by MoviePy; the web file is derived from it
with a single ffmpeg transcode — the composited clip is never rendered twice.

## Encoding profiles

| | social | web |
|---|---|---|
| resolution | native (e.g. 1080×1920) | long edge ≤ 1280 (→ 720×1280) |
| codec | H.264 **high** profile | H.264 **main** profile, yuv420p |
| rate control | CRF **18** | CRF **26**, `-maxrate 1.5M -bufsize 3M` |
| audio | AAC **256 kbps** | AAC **128 kbps** |
| faststart | **yes** | **yes** |
| approx. size (38 s) | master | ~5 MB instead of ~37 MB |

`-movflags +faststart` puts the `moov` atom first so playback starts without
reading the whole file — the fix for the web stall.

Stage 1/2 intermediates use CRF 16 + faststart + `yuv420p` so the social master
stays near-lossless.

## Install & run

```bash
python -m pip install "moviepy>=2,<3" html2image pandas opencv-python pydub modal
ffmpeg -version                             # ffmpeg + ffprobe must be on PATH

python video_pipeline.py                 # full pipeline
python video_pipeline.py --skip-background
python video_pipeline.py --render-only   # Stage 3 only (outputs already exist)
```

On Windows, double-click **`run.bat`**: it installs those packages, verifies them,
then runs the pipeline.

`opencv-python` (`cv2`) is required — the zoom effect uses it. If you hit
`ModuleNotFoundError: No module named 'cv2'`:

```bash
python -m pip install opencv-python
```

Inputs: `video_data.csv` (filename, phrase, background, mirror, join, title_text,
subtitle_text, footer_text, effect, dutch_tilt, bgSound, bgMusic, overlay,
foreground, endSoundEffect, srt), `rawvideos/`, `backgrounds/`, `audio/`,
`overlays/`, `fonts/`. A sample CSV is created on first run if none exists.

### Joining finished videos (`join` column)

Groups are formed by the text before the first digit in `filename` (e.g.
`lesson_01`, `lesson_02` → group `lesson` → `lesson_full_…`). To splice several
of those finished `_full` videos into one longer video:

- Put the **same value** in the `join` column on the rows of each group you want
  joined. The output is named after that value.
- Order is **CSV row order** (first-seen group order); any number of parts.
- Result (both profiles, same as everything else):
  `output/social/<joinValue>.mp4` + `output/web/<joinValue>.mp4`
- The per-part `_full` videos are **kept**.
- Music is **not** baked into parts that participate in a join; instead the
  join's `bgMusic` (first non-empty among its rows) is applied once over the
  whole joined video.
- All parts must share resolution/fps/codec (they do when produced by this
  pipeline). Parts are stream-copied together (lossless, fast), with an
  automatic re-encode fallback.

Example:

```csv
filename,join,bgMusic,subtitle_text
lesson_01,lessonFinal,musicA,"<aside>…part 1…</aside>"
lesson_02,lessonFinal,,<aside>…part 1…</aside>
other_01,lessonFinal,,<aside>…part 2…</aside>
other_02,lessonFinal,,<aside>…part 2…</aside>
```
→ `lesson_full_…` + `other_full_…` are rendered, then joined into
`lessonFinal.mp4`. Rows with no `join` value behave exactly as before.

**Overlay markup in `subtitle_text`:**
- `<mark>…</mark>` — existing marker style (handwriting font, floats at 35%).
- `<aside>…</aside>` — the translucent callout box (sans font, left-anchored,
  rounded, padded). A separate tag so `mark` keeps its own styling.
- `<strong>…</strong>` — yellow highlighter (dark text on `#ffe600`), usable
  inside the box or the subtitle.

### Subtitles (`phrase` → `srt` column)

Each CSV row can carry a `phrase`. After the per-group concatenation, the script
writes an SRT for each concatenated `_full` video into the **`srt` column**, in
the same format the app configs use (`model.json` style: `1\n00:00:00,000 -->
00:00:03,500\ntext\n\n2\n…`, JSON-escaped so it can be pasted straight into
`"subtitles": "…"`).

- Timing is derived from each segment's **actual post-processing duration**
  (multi-clip groups trim 0.15 s per clip; a single-clip group is untrimmed), in
  concatenation order, starting at `00:00:00,000`.
- An empty `phrase` row leaves a **gap** (no cue) but the clock still advances.
- English only, one SRT per concatenated video; the value is written on every
  row of that group.
- Not generated for the second-level `join` outputs, and no `.srt` files.

Outputs:
- `output/social/processed_<name>.mp4` + `output/web/processed_<name>.mp4`
- `output/social/<prefix>_full_no_silence_bg_removed.mp4` + the web twin

Tune both profiles at the top of the file (`SOCIAL_CRF`, `WEB_TARGET_LONG_EDGE`,
`WEB_CRF`, `WEB_MAXRATE`) — that's the single place to change them.

## What changed vs. the two original scripts

Combined `silenceremover.py` (Stages 1–2) and `video_processor.py` (Stage 3)
into one file, and inlined the previously separate encode-profile helper.

- **8 Mbps → CRF-capped.** The two `write_videofile(..., bitrate='8000k')`
  calls are replaced by the social (CRF 18) and web (CRF 26 / 1.5 Mbps) writers.
- **faststart everywhere**, including the background-music mix step
  (`ffmpeg -c:v copy` previously dropped it, so a faststart input came back
  moov-at-end).
- **Dual output** in `output/social` and `output/web`, same filenames.
- **Perf:** zoom frames resize via `cv2.resize` instead of PIL/LANCZOS (RGB in,
  RGB out — colours unchanged).
- **Stages share one CSV load**, and the sample CSV now includes the
  `background` / `mirror` columns Stage 2 needs.
- Added `--skip-silence`, `--skip-background`, `--skip-render`, `--render-only`,
  `--workers`.

## Cloud pipeline (Modal + R2 + Cloudflare Pages Functions)

The same pipeline also runs in the cloud so the phone can upload takes straight
to R2 and a Modal app does the render (story 040). Cloudflare is storage +
trigger only (Workers cannot run moviepy/ffmpeg/Chromium); the runner is Modal.

- **Prefixes.** Raw phone takes live at `raw/<slug>.mp4`, stage-level status
  markers at `raw/status/<jobId>.json`, operator inputs under
  `pipeline-assets/<subdir>/…` plus `pipeline-assets/video_data.csv`. Published
  media keeps the app's existing `assets/videos/<slug>.mp4` + `assets/videos/<slug>.jpg`.
  `raw/` and `pipeline-assets/` deliberately avoid the 48h `videos/` lifecycle;
  clean them up manually (retention is not automated here).
- **Raw-take visibility.** `raw/<slug>.mp4` is in the public `uff` bucket under a
  deterministic key with no expiry, so an unpublished/rejected take is
  world-readable by anyone who knows the slug — the operator key gates the write,
  not the read. Keep that in mind before uploading an unreleased lesson; move
  `raw/` to a private bucket/prefix (or add an R2 lifecycle rule) if it matters.
- **Secret.** `modal secret create uff-r2` with `R2_ACCOUNT_ID`,
  `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (`uff`). It is
  attached to the orchestrator only.
- **Deploy.** `modal deploy docs/video-pipeline/modal_app.py` ships both the CPU
  orchestrator and the existing T4 BiRefNet function (they share one app). Run it
  from the repo root — the image adds `docs/video-pipeline` as a local dir.
- **Upload assets.** `npm run pipeline:upload-assets:dry` previews, then
  `npm run pipeline:upload-assets` pushes each file to `pipeline-assets/` with
  `wrangler r2 object put`. Content changes need no `modal deploy`.
- **Recorder operator key.** `public/recorder.html` (served at `/recorder`) has a
  password input; the key is stored in `sessionStorage` and sent as
  `x-operator-key` to the same-origin Pages Functions (`/api/pipeline/upload-raw`,
  `/api/pipeline/render`, `/api/pipeline/status`). The key is never in the static
  HTML. This is a stopgap — Cloudflare Access is the documented next step.

The web profile also honours `PIPELINE_WORKDIR` (container work dir),
`PIPELINE_WEB_TARGET_LONG_EDGE` / `PIPELINE_WEB_AUDIO_BITRATE` (cloud web
target) and `PIPELINE_CHROME_NO_SANDBOX` (root Chromium). Unset, the local
Windows flow behaves exactly as before.

## Note

Written from the two scripts you provided. This environment has no
`moviepy`/`cv2`/`html2image`, so it is **syntax-checked but not run**. Test on a
short clip first; if anything throws, send the error.
