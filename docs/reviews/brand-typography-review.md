# Code review — `brand-typography` (`origin/main..HEAD`)

Range: `origin/main..HEAD` (branch `brand-typography`). Reviewer: code-reviewer subagent.

Production intent (Inter body / italic Titillium Web headings / `:lang()` overrides) is
sound; the cascade reasoning in `app.css` checks out. The blocking findings are in the
guard tests, which cannot catch the regressions they claim to guard.

## Correctness Issues

- `src/modules/theme/brand-fonts-bundle.test.js:18,31-38` — The PurgeCSS "production"
  reproduction is self-referential and tautological. `PURGECSS_CONTENT` is
  `**/*.{js,css,html,png,svg,ico,webmanifest,woff,woff2}`, resolved from the repo root, so
  the scanned content **includes `src/assets/css/app.css` itself** (plus
  `brand-fonts.js` and this test), which contain the literal `:lang(ja)`/`zh-Hant`/… tokens.
  `:lang()` guards then survive because the selector's own text is in the content — the
  `safelist: [/^:lang/]` is not what keeps them. Delete the safelist entry tomorrow and these
  tests still pass, so they do not prove the fix works. (Per `node_modules/purgecss`,
  `shouldKeepSelector` also auto-keeps any selector nested directly inside a pseudo, and the
  top-level `:is`/`:lang`/combinator nodes `continue` rather than fail, so the whole rule
  survives on the `#root` id alone.) Why it matters: this is the *only* test guarding a
  regression that is invisible in dev (CJK/Devanagari headings silently losing their face in
  production). How to fix: model the real purge input — `content: [{ raw: indexHtml + '<bundled js>', extension: 'html' }]`
  (see `node_modules/vite-plugin-purgecss/dist/index.js`), not a whole-repo glob — and prove
  the guard fails by removing `/^:lang/` locally. Also note the claim at
  `brand-fonts-bundle.test.js:15-18` ("the content glob … the production build uses") is
  false, and the test at `:97` asserts the **workbox `globPatterns`** string
  (`vite.config.js:114`), which is unrelated to PurgeCSS content. [score: 4]

- `src/modules/theme/brand-fonts-wiring.test.js:330-336` — The `h4`/`h5`/`h6` guard cannot
  fail for the regression it describes. The regex `^[#\w.[\]]*h4[ ,:{]` (multiline) only
  matches when `h4` is *directly* preceded by `#`/`\w`/`.`/`[`/`]` with **no space**, so the
  realistic form the comment worries about — `#root h4 { font-weight: … }` (space between
  `#root` and `h4`) — does not match, and the guard stays green if someone adds it. Why it
  matters: the test gives false confidence that h4-h6 are excluded from the display
  treatment. How to fix: assert on the heading selectors actually present, e.g. collect all
  `#root`-anchored rule prefixes with `blockFor`/a selector scan and assert none target
  `h4`-`h6`, rather than a start-of-line token regex. [score: 4]

## Simplicity Issues

None.

## Security Issues

None.

## Concurrency Issues

None.

## Other Notes

- `index.html:23-33` — Loading regression: the diff replaces the previous non-blocking
  `rel="preload" as="style" onload="this.rel='stylesheet'"` + `<noscript>` pair with a plain
  render-blocking `<link rel="stylesheet">` placed in `<head>` *before* the inline critical
  `<style>`. A render-blocking stylesheet in the head blocks first paint, so the inline
  preloader can no longer paint until `fonts.googleapis.com` responds — the opposite of the
  stated goal ("costs no extra round-trip" smooths latency but not render-blocking). The
  `app.css` comment at `:9-16` argues an `@import` is render-blocking "which would undo the
  non-blocking preloader paint", yet the `<link>` it substitutes is equally render-blocking.
  Non-blocking, but worth a conscious decision: keep `media="print"`/`onload` swap or accept
  the FCP hit for the CJK font kit. [score: 3]
- `src/modules/video/video-processor.web.js:149-150,1094-1247` — The recap/canvas drawing
  still uses `"Orbitron"`/`"Plus Jakarta Sans"`, which the site never loads, so the rendered
  video falls back to `sans-serif`. The new "no dead font references" guard scopes itself to
  DOM sources (`brand-fonts-wiring.test.js:415-438`) and deliberately skips these. Pre-existing
  and outside this change's surface, but the brand kit now makes the mismatch visible. [score: 2]

## Suggestions

- `src/modules/theme/brand-fonts-bundle.test.js:5` — imports `purgecss` directly although it
  is only a transitive dependency of `vite-plugin-purgecss` (`package.json:44`). If the plugin
  bumps/drops it, the test fails to collect. Add `purgecss` as an explicit devDependency.
  [score: 2]
- `src/modules/theme/brand-fonts.js:224` — file has no trailing newline (`\ No newline at end
  of file`). [score: 1]
- `src/modules/theme/brand-fonts-wiring.test.js` — the inline-preloader guard depends on the
  exact `'body,\n        html {'` whitespace (8-space indent); a reformat breaks the test
  without any behaviour change. Consider a regex/`indexOf('html {')`-style marker. [score: 1]

## Verdict

**Fail** — two findings score ≥ 4 (both false-confidence guards in the new test files).

**Reasoning:** The production CSS/cascade work looks correct, but the test that exists
specifically to prove the production purge keeps the overrides cannot fail when the safelist
is removed (self-referential content), and the h4-h6 guard cannot match the regression it
names. Those guards should be made able to fail before this is trusted.
