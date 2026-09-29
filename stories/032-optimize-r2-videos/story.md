# Web-optimize lesson videos on R2 (faststart + bitrate budget)

## Context

Story 031 removed the client-side contention that starved the first lesson
video, but the underlying R2 asset is still defective: `assets/videos/testvideointro.mp4`
is 39,327,996 bytes (37.5 MB), H.264 1080×1920, 38.14 s, ~8.25 Mbps, and its
`moov` atom sits **after** a 39,285,362-byte `mdat` (not `+faststart`). A
non-faststart mp4 forces the browser to read the tail before playback, and an
8 Mbps talking-head clip buffers on mobile links. These are content problems
the client cannot fix.

The repo already owns R2-processing pipelines: `scripts/generate-thumbnails.mjs`
(downloads each intro mp4 from R2, runs ffmpeg, uploads the sibling poster via
`wrangler r2 object put`) and `scripts/fix-video-sync.mjs` (a manual ffmpeg
remediation CLI for authored mp4s). This story adds the missing one: a manual,
repeatable CLI that remuxes every referenced lesson video to `+faststart` and,
only when it exceeds a bitrate/resolution budget, re-encodes it — then uploads
the result back over the slug. Running it is what actually shrinks the bytes;
it is deliberately **not** wired into CI (re-encoding every push is expensive
and destructive).

## Out of Scope

- No automatic CI/deploy wiring. `deploy.yml`, `captions.yml` and the poster
  pipeline are untouched; the operator runs the CLI.
- No live R2 writes by the implementer: uploads happen when the operator runs
  `--upload` with Cloudflare creds.
- No change to the client (031 is complete) or to any `src/config/*.json`.
- No deletion of old R2 objects; the optimized file overwrites the slug.
- No UGC/friend clips (`{friendCode}…-response-NN`) — they are runtime-resolved
  and already transcoded by the browser before upload.
- No new npm dependencies. No `scripts/verify-videos.mjs` gate.

## Implementation approach

Follow the poster pipeline split: all decisions in a pure
`scripts/lib/video-optimize-utils.js` (unit-testable with fakes), all
process/network work in `scripts/optimize-videos.mjs`.

### Constants

```js
export const MAX_VIDEO_WIDTH = 720;            // long-edge cap for lesson clips
export const MAX_TOTAL_BITRATE_BPS = 1_500_000; // ~1.5 Mbps muxed budget
export const X264_CRF = 26;
export const X264_PRESET = 'medium';
export const VIDEO_MAXRATE = '1.5M';
export const VIDEO_BUFSIZE = '3M';
export const AUDIO_BITRATE = '96k';
export const FASTSTART_HEAD_BYTES = 2 * 1024 * 1024; // bounded head read
```

### Target collection (pure)

`collectVideoTargets(configs)` → deduped `{ slug }[]` in first-seen order. For
every lesson in every config, iterate `lesson.steps` and take
`step.interactiveVideoUrl || step.simpleVideoUrl || step.introBackgroundVideoUrl`
(the same loader precedence as 031). Skip falsy slugs and any slug containing
`{friendCode}` (runtime-resolved, not a literal R2 filename — same rule as
`introTargets`/`findNewSimpleVideoTargets`). `questions`-shaped lists are
ignored, matching the poster and loader paths.

### Faststart detection (pure)

Top-level MP4 box scan over a bounded head buffer:

```js
export function scanTopLevelBoxes(buffer) // -> [{ type, size, offset }]
export function isFaststart(buffer)      // -> true | false | null
```

Box header rules: 4-byte big-endian size + 4-byte type; `size === 1` reads the
8-byte largesize that follows; `size === 0` means the box runs to EOF (stop);
`size < 8` or a non-printable type stops the scan. `isFaststart` returns `true`
when a `moov` box is seen before `mdat`, `false` when `mdat` is seen before any
`moov`, and `null` when the buffer is too short/invalid to contain either
(inconclusive). A `mdat`-first file is decidable from the head alone, so a
2 MB head read is always enough.

### Planner (pure)

```js
export function planVideoOptimize({ probes, force = false,
    maxWidth = MAX_VIDEO_WIDTH, maxTotalBitrateBps = MAX_TOTAL_BITRATE_BPS } = {})
```

`probes` is `[{ slug, faststart, width, totalBitrateBps }]`. Per probe:

- `width` given and `> maxWidth`, **or** `totalBitrateBps` given and
  `> maxTotalBitrateBps` → `reencode` (scale cap + CRF encode; adds faststart).
- otherwise, `faststart !== true` → `remux` (lossless `-c copy` + faststart).
- otherwise → `skip`.
- `force === true` upgrades a `skip` to `remux`; it never downgrades
  `reencode`.
- Missing `width`/`totalBitrateBps` never triggers `reencode` (never re-encode
  on unknown data); missing/`null` `faststart` is treated as needing `remux`.

Returns `[{ slug, action }]` preserving probe order.

### ffmpeg argv builders (pure)

```js
export function remuxArgs({ src, out })
// ['-y','-loglevel','error','-i',src,'-c','copy','-movflags','+faststart',out]

export function reencodeArgs({ src, out, maxWidth = MAX_VIDEO_WIDTH })
// ['-y','-loglevel','error','-i',src,
//  '-vf', `scale=min(iw\\,${maxWidth}):-2`,
//  '-c:v','libx264','-preset',X264_PRESET,'-crf',String(X264_CRF),
//  '-maxrate',VIDEO_MAXRATE,'-bufsize',VIDEO_BUFSIZE,
//  '-c:a','aac','-b:a',AUDIO_BITRATE,
//  '-movflags','+faststart', out]
```

The comma inside `min(...)` is escaped (`\,`) because `-vf` uses commas to
separate filtergraph steps; `:-2` keeps the height even and preserves aspect.

### Naming / URL helpers (pure)

- `videoFilename(slug)` → `${slug}.mp4`
- `videoR2Key(slug)` → `assets/videos/${slug}.mp4`
- `videoSourceUrl(slug, base = 'https://r2.ultrafastfluency.com/assets/videos/')`

### CLI `scripts/optimize-videos.mjs`

Mirrors `generate-thumbnails.mjs`: `execFile` wrappers for `ffmpeg`/`ffprobe`,
a work dir outside the repo, `--help`, graceful WARN (never fail the process on
a single bad clip).

Flags:

- `--slug=<a,b>` — target only these slugs, skipping config discovery
  (hermetic for tests and for fixing one clip).
- `--video-dir=DIR` — prefer `<DIR>/<slug>.mp4` over downloading from R2.
- `--force` — remux even files already `+faststart`.
- `--dry-run` — probe/plan and print actions, write no ffmpeg output, never
  upload.
- `--upload` — push optimized files with
  `npx wrangler r2 object put uff/assets/videos/<slug>.mp4 --file <out>
  --content-type video/mp4` (same wrangler ≥4 `--remote` handling as
  `uploadAll` in `generate-thumbnails.mjs`).
- `--help` / `-h`.

Env seams (tests + local runs): `VIDEO_CDN_BASE` (default
`https://r2.ultrafastfluency.com/assets/videos/`), `VIDEO_OUT_DIR` (default
`os.tmpdir()/uff-videos`, must be outside the repo root), `VIDEO_CACHE_DIR`
(default `os.tmpdir()/uff-videos-cache`).

Per slug: download (or copy from `--video-dir`) → read `FASTSTART_HEAD_BYTES`
from the local file → `ffprobe` `format.bit_rate` and the video stream `width`
→ `planVideoOptimize` → run remux/re-encode → write to `VIDEO_OUT_DIR` → print
`OPT <slug> <remux|reencode> (<reason>)` / `SKIP <slug> already optimized`
(`SKIP` on `--dry-run` prints the planned action instead). A missing source
(404 / absent local file) is `MISS <slug>` and does not abort the run.

`package.json`:

```json
"videos:optimize": "node scripts/optimize-videos.mjs",
"videos:optimize:upload": "node scripts/optimize-videos.mjs --upload"
```

`README.md` "Lesson videos" section gains a two-line note: to make an oversized
or non-faststart clip web-friendly, run `npm run videos:optimize` (optionally
`--slug=…`) then `npm run videos:optimize:upload` with Cloudflare creds;
replacing the mp4 under the same slug refreshes its poster on the next push.

## Tasks

### Task 1 - Pure utils module

New `scripts/lib/video-optimize-utils.js` with the constants and functions
above.

- `collectVideoTargets` over configs containing an interactive slug, a simple
  slug, and a first-step intro slug, with one repeated slug
  - → returns each distinct slug once, in first-seen order
- config with a `{friendCode}model-w-response-01` slug and a `questions` list
  - → the template slug is skipped; `questions` entries contribute nothing
- `collectVideoTargets(null)` / `collectVideoTargets([])`
  - → `[]`
- `isFaststart` on a hand-built `ftyp + moov + mdat` buffer
  - → `true`
- `isFaststart` on `ftyp + mdat + moov`
  - → `false`
- `isFaststart` on `ftyp + mdat(size=0)`
  - → `false`
- `isFaststart` on `ftyp + mdat(size=1, largesize) + moov`
  - → `false`
- `isFaststart` on an empty buffer and on `ftyp` alone
  - → `null`
- `planVideoOptimize` probe `{slug:'a',faststart:true,width:720,totalBitrateBps:1_000_000}`
  - → `[{slug:'a',action:'skip'}]`
- same but `faststart:false`
  - → `action:'remux'`
- same but `faststart:null`
  - → `action:'remux'`
- probe `{faststart:true,width:1080,totalBitrateBps:1_000_000}`
  - → `action:'reencode'`
- probe `{faststart:true,width:720,totalBitrateBps:9_000_000}`
  - → `action:'reencode'`
- probe `{faststart:true,width:null,totalBitrateBps:null}`
  - → `action:'skip'` (unknown never re-encodes)
- `force:true` on a `skip` probe
  - → `action:'remux'`; `force:true` on an `reencode` probe stays `reencode`
- `remuxArgs` / `reencodeArgs` for a `{src,out}`
  - → `remuxArgs` includes `'-c','copy'` and `'+faststart'`
  - → `reencodeArgs` includes `libx264`, `scale=min(iw\\,720):-2`, `aac`, and `'+faststart'`
- `videoFilename`/`videoR2Key`/`videoSourceUrl`
  - → `<slug>.mp4` / `assets/videos/<slug>.mp4` / `<base><slug>.mp4`

### Task 2 - CLI planning, flags, and help

New `scripts/optimize-videos.mjs` and `scripts/optimize-videos.test.js`.

- `node scripts/optimize-videos.mjs --help`
  - → exit 0, usage lists `--slug`, `--upload`, `--force`, `--dry-run`, `--video-dir`
- `--slug=testvideointro --video-dir=<tmp> --dry-run` where `<tmp>/testvideointro.mp4`
  is a generated non-faststart clip, `VIDEO_CDN_BASE` pointed at an unreachable host
  - → exit 0, stdout contains `OPT testvideointro remux`
  - → no file is written to `VIDEO_OUT_DIR`
- same but the fixture is already `+faststart`
  - → stdout contains `SKIP testvideointro`
- `--slug=missing --video-dir=<tmp>`
  - → stdout contains `MISS missing`, exit 0
- `--slug=a --video-dir=<tmp>` with no `--upload`, `<tmp>/a.mp4` present
  - → ffmpeg output `<VIDEO_OUT_DIR>/a.mp4` exists
  - → no `wrangler` process is spawned (assert via a `PATH` shim or a
    `WRANGLER_BIN` seam recorded by the test)
- source inspected (`scripts/optimize-videos.mjs`)
  - → imports `collectVideoTargets`, `planVideoOptimize`, `remuxArgs`,
    `reencodeArgs`, `isFaststart` from `'./lib/video-optimize-utils.js'`
  - → contains `wrangler r2 object put` and `--upload`
  - → default `VIDEO_OUT_DIR` resolves under `os.tmpdir()` and rejects paths
    inside the repo root
- ffmpeg integration (this case is `describe.skip` when `ffmpeg` is absent,
  following `generate-thumbnails.test.js`): generate a non-faststart fixture with
  `ffmpeg -movflags +faststart` omitted, run the CLI, and read the output head
  - → `isFaststart(output)` is `true`
  - → the output plays at the capped width (≤ `MAX_VIDEO_WIDTH` via `ffprobe`)

### Task 3 - Package scripts, README, product docs

- `package.json` source inspected
  - → contains `"videos:optimize": "node scripts/optimize-videos.mjs"` and
    `"videos:optimize:upload": "node scripts/optimize-videos.mjs --upload"`
- `README.md` source inspected
  - → the "Lesson videos" section mentions `videos:optimize` and
    `videos:optimize:upload`
- `docs/product.md` Features list
  - → contains a link to `stories/032-optimize-r2-videos/story.md`
- `npm test -- --run`
  - → all files pass, including the new ones

## Technical Context

- No new dependencies. Uses Node 20 built-ins (`node:child_process`,
  `node:fs`, `node:os`, `node:path`, `node:http` for the test's fake R2), system
  `ffmpeg`/`ffprobe` (already required by `generate-thumbnails.mjs` and installed
  in CI), and `wrangler` 3.114.17 for `--upload`.
- Config discovery reuses the `loadConfigs` contract from
  `scripts/lib/poster-utils.js` (`read every src/config/*.json`, parse errors
  fatal). `introTargets` is not reused because it only looks at `steps[0]`.
- `ffprobe` JSON shape used: `format.bit_rate` (string bps, may be absent) and
  the video stream's `width`. Missing values become `null` and never trigger
  `reencode`.
- R2 supports `Accept-Ranges: bytes` (verified against `testvideointro.mp4`), so
  the 2 MB head read and `ffprobe` over a URL both work.
- Test gates: vitest 4.1.6 + jsdom 29.1.1 (colocated `*.test.js`; excludes
  `tests/**` and `*.spec.js`). `npm test -- --run`.
- `src/config/wouldrather.json` (post-031) still references `testvideointro` in
  lesson `a` steps 0–1, so it is the natural manual verification target.

## Notes

- Manual runbook once merged (needs Cloudflare creds):
  ```bash
  node scripts/optimize-videos.mjs --slug=testvideointro        # remux/re-encode to /tmp
  node scripts/optimize-videos.mjs --slug=testvideointro --upload
  # or all lesson videos:
  npm run videos:optimize && npm run videos:optimize:upload
  ```
  The next push regenerates the slug's poster (source mp4 newer than
  `assets/videos/testvideointro.jpg`, `stories/025-regenerate-stale-posters`).
- Default action for `testvideointro.mp4` will be `reencode` (width 1080 >
  720 and ~8.25 Mbps > 1.5 Mbps); expect roughly 720×1280 at ~1.5 Mbps, i.e. a
  few MB instead of 37.5 MB. `--slug` scopes a single-clip fix; omitting it
  walks every config-referenced lesson video.
- The script never runs in CI. A re-encode is lossy, so it is intentionally
  operator-invoked and never automatic.
- Upload failures are non-fatal (WARN + count), matching the poster uploader:
  a failed clip keeps the existing R2 object.
- `questions`-shaped intros are ignored on purpose (vestigial in `gt2.json`);
  deleting them is separate cleanup.
