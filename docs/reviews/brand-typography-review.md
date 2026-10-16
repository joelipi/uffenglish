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
