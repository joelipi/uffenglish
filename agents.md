# Agent Instructions (`agents.md`)

## 1. Code Architecture & Organization

**Pure React — No DOM Manipulation**
This codebase is moving strictly to React patterns. Never use `document.querySelector`, `getElementById`, `classList`, `style.setProperty`, `appendChild`, or any direct DOM API. Drive all UI changes through React state, refs (for focus/measurement only), and CSS classes on React elements. Violations of this rule will be treated as bugs.

**Modular Structure**
Keep logic in the module where it conceptually belongs. Do not co-locate unrelated concerns.

**Resource & Cost Optimization**
Minimize external operations. All data fetching and mutations must go through TanStack Query and Zustand — never call Appwrite or any external service directly from components or hooks. Prefer in-browser, client-side model operations over external LLM API calls to reduce cost and lay groundwork for offline mode. Balance local-first execution against device CPU/memory constraints.

**Version Control**
Primary branch is `main`.

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

**Authentication**
Do not log in unless the task explicitly requires it — login interferes with guest-user testing.
Credentials (use only when required):
- Email: `jules@example.com`
- Password: `testtest`