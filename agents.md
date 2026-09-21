# Agent Instructions (`agents.md`)

## 1. Code Architecture & Organization

**Pure React — No DOM Manipulation**
This codebase is moving strictly to React patterns. Never use `document.querySelector`, `getElementById`, `classList`, `style.setProperty`, `appendChild`, or any direct DOM API. Drive all UI changes through React state, refs (for focus/measurement only), and CSS classes on React elements. Violations of this rule will be treated as bugs.

**Modular Structure**
Keep logic in the module where it conceptually belongs. Do not co-locate unrelated concerns.

**Lesson content vs UI copy**
Lesson content (cues, subtitles, transcripts, step config) lives in `src/config/*.json`. `src/data/strings.js` is UI copy only — never search it for lesson content. For config-only changes, derive the pattern from the earlier lessons in the same config file; don't explore player/store code unless the change touches it.

**Auto captions for simple videos**
New `simpleVideoUrl` steps get captions automatically on push (six languages: en/es/pt/fr/hi/bn) via `.github/workflows/captions.yml` (local Whisper + DeepSeek, `scripts/generate-captions.mjs`). Do not hand-backfill captions for existing videos — the pipeline only touches newly added slugs and never overwrites authored `subtitles`.

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

**Lesson media (real recordings only):** every video slug in `src/config/*.json` resolves to a real file on R2 at `assets/videos/<slug>.mp4` (`src/modules/video/video-url.js`). Video files are never committed (too large) and are gitignored. Upload recordings to R2 manually, e.g. `npx wrangler r2 object put uff/assets/videos/<slug>.mp4 --file <path> --content-type video/mp4`, then reference the slug in the config. Do not add a placeholder/mock video generator.

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

**Voice-first, text available (product rule).** Mic/webcam are the primary path; text mode is a fallback for people who cannot speak or whose device cannot run voice. The keyboard icon in the mode chooser is always visible and usable — it does not depend on the speech engine, so text is never hidden while the engine loads or fails. Never let a recoverable failure (no mic, blocked permission, engine error) strand the user on a muted-mic screen: keep the voice mode chooser mounted, show descriptive actionable recovery guidance, and offer Retry.

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