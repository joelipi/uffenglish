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
python -m pip install -r requirements.txt   # moviepy, html2image, pandas, opencv-python, pydub, modal
ffmpeg -version                             # ffmpeg + ffprobe must be on PATH

python video_pipeline.py                 # full pipeline
python video_pipeline.py --skip-background
python video_pipeline.py --render-only   # Stage 3 only (outputs already exist)
```

On Windows, double-click **`run.bat`**: it installs the requirements, verifies
them, then runs the pipeline.

`opencv-python` (`cv2`) is required — the zoom effect uses it. If you hit
`ModuleNotFoundError: No module named 'cv2'`:

```bash
python -m pip install opencv-python
```

Inputs: `video_data.csv` (filename, background, mirror, title_text,
subtitle_text, footer_text, effect, dutch_tilt, bgSound, bgMusic, overlay,
foreground, endSoundEffect), `rawvideos/`, `backgrounds/`, `audio/`,
`overlays/`, `fonts/`. A sample CSV is created on first run if none exists.

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

## Note

Written from the two scripts you provided. This environment has no
`moviepy`/`cv2`/`html2image`, so it is **syntax-checked but not run**. Test on a
short clip first; if anything throws, send the error.
