# Agent Instructions (`agents.md`)

## 1. Code Architecture & Organization

**Pure React — No DOM Manipulation**
This codebase is moving strictly to React patterns. Never use `document.querySelector`, `getElementById`, `classList`, `style.setProperty`, `appendChild`, or any direct DOM API. Drive all UI changes through React state, refs (for focus/measurement only), and CSS classes on React elements. Violations of this rule will be treated as bugs.

**Modular Structure**
Keep logic in the module where it conceptually belongs. Do not co-locate unrelated concerns.

**Lesson content vs UI copy**
Lesson content (cues, subtitles, transcripts, step config) lives in `src/config/*.json`; the spoken text for mock videos is in `scripts/generate-mock-videos.mjs`. `src/data/strings.js` is UI copy only — never search it for lesson content. For config-only changes, derive the pattern from the earlier lessons in the same config file; don't explore player/store code unless the change touches it.

**Resource & Cost Optimization**
Minimize external operations. All data fetching and mutations must go through TanStack Query and Zustand — never call Appwrite or any external service directly from components or hooks. Prefer in-browser, client-side model operations over external LLM API calls to reduce cost and lay groundwork for offline mode. Balance local-first execution against device CPU/memory constraints.

**Version Control**
Primary branch is `main`. Commits land on `main` directly, so once committed `main..HEAD` is empty — review ranges must use the remote default (`origin/main..HEAD`). This repo is a `blob:none` partial clone: `git log`/`git diff` between local refs work, but `git show <older-sha>` can fail with an auth error for blobs the promisor has not fetched.

---

## 2. Comments & Logging

- **Preserve comments.** Update them when the code they describe changes. Only delete a comment if its code is deleted.
- **Preserve `console.log` statements.** Do not remove existing logs unless the code they relate to has also been removed; comment them out if suppression is needed.
- **Add debug and success logging.** Every significant function or event should log both on failure (with detail) and on success (so it's immediately clear the path fired).

---

## 3. Autonomy & Approvals

Execute small, incremental changes and routine bug fixes immediately without asking for approval.

---

## 4. Testing & Console Monitoring

**Automated browser testing** via Playwright unless the user says they will test manually.

**Console discipline — treat these as bugs:**
- Any unexpected or relevant console error or warning
- Any expected debug/success log that does not appear (silent failures must be investigated)

**Clean up after deletions.** After removing any export, verify all imports of that export are also removed. Run the smoke test to catch load-time errors:
```
tests/answer-flow.spec.js
```

**Config-only changes: unit test the config, skip E2E.** When a change only edits `src/config/*.json`, a vitest unit test importing the JSON (e.g. `src/config/model.test.js`) is sufficient coverage when the rendering path is already exercised by existing lessons. Don't add a Playwright spec for a config-only change.

**Test URL:** `http://localhost:3000/course/model/lesson/g`
Lessons require a full URL where `course` and `model` map to valid JSON files and `lesson` is a valid key within that JSON, unless lesson data is already in memory.

**Mock lesson videos (no real teacher content needed):** `node scripts/generate-mock-videos.mjs` creates H.264+AAC mock mp4s (solid color + spoken-text TTS via ffmpeg `flite`) for every slug in `src/config/model.json`, into `public/assets/videos/`. Generated files are gitignored. `--slug=X --text="..."` for one-off slugs; `--upload` pushes to R2 (needs `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`). After generating, Vite serves `/assets/videos/<slug>.mp4` locally; upload to R2 for staging/prod.

---

## 5. Infrastructure Gotchas (READ FIRST if video/audio/CORS breaks on `s.`)

> **If `<video>` shows `MEDIA_ELEMENT_ERROR: Format error`, `No 'Access-Control-Allow-Origin'`, or Whisper `TypeError: Load failed` on `https://s.ultrafastfluency.com`** (works on localhost) → read **`docs/cloudflare-video-cors.md`**. This is a Cloudflare Transform-Rule config, NOT an app bug.

The short version:
- `s.` must serve `Cross-Origin-Embedder-Policy: credentialless`; `r2.ultrafastfluency.com` must serve `Access-Control-Allow-Origin: *` **and** `Cross-Origin-Resource-Policy: cross-origin` on ALL responses **including `206` range responses** (R2's native CORS omits ACAO on 206 → `<video>` byte-range requests get blocked).
- Fix lives in the Cloudflare zone **Transform Rules** (`http_response_headers_transform`), 3 rules: (1) other hosts `require-corp`, (2) `s.` → `credentialless`, (3) `r2` media paths → `ACAO *` + `CORP cross-origin`. Exact payload + verify commands in `docs/cloudflare-video-cors.md:§3-4`.
- To verify with an automated browser, **use real Chrome** (`npx playwright install chrome`, `channel: 'chrome'`) — Playwright's bundled Chromium lacks H.264/AAC codecs and falsely reports `Format error` on valid mp4s.
- Don't trust bare `curl -I` for R2 videos — it returns `200` (has ACAO). Send `-H "Range: bytes=0-1023"` to reproduce the real `206` behavior.
- **`wrangler pages deploy` fails with `Binding name 'SUPABASE_ANON_KEY' already in use`** if the key is in both `wrangler.toml [vars]` and the Pages dashboard. Keep it only in the dashboard.

---

## 6. App-Specific Testing Workarounds

**Speech-to-Text / Microphone**
You cannot use a microphone. Bypass it using built-in testing functions, or invoke `handleAnswer` (or equivalent) directly to simulate audio input.

**Voice-first, text last (product rule).** Mic/webcam are the primary path; text mode is a last-resort fallback for people who truly cannot speak or whose device cannot run voice. Never render a text-only option while the speech engine is still loading — if it is the only button, users click it and never use voice. Never let a recoverable failure (no mic, blocked permission, engine error) strand the user on a muted-mic screen: keep the voice mode chooser mounted, show descriptive actionable recovery guidance, and offer Retry. Expose text only after the engine has definitively failed, or behind a small de-emphasized link.

Headless recipe (local dev on `:3000`):
- Dismiss the guest modal: click `#guestEnglishOnlyBtn`, then `#guestContinueBtn`.
- Advance past the intro: click `#intro-call-widget`.
- Simulate engine loading/failure by routing `**r2.ultrafastfluency.com/whisper/**` (and `**cdn.jsdelivr.net/**`) to hang or abort; call `window.appStore.getState().setWhisperReady(true)` to reach the mic path without a full model download.
- Headless Chromium has no media devices, so `getUserMedia` rejects — use this for the no-mic recovery path.

**Authentication**
Do not log in unless the task explicitly requires it — login interferes with guest-user testing.
Credentials (use only when required):
- Email: `jules@example.com`
- Password: `testtest`