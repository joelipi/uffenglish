# Code review — `brand-typography` (`origin/main..HEAD`) — re-review

Range: `origin/main..HEAD` (branch `brand-typography`). This supersedes the earlier
Fail on this same path: both blocking guard findings are fixed and verified.

Method note: verified by reading the code and `node_modules/purgecss` +
`node_modules/vite-plugin-purgecss/dist/index.js` and tracing the guard logic. The
read-only reviewer contract forbids running the suite, so failure modes below were
established by static trace, not by mutation execution.

## Correctness Issues

None blocking.

- The two previously-blocking guards are now genuinely able to fail:
  - `src/modules/theme/brand-fonts-bundle.test.js` now models the plugin's real call
    (`content: [{ raw: html + bundleCode, extension: 'html' }]`, `css: [{ raw: APP_CSS }]`)
    instead of a content glob, and adds an explicit empty-safelist run. `purgeAsTheBuildDoes()`
    derives its output **only** from `APP_CSS`, so deleting any `#root :is(...):lang(x)` rule
    drops `:lang(x)` from the output and the `keeps the :lang(%s) heading rule` case goes red.
    This matches PurgeCSS 4.1.3's `shouldKeepSelector`, which returns true for a selector node
    whose parent is a pseudo (`h1/h2/h3` inside `:is()`) and `continue`s on the `:lang()` node,
    so each rule survives on the `#root` id alone — the premise is pinned by the
    `index.html still contains the id` case. Removing `#root` from `index.html` therefore reds
    the suite (via that premise case).
  - `src/modules/theme/brand-fonts-wiring.test.js:332-351` scans the real selector lists and
    takes the subject compound (`selector.split(/[\s>+~]/).pop()`), so `#root h4 { … }` yields
    subject `h4`, is pushed, and the `toEqual([...])` assertion fails. Dropping the `:is()`
    nesting is caught both by the wiring `every heading selector nests its type selectors
    inside :is()` case and the same case in the bundle test.
- `vite.config.js:88-96` — the `/^:lang/` safelist entry is correctly gone; nothing else in the
  tree asserts the old story (`grep` finds the token only in the rewritten bundle test and this
  review). The `safelistFromConfig()` parity case makes a re-added entry fail.

## Simplicity Issues

None.

## Security Issues

None.

## Concurrency Issues

None.

## Other Notes

- `src/modules/theme/brand-fonts-bundle.test.js:33-44` — `bundleCode()` walks all of `src/`, so
  the content string also contains `app.css`'s own `#root`/`:lang(...)` tokens and the test
  files. This is a small fidelity gap vs the plugin (production passes app.css only as the CSS
  input), but it does not create false confidence: deleting a rule still reds the `:lang()`
  case, and an `index.html` `#root` regression is caught by the dedicated premise case.
  [score: 2]
- `index.html:32` — the Google Fonts `<link rel="stylesheet">` is render-blocking and sits before
  the inline critical `<style>`. This is the deliberate, user-requested trade-off (preconnect +
  `display=swap`), and no comment now claims it is non-blocking, so there is no hidden
  correctness problem. [score: 2]
- `src/modules/video/video-processor.web.js` still draws the recap canvas with `"Orbitron"` /
  `"Plus Jakarta Sans"`, which the site never loads (the new DOM guard deliberately scopes them
  out). Pre-existing and outside this change; flagged once before, still non-blocking. [score: 2]

## Suggestions

- `src/modules/theme/brand-fonts-wiring.test.js:343-344` — the subject test `/^h[1-6]$/` misses a
  compound subject such as `#root h4.brand { … }` (subject `h4.brand`), so a heading rule that
  targets an h4 with a class would not be caught. Matching `/^h[1-6](?![-\w])/` on the stripped
  subject would close the gap. Non-blocking — the named regression (`#root h4 { … }`) does fail.
  [score: 2]
- `src/modules/theme/brand-fonts-bundle.test.js` / `brand-fonts-wiring.test.js` lack a trailing
  newline (`brand-fonts.js` was fixed). Cosmetic. [score: 1]

## Verdict

**Pass**

**Reasoning:** Both blocking false-confidence guards are now able to fail for the regressions
they name (verified by tracing the concrete inputs), the incorrect `/^:lang/` safelist entry and
its false-story comment are gone, and no new blocking issue was introduced.

---

# Code review — follow-up on `1357418` / `f7d0359` / `9f6bbb0`

Range: `origin/main..HEAD` (branch `brand-typography`). This reviews the three
commits after the previous Pass on `a31e294`; `9f6bbb0` is the substantive one
(reverts the render-blocking font `<link>` to the non-blocking preload+swap form
and adds a `<link rel="preconnect">` for the Whisper model origin).

Method note: read-only trace of the source; no test/lint run (reviewer contract).
`origin/main` is an ancestor of `HEAD`, so this range contains only the branch's
own commits — no upstream reversions.

## Correctness Issues

None blocking. The chain the commit relies on is real, verified against the source:

- `index.html:270` boots `<script type="module" src="/src/main.jsx">` at the end of
  `<body>`; `src/main.jsx` → `src/App.jsx` (`App.jsx:4`, a *static* import) → the
  `speech.js` side effects. `speech.js:26` constructs the worker and `speech.js:38`
  calls `whisperAdapter.preloadWhisperEngine()` at module scope, so the model fetch
  starts only once the module graph evaluates. A parser-render-blocking stylesheet in
  `<head>` defers module-script execution, so it does sit in front of that fetch —
  the premise holds, and the non-blocking form is the right call.
- Model bytes really are cross-origin CORS fetches: `whisper-worker-demo.js:29`
  (`env.remoteHost`), `:48` (the pre-cache URL), `:58` (`fetch(url, { mode: 'cors' })`)
  and `whisper-worker-web.js:35` / `:58`. The R2 origin is the one preconnected.

The new guards can fail:

- `whisper-model-origin.test.js:86` — the column-0 anchor
  (`/^whisperAdapter\.preloadWhisperEngine\(\);/gm`) now distinguishes the
  module-scope call at `speech.js:38` from the indented calls at `:87` and `:108`,
  and the premise guard at `:91` pins that the indented call still exists. Deleting
  `speech.js:38` reds the case. The fix holds.
- The other cases assert exact tag strings (`:31`), single occurrence (`:47`), head
  position (`:37`) and the worker literals (`:53`, `:72`), all of which fail on the
  mutation they name.

`crossorigin` on the Whisper preconnect (`index.html:56`) is correct: the model
requests are anonymous-CORS `fetch(url, { mode: 'cors' })`, and an anonymous
preconnect is what the browser reuses for them. The preconnect is useful on exactly
the case that matters — a cold load with a cache miss — since a warmed Cache API hit
never touches the network (it is a harmless no-op there). The document's connection
pool is shared with same-origin dedicated workers, so warming it helps the worker's
first request.

## Simplicity Issues

None.

## Security Issues

None. Verified `public/_headers` and the tree set no CSP, so the inline
`onload="this.onload=null;this.rel='stylesheet'"` swap on `index.html:45` is not
blocked (the commit's "no CSP forbids the inline handler" claim is accurate). If a
`script-src-attr` policy is ever added this swap silently stops applying the
stylesheet — worth keeping in mind, but there is no such policy now.

## Concurrency Issues

None.

## Other Notes

- `index.html:24-30` / `brand-fonts-wiring.test.js:114-119` and the commit message
  say a blocking stylesheet "holds the HTML parser before it reaches the module
  script". A `<link rel="stylesheet">` does not stall the parser; it stalls rendering
  and the *execution* of subsequent scripts (including deferred/module scripts). The
  operative conclusion — the font origin is serialized in front of the model
  download — is unchanged, so this is a wording nit, not a behaviour error. [score: 2]
- `src/modules/theme/brand-fonts.test.js:198-212` — after `9f6bbb0` changed
  `headLinkTags()` to spread `GOOGLE_FONTS_NON_BLOCKING_TAGS`, `tags[2]` is the
  **preload** tag, not the stylesheet. The cases still pass (the stylesheet is now
  the `<noscript>` tag at `tags[3]`, and `preconnects before the stylesheet` /
  `does not put crossorigin on the stylesheet link` compare index 2 for ordering and
  check `tags[2]` for `crossorigin`), but the two names no longer describe what they
  assert, and the "stylesheet has no crossorigin" property is not actually checked on
  the stylesheet tag. The real regression guard lives in the wiring test
  (`has no render-blocking font stylesheet outside <noscript>`), so this is drift,
  not a false pass. Update these to reference the tag by role. [score: 3]
- `src/modules/speech/whisper-model-origin.js` is imported only by its own test — no
  runtime consumer (verified by grep). The workers keep their literals and only the
  classic PWA worker *cannot* import it. That is a deliberate, honest design (the
  test is the binding), but the "single source of truth" framing is stronger than the
  code: `whisper-worker-demo.js` is a module worker and could import
  `WHISPER_MODEL_ORIGIN`/`WHISPER_MODEL_BASE_URL` directly, leaving only the classic
  worker tied by test. [score: 2]
- `src/modules/theme/brand-fonts.js:242` — `headLinkTags()` now has no production
  consumer (only `brand-fonts.test.js`); `index.html` and the wiring test both build
  the tags inline. Three representations of the same four tags. Fine as a copy-paste
  helper, but flag it if `knip` starts failing. [score: 2]
- `whisper-model-origin.js` and `whisper-model-origin.test.js` lack a trailing
  newline (`\ No newline at end of file`), which `1357418` had just normalised on
  three other files. Cosmetic; no `eol-last` lint rule exists. [score: 1]

## Suggestions

- `whisper-model-origin.test.js:57` — `WHISPER_MODEL_PATH.replace('/', '')`
  strips only the first slash; it happens to build `whisper/{model}/` today but
  would silently mis-build if the path ever gained a directory component. Cheap to
  pin the expected template literally. [score: 1]

## Verdict

**Pass**

**Reasoning:** The non-blocking reasoning is sound and the source chain it names
(module script → `speech.js` module-scope preload → worker → R2 CORS fetch) is
verified; `crossorigin` on the preconnect matches the anonymous-CORS model fetch and
the hint is useful on the cold-load path; and the new `whisper-model-origin.test.js`
guards genuinely fail on the mutations they name (the column-0 fix holds). The only
findings are non-blocking test drift and cosmetic nits.

---

# Code review — commit `1945eb7` "Drop the Whisper demo worker's duplicate model pre-cache"

Range: `origin/main..HEAD` (branch `brand-typography`). Scoped to `1945eb7` and the
guards it adds to `src/modules/speech/whisper-model-origin.test.js`; the earlier
typography commits already passed and are not re-reviewed.

Method note: read-only trace of the source and of the installed
`@huggingface/transformers@3.8.1` bundle (`node_modules/@huggingface/transformers/dist/transformers.js`),
plus HEAD requests to the R2 model URLs. No test/lint/build run (reviewer contract);
`node -e` one-liners were used only to evaluate the guard regexes against the source,
which is inspection, not a suite run.

## Correctness Issues

None blocking. Every claim that gates this change verified against the installed bundle:

- **The dead-weight claim is true.** `transformers.js:37377` is the only
  `caches.open(...)` the library performs, and it is `caches.open('transformers-cache')`,
  reached because `whisper-worker-demo.js:28` sets `env.useBrowserCache = true`. The
  deleted loop wrote to `uff-whisper-demo-cache-v1`, a different bucket, so nothing
  Transformers does could read it. `grep` across the tree finds the bucket name only in
  the new explanatory comment (`whisper-worker-demo.js:47`) — no runtime reader exists.
- **`pipeline()` fetches exactly the two removed filenames.** `dtype.q8` maps to the
  `_quantized` suffix (`transformers.js:36850`), the default subfolder is `onnx`
  (`:36976` / `:12406`), and the model names resolve to `encoder_model` and
  `decoder_model_merged` (`:12406`, `:12771`), producing
  `onnx/encoder_model_quantized.onnx` and `onnx/decoder_model_merged_quantized.onnx`.
  The remote URL is built from `env.remoteHost` + `env.remotePathTemplate` + filename
  (`:37390`), which is byte-identical to the URL the deleted loop interpolated
  (`https://r2.ultrafastfluency.com/whisper/onnx-community/whisper-tiny.en/…`).
- **No offline regression.** `env.useBrowserCache = true` is untouched, and the library
  still writes/reads every model file under `transformers-cache`; the removed bucket was
  never on the read path. A cached second load behaves identically.
- **The mobile error path improves rather than regresses.** The deleted loop ran inside
  `bootWhisperEngine`'s `try`, so a pre-cache network failure aborted boot *before*
  `pipeline()` was ever attempted (a single point of failure ahead of the real work).
  Now the only fetch is `pipeline()`'s, and its failure is surfaced by the existing
  per-device catch (`whisper-worker-demo.js:110-118`).

The new guards are genuinely able to fail (assertions evaluated against the live source
and against the original pre-cache re-inserted verbatim):

- Reinstating the loop flips `caches.open` occurrences from 0 → 1, and makes
  `not.toContain('arrayBuffer')` and the ONNX-filename checks red. The positive
  assertions (`env.useBrowserCache = true`, `automatic-speech-recognition`,
  `onnx-community/whisper-tiny.en`) hold on the current file.
- The comment stripper (`whisper-model-origin.test.js:111-113`) removes the prose copies
  of `transformers-cache` / `uff-whisper-demo-cache-v1`, so an explanatory comment cannot
  satisfy a "must not contain" assertion, and the `[^:]//` carve-out leaves the real
  `https://` in `env.remoteHost` intact so the origin guard still matches. No real
  regression can hide behind the stripper (regression code is code, not comment).

## Simplicity Issues

None. The change deletes a helper, a constant list and a loop with no replacement.

## Security Issues

None.

## Concurrency Issues

None.

## Other Notes

- `src/workers/whisper/whisper-worker-demo.js:48-49` (and the commit message) — the
  "~82 MB instead of ~41 MB" transfer figure is **likely overstated**. The R2 model
  responses carry **no `Cache-Control` header at all** (verified by HEAD on both files:
  only `etag`, `last-modified`, `accept-ranges`; `cf-cache-status: DYNAMIC`), so the
  browser caches them heuristically, and Transformers fetches with a default-cache
  `fetch(urlOrPath)` (`transformers.js:37169`). The pipeline's later request for the same
  URL would therefore be served from the browser HTTP cache rather than re-transferred.
  The genuine wins are still real and worth keeping — the ~29 MB decoder
  `arrayBuffer()` heap spike, the serialised pre-pass delaying `pipeline()`'s start, and
  the write into a bucket nothing reads — but the byte-count doubling is probably wrong:
  the first pass warmed the very HTTP cache its second pass duplicated. Recommend
  restating the comment/message as the heap + latency win rather than "82 MB", so a
  future reader does not re-introduce an eager pass to "warm the cache". [score: 3]
- `src/workers/whisper/whisper-worker-web.js:49-71` (the sherpa/PWA worker) has the same
  `caches.open` + `arrayBuffer` shape but is **not** dead weight: its `loadAndCacheFile`
  returns the bytes to the caller (`getPreloadedPackage` / `instantiateWasm`), so the
  fetch is the real one and the cache is consulted on later loads. Correctly outside the
  scope of this commit; noting only so the two workers are not confused. [score: 1]

## Suggestions

- None material.

## Verdict

**Pass**

**Reasoning:** The core claim is confirmed against the installed bundle — Transformers.js
opens `transformers-cache`, nothing reads `uff-whisper-demo-cache-v1`, and `pipeline()`
fetches exactly the two removed filenames — so the deletion is a genuine win with no
offline or mobile regression, and the added guards can fail on the mutation they name.
The only finding is a non-blocking accuracy nit in the "82 MB" framing of the comment.
