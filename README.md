# UFF — Ultra Fast Fluency

![UFF Loading](assets/img/u-f-f.png)

## Overview

**UFF (Ultra Fast Fluency)** is a web app for English fluency through speaking and listening. Native-speaker video, voice-first answers, AI evaluation of intent/grammar, and a fluency score (0–100).

## Tech Stack

- **Frontend:** React 19 + React Router 7 + Vite 8 + Zustand (persisted `appStore` in `src/modules/store/store.js`) + TanStack Query + Bootstrap 5
- **Backend:** Supabase (auth + `user_profiles` + `avatars` bucket, `supabase/migrations/`) — anon key is publishable, service role never in client
- **Speech:** Whisper via Transformers.js / WASM workers (`src/workers/whisper/`) + VAD + speech-cam MediaRecorder
- **Storage:** localStorage (lesson progress) + IndexedDB via `idb-keyval` for per-segment recordings (`src/modules/storage/recordingDb.js`) — ArrayBuffer only, never Blob (WebKit object-store bug)
- **Media:** R2 `https://r2.ultrafastfluency.com` for lesson videos/posters (`/assets/videos/`, `/whisper/` proxied in `vite.config.js`), per-segment UGC to `videos/` via `functions/api/upload-segment.js` (JWT-gated)
- **Analytics:** PostHog — session replay + exception capture (`src/modules/utils/posthog-client.js`), `maskInputOptions: {password,email}` so lesson text answers replay unmasked while credentials stay masked
- **Deploy:** Cloudflare Pages (`dist/`), `wrangler.toml`, poster pipeline `scripts/generate-thumbnails.mjs` + ffmpeg

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
- `ffmpeg` for poster generation (`sudo apt-get install -y ffmpeg` — CI does this)
- Cloudflare creds only for poster upload / Pages deploy: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
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

Staging: `s.ultrafastfluency.com` (Pages custom domain — add in Cloudflare dashboard, TLS auto). Production deploys on push to `main`.

## Build & Deploy

```bash
npm test -- --run          # unit tests (14 files, jsdom) — must be green before push
npm run build              # vite build → dist/ (+ copy src/config + _headers/_redirects)
node scripts/verify-thumbnails.mjs   # poster check
npm run deploy             # build + wrangler pages deploy dist --project-name=uffenglish
```

CI (`deploy.yml` on push to `main`): `npm ci` → unit tests → ffmpeg → `generate-thumbnails` → `--upload` (R2, non-fatal) → `verify` → `build` → `pages deploy`. Production branch is `main`; `s.` binds to the Pages project.

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
