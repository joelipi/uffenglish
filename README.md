# UFF — Ultra Fast Fluency

![UFF Loading](assets/img/u-f-f.png)

## Overview

**UFF (Ultra Fast Fluency)** is a web app for English fluency through speaking and listening. Native-speaker video, voice-first answers, AI evaluation of intent/grammar, and a fluency score (0–100).

## Tech Stack

- **Frontend:** React 19 + React Router 7 + Vite 8 + Zustand (persisted `appStore` in `src/modules/store/store.js`) + TanStack Query + Bootstrap 5
- **Backend:** Supabase (auth + `user_profiles` + `avatars` bucket, `supabase/migrations/`) — anon key is publishable, service role never in client
- **Speech:** Whisper via Transformers.js / WASM workers (`src/workers/whisper/`) + VAD + speech-cam MediaRecorder
- **Storage:** localStorage (lesson progress) + IndexedDB via `idb-keyval` for per-segment recordings (`src/modules/storage/recordingDb.js`) — ArrayBuffer only, never Blob (WebKit object-store bug)
- **Media:** R2 `https://r2.ultrafastfluency.com` for lesson videos/posters (`/assets/videos/`, `/whisper/` proxied in `vite.config.js`), per-segment UGC to `videos/` via `functions/api/upload-segment.js` (JWT-gated). Posters are the video's `.mp4`→`.jpg` sibling (`getPosterUrl`), R2-only — the **Modal render** writes each published video's poster, and posters are never committed or served locally.
- **Analytics:** PostHog — session replay + exception capture (`src/modules/utils/posthog-client.js`), `maskInputOptions: {password,email}` so lesson text answers replay unmasked while credentials stay masked
- **Deploy:** Cloudflare Pages (`dist/`) via `wrangler.toml`; posters are written by the Modal render, so the deploy installs no ffmpeg

## Directory

```
src/
  App.jsx, main.jsx, routes/
  components/        # React views (LessonContainer, HomeScreen, Profile, auth modals)
  modules/
    api/             # supabase.js, api.js, ai.js
    store/           # Zustand store (persisted keys: courseId, friendCode, guestNativeLanguage…)
    storage/         # storage.web.js + recordingDb.js (IndexedDB)
    speech/          # speech.web.js + speech-orchestrator
    bilingual/       # strings + config normalizer
    answer/          # closed/open response evaluation
    video/           # video-loader, video-processor, r2-upload
    utils/           # posthog, utils, swearjar
  workers/whisper/
  config/            # model.json, gt2.json, t.json
  data/              # strings.js, idioms.json
public/
  _headers           # COOP/COEP (SharedArrayBuffer), _redirects (SPA fallback)
functions/api/upload-segment.js   # Pages Function → R2 (requires Supabase JWT)
```

## Prerequisites

- Node 20+ (`setup-node@v4` in CI)
- `ffmpeg` only for a manual poster re-render (`npm run posters:upload`); the deploy no longer installs it
- Cloudflare creds for a manual poster upload / the Pages deploy: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- Supabase project `jbrbmbmupjfangqvaevx` (vars in `.env` + `wrangler.toml [vars]`)

## Setup

```bash
npm ci
cp .env.example .env   # fill VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_PUBLIC_POSTHOG_*
```

Optional for R2 poster upload:

```bash
export CLOUDFLARE_API_TOKEN=…  CLOUDFLARE_ACCOUNT_ID=…
```

## Running

Two processes for local UGC upload (R2):

```bash
# terminal 1 — Vite dev server (port 3000, also proxies /assets/videos/ + /whisper/ → R2)
npm run dev

# terminal 2 — Pages Functions dev server (port 8788, serves /api/upload-segment → R2)
npx wrangler pages dev dist --port 8788
# or: npx wrangler pages dev --port 8788  (when vite.config.js proxies /api → localhost:8788)
```

Open `http://localhost:3000/`. For device testing against real mic/cam over HTTPS, fix the existing Cloudflare tunnel on `t.ultrafastfluency.com` (currently returns HTTP 530 — no origin connected; restart `cloudflared` with the saved tunnel config). `vite.config.js` already allowlists `t.ultrafastfluency.com`.

Deep link with friend code: `http://localhost:3000/?sharecode=abc123` → persisted in `appStore.friendCode`.

Debug console: Eruda is gated — append `?eruda=1` or `localStorage.setItem('eruda','1')` to load it. It is not loaded for real users by default.

Staging: `s.ultrafastfluency.com` (Pages custom domain — add in Cloudflare dashboard, TLS auto). Production deploys on push to `main` and is intended to be served on `ultrafastfluency.com`; to serve `s.` from a non-production `staging` branch and keep the apex for production, see `docs/deploy-environments.md`.

## Build & Deploy

```bash
npm test -- --run          # unit tests (14 files, jsdom) — must be green before push
npm run build              # vite build → dist/ (+ copy src/config + _headers/_redirects)
node scripts/verify-thumbnails.mjs   # poster gate (fails if any R2 poster is missing)
npm run deploy             # build + wrangler pages deploy dist --project-name=uffenglish
```

CI (`deploy.yml` on push to `main`): `npm ci` → `build` → `pages deploy`. Posters come from the Modal render, so the deploy installs no ffmpeg and generates nothing. Production branch is `main`; `s.` binds to the Pages project.

**Auto captions for simple videos:** `scripts/generate-captions.mjs` (run by `.github/workflows/captions.yml` on every push) transcribes newly added `simpleVideoUrl` videos with local Whisper and translates the SRT to es/pt/fr/hi/bn via DeepSeek (`DEEPSEEK_API_KEY` secret), committing the captions back to the pushed branch. See `stories/009-auto-caption-simple-videos/story.md`.

**Infra / operations docs:** `docs/cloudflare-video-cors.md` — Cloudflare Transform-Rule config that makes R2 videos/Whisper work on `s.` (COEP `credentialless` + ACAO/CORP on 206 range responses). If videos fail on `s.` but not localhost, read it first.

**Lesson videos:** real recordings live on Cloudflare R2 at `https://r2.ultrafastfluency.com/assets/videos/<slug>.mp4` (in dev, Vite serves `/assets/videos/<slug>.mp4` through the proxy — `vite.config.js`). Video files are gitignored and never committed (too large). Upload recordings to R2 manually and reference the `<slug>` in `src/config/*.json` (`interactiveVideoUrl`, `simpleVideoUrl`, `introBackgroundVideoUrl`). There is no video generator.

To make an oversized or non-faststart clip web-friendly, run `npm run videos:optimize` (all config-referenced clips, or `-- --slug=<slug>` for one; add `--force` to remux even faststart clips) and then `npm run videos:optimize:upload` with Cloudflare creds. The script remuxes to `+faststart` and re-encodes only clips over a 720px / ~1.5 Mbps budget, overwriting `assets/videos/<slug>.mp4`; replacing the mp4 under the same slug refreshes its poster on the next push ([story](stories/032-optimize-r2-videos/story.md)).

**Generate a course config from the sheet:** the published Google Sheet is the source of truth for both videos and configs. `npm run configs:generate` (or `node scripts/generate-config-from-sheet.mjs`) fetches that CSV, groups rows by the `video_file` column value (the config's `simpleVideoUrl`; `filename` is the per-sentence render source), and writes an English-only `src/config/<courseId>.json` **per course** the sheet defines (partitioned by `course_id`). It **overwrites** an existing config — the sheet is authoritative, so regeneration replaces `src/config/<courseId>.json` unconditionally (there is no `--force` flag; use `--dry-run` to preview). It does not translate (es/pt/bn is a later pass — [story](stories/042-generate-config-from-sheet/story.md)), so do not point the sheet at a hand-authored/localized course you are not migrating — overwriting it with a generated config drops its localizations ([story](stories/047-overwrite-configs/story.md)).

**Auto-generated & committed:** `.github/workflows/configs.yml` runs the generator automatically — press **Actions → "Generate Course Configs" → Run workflow** (no local commands) and the bot commits any changed `src/config/*.json` (+ the allow-list) back to the branch; its own commits carry `[skip configs]` and are skipped by the workflow guard. It is **best-effort**: a course with any **missing required column** (`course_id`, `course_name`, `lesson_id`, `lesson_title`, `response_type`, `video_file`, `order`, in `REQUIRED_COLUMNS`) is **skipped whole** — no partial config — and reported on the run page (`::error` + job summary) listing exactly which columns were missing; the other courses still generate, and the video render is unaffected. To add a new required field, add the column to the sheet **and** to `REQUIRED_COLUMNS` in `scripts/lib/sheet-config-utils.js`. The workflow also accepts a `repository_dispatch` (`render-complete`) event for a later, hands-off trigger ([story](stories/046-auto-generate-configs/story.md)).

**Lesson posters:** one uniform rule — a poster is a still of its video, so its URL is the video's URL with `.mp4`→`.jpg` (`getPosterUrl(slug)`; `src/modules/video/video-url.js`). The **Modal render** writes every `src/config/*.json` course's lesson-intro poster to R2 as `assets/videos/<slug>.jpg` as it publishes the video (`modal_app._publish`), so no CI step generates one. `scripts/generate-thumbnails.mjs` stays for a manual re-render (`npm run posters:upload`) after replacing a video out of band: it (re)generates a poster when it is missing **or when its source `.mp4` is newer than the published `.jpg`** (R2 `Last-Modified`) ([story](stories/025-regenerate-stale-posters/story.md)). UGC friend clips upload their sibling `.jpg` at publish time via `functions/api/upload-segment.js`. No poster is committed to the repo or served locally — the browser always fetches the poster from R2 (in dev through the existing `/assets/videos/` proxy). The committed `src/generated/poster-lqips.js` blur module is legacy: nothing regenerates it, and the incoming-video overlay falls back to a gradient for slugs it lacks.

R2 lifecycle (48h TTL for `videos/` UGC) is set in the Cloudflare dashboard (`R2 → uff → Lifecycle`), not in `wrangler.toml`.

## Testing Media & Speech

For Playwright mic/camera tests:

```js
['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
// and grant ['microphone'] in the browser context
```

`playwright.config.js` scopes `testDir: tests/` and proxies video/whisper to R2. `vitest.config.js` excludes `tests/` + `*.spec.js`.

## i18n

UI strings in `src/data/strings.js` (`get`/`getBilingual`), lesson content `{en,es,pt}` in `src/config/*.json` normalized by `config-normalizer.js`. Guest language flows through `appStore.guestNativeLanguage` (now persisted) → components use `guestNativeLanguage || userData.native_language || 'en'`. Missing translations fall back to English gracefully.

## Supabase

```bash
supabase start           # local stack on 54321/54322/54323 (optional)
supabase db push         # apply supabase/migrations/ (001 init, 002 grants, 003 hardening)
```

Migration `003_harden_public_read_and_view.sql` scopes anon `SELECT` on `user_profiles` to safe display columns and adds view `public.public_profiles`. `useUserByShareCode` queries the view. Apply locally first, then to production — verify `/:shareCode` public profile still renders.

## Contact

**Joe Walsh** — Boston, USA — Support: mrjoewalsh1@gmail.com — Phone: +1 617 657 5018
