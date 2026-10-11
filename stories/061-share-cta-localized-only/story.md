# The success-screen share CTA shows only the translation

## Context

On the success screen of a friend-challenge lesson (`recapOverlay: 'shareCta'` — the "ask" side of `wouldyourather` / `friendchain`), `src/components/widgets/SuccessScreen.jsx` renders the `share_cta_success` string through `getBilingual()`, which returns both the English sentence and the learner-language version. The JSX prints them stacked (`SuccessScreen.jsx:74-80`):

```jsx
{showActions && isFriendLesson && (
  <p className="success-share-cta">
    {cta.localized ? (
      <React.Fragment>{cta.english}<br /><span lang={cta.lang}>{cta.localized}</span></React.Fragment>
    ) : cta.english}
  </p>
)}
```

A learner who chose Bengali therefore reads "Share this video with friends, family, and colleagues so they can practice with you. They have 48 hours to respond." *and* the Bengali sentence below it — the same message twice, with the English copy they did not choose on top. The learner already chose their language at the guest language step, and `useNativeLanguage()` resolves it guest-first (AGENTS.md), so the English line is redundant and wraps the CTA into a second line inside the water band above the Share button.

Verified reproduction before this story was written (real browser, `/course/wouldyourather/lesson/a`, `guestNativeLanguage: 'bn'`):

```
CTA_HTML  Share this video with friends, family, and colleagues so they can practice with you. They have 48 hours to respond.<br><span lang="bn">এই ভিডিওটি বন্ধু, পরিবার ও সহকর্মীদের সাথে শেয়ার করুন …</span>
```

The fix removes `{cta.english}<br />` from that paragraph, and nothing else: the string key, its six translations, the English fallback for an untranslated language, the `<span lang>` (which keeps Bengali/Hindi upright against the global `[lang]:not([lang="en"])` italic rule), the CSS, the burned-in recap CTA, and the button labels all stay as they are.

## Out of Scope

- The `SHARE` / `CONTINUE` / `REPLAY` / `WATCH TUTORIAL` button labels above the circular buttons, which still intentionally render both lines (`SuccessButtons.jsx` `ChoiceLabel`, `ChoiceColumn.jsx`, `Hints.jsx`). The request is the paragraph only; the `ivp-choice-label` styling is shared with every earlier lesson step, so changing it is a separate decision.
- The recap video's burned-in share CTA (`share_cta_respond_now` / `_quick` / `_go_to` / `_enter_code` in `src/modules/video/video-processor.web.js:236-246`) and `share_cta_headline` — already single-language via `Strings.get`.
- The `share_message` share-sheet text and the homepage headline (`home_landing_headline`) — already single-language.
- `getBilingual()` in `src/data/strings.js` and its tests; the fix is at the call site.
- `src/assets/css/app.css` and the static fixture markup in `tests/video-overlay-italic.spec.js` — that suite asserts CSS (`font-style: normal` for `.success-share-cta [lang]`, `app.css:331-337`) against its own `MARKUP` constant, which the retained `<span lang>` still satisfies. The fixture is left byte-identical; the suite is re-run to prove it.
- The pre-existing red tests documented in Task 5 are corrected only to the extent needed to make the suite green (they are not rewritten).

## Implementation approach

### 1. The one markup change

In `src/components/widgets/SuccessScreen.jsx`, the paragraph guarded by `showActions && isFriendLesson &&` becomes:

```jsx
{showActions && isFriendLesson && (
  <p className="success-share-cta">
    {cta.localized ? <span lang={cta.lang}>{cta.localized}</span> : cta.english}
  </p>
)}
```

Three traps, each verified against the codebase:

- **Keep `<span lang={cta.lang}>{cta.localized}</span>` verbatim.** `src/components/video-overlay-italic.test.js:52-60` asserts `SuccessScreen.jsx` contains exactly that string, and `src/assets/css/app.css:331-337` styles `.success-share-cta [lang]`. Rendering `{cta.localized}` bare would drop the `lang` attribute, letting the global italic rule smear Bengali, and would fail that guard.
- **Keep the `: cta.english` fallback.** `getBilingual()` returns `localized: null` when the language is `en` or the key has no translation for it (`src/data/strings.js:2481-2485`), so this branch is what an English guest and any future untranslated locale render. Removing it yields an empty paragraph. The six translations for `share_cta_success` (en/es/pt/fr/hi/bn, `src/data/strings.js:2229-2236`) are already asserted by the existing `keeps the share CTA copy already shipped for hi/bn` case in `src/data/strings.test.js`; no copy is added.
- **Leave `import React, { useEffect } from 'react'` alone.** Line 77 is the only `React.` reference in the file, so after the edit `React` is an unused import — which is the repo norm (~20 sibling `.jsx` files do the same) and is not a lint finding: `eslint.config.js` enables no `no-unused-vars` rule, only `no-restricted-syntax` (browser-only) and `react-hooks` (off). `npx eslint src/components/widgets/SuccessScreen.jsx` exits 0 today and must still exit 0 after the change (the two pre-existing `window is browser-only` warnings, from the `beforeunload` effect, are unrelated).

The resulting DOM for a Bengali learner is exactly `<p class="success-share-cta"><span lang="bn">…</span></p>` — one line, no `<br>`, no English.

### 2. A source guard in vitest

The established convention for this exact area is a source guard beside the feature (`src/components/widgets/clips-uploading-warning-wiring.test.js`, which guards the sibling `clips_uploading_warning` paragraph). Add `src/components/widgets/share-cta-language.test.js`, reading `./SuccessScreen.jsx` raw (no comment stripping) and asserting:

- the paragraph contains `<span lang={cta.lang}>{cta.localized}</span>`;
- it does not contain `{cta.english}` (the token that carried the English line) — a case-sensitive raw-source match, so re-adding the English line fails it;
- it still resolves the language through `getBilingual('share_cta_success', lang)` and `useNativeLanguage`, which is the contract `src/components/guest-first-language.test.js:16` guards for this file.

### 3. A rendered-DOM test in jsdom

`SuccessScreen` mounts in vitest (verified in a scratch render before this story was written): it only needs the two TanStack mutations from `../../modules/api/api.js` mocked (`useAddFriendLinkMutation`, `useRecordFriendResponseMutation`) — `posthog.js` is a documented no-op until the SDK loads and `canvas-confetti` is dynamically imported inside `SuccessEffects`, so neither blocks mounting. Use the repo's `createRoot` + `act` convention (`src/components/widgets/BranchChoiceButtons.test.jsx`, `src/components/profile/FriendLessonLinksSection.test.jsx`) in a new `src/components/widgets/SuccessScreen.test.jsx`:

- `bottomState: 'lessonSuccess'`, `configData: { lessons: [{ lessonId: 'a', recapOverlay: 'shareCta' }] }`, `currentLessonIndex: 0`, `successVideoButton: { state: 'ready' }`, `guestNativeLanguage: 'bn'` → `.success-share-cta` exists, `textContent` equals `strings['share_cta_success'].bn`, and `innerHTML` contains `<span lang="bn">`, no `<br>`, and no "Share this video".
- the same store with `guestNativeLanguage: 'en'` (or null) → the paragraph still shows `strings['share_cta_success'].en` (the fallback).
- `recapOverlay` absent from the lesson → `.success-share-cta` is absent (unchanged behaviour for every non-friend lesson).

Import the raw `strings` table (not `Strings.get`) for the expected values, per the locale-coverage rule in AGENTS.md.

### 4. Real-browser proof, plus a pre-existing red test to repair

`tests/success-concat-button.spec.js` owns the success-screen e2e. The rendered dump above and the formulations below were each executed in a throwaway spec before this story was written, so both are known-good:

- **Repair the friend-challenge test (pre-existing red).** `friend-challenge lesson shows only Share with the 48h call to action` (`tests/success-concat-button.spec.js:323`) resolves its shareCta lesson with `s.configData.lessons.findIndex(l => l.recapOverlay === 'shareCta')` on the `model` course — but `src/config/model.json` carries no `recapOverlay` key at all, so the index is `-1`, `resolveRecapOverlay(configData.lessons[-1])` is undefined, and the screen renders the normal Replay/Share/Continue row: `#repeatButtonSuccess` is 1, not 0, and the test times out. This is red on this branch's base commit, independently of this change. Repair it by parameterizing the spec's `setupSuccessScreen` helper with an optional course/lesson (`{ url = LESSON_URL, lessonId = 'm-g' } = {}`, passed to `page.goto` and `waitForLessonReady`) and running that test against `/course/wouldyourather/lesson/a` (a real `shareCta` course whose lesson `a` starts with a `lessonIntro` step, so the loader still settles). Verified: repointed, the test passes with all of its original assertions untouched, and no console errors.
- **Add the localized-only case** to the same spec: after `setupSuccessScreen(page, { url: '/course/wouldyourather/lesson/a', lessonId: 'a' })`, set the language with `window.appStore.setState({ guestNativeLanguage: 'bn' })` (guest-first wins over the `userData.native_language: 'en'` the helper writes), then set the success video state as the other tests do and assert: `#state-lesson-success .success-share-cta` is visible, contains the Bengali sentence, does not contain "Share this video", and has no `<br>` inside it. The existing English assertions in the repointed test are the fallback case and must keep passing unchanged.

## Tasks

### Task 1 - Remove the English line from the success CTA

- `[source inspected]` `src/components/widgets/SuccessScreen.jsx`
  - → the `success-share-cta` paragraph contains `<span lang={cta.lang}>{cta.localized}</span>`
  - → it no longer contains `{cta.english}` and no longer contains `<React.Fragment>`
  - → it still contains `: cta.english` as the no-translation fallback
  - → it still calls `getBilingual('share_cta_success', lang)` and `useNativeLanguage`
- `[branch `061-share-cta-localized-only`]` `npx eslint src/components/widgets/SuccessScreen.jsx`
  - → exits 0 (the two pre-existing `window is browser-only` warnings from the `beforeunload` effect are unrelated)

### Task 2 - Source guard for the CTA language rule

- `[source inspected]` `src/components/widgets/share-cta-language.test.js`
  - → exists and reads `./SuccessScreen.jsx` raw
  - → asserts the occurrence of `<span lang={cta.lang}>{cta.localized}</span>`
  - → asserts the absence of `{cta.english}`
  - → asserts the presence of `getBilingual('share_cta_success', lang)` and `useNativeLanguage`
- `[npx vitest run src/components/widgets/share-cta-language.test.js]`
  - → passes
- `[the same run with `{cta.english}` re-inserted before `<span lang={cta.lang}>`]`
  - → the "absence" assertion fails (proves the guard can fail, per AGENTS.md)

### Task 3 - Rendered-DOM coverage

- `[friend-challenge lesson, `successVideoButton.state === 'ready'`, `guestNativeLanguage: 'bn'`]` SuccessScreen rendered in jsdom
  - → `.success-share-cta` is present
  - → its `textContent` equals `strings['share_cta_success'].bn`
  - → its `innerHTML` contains `<span lang="bn">`, contains no `<br>`, and does not contain "Share this video"
- `[same store, `guestNativeLanguage` = `'en'` or null]`
  - → `.success-share-cta` is present and its `textContent` equals `strings['share_cta_success'].en`
- `[lesson without `recapOverlay: 'shareCta'`]`
  - → `.success-share-cta` is absent
- `[npx vitest run src/components/widgets/SuccessScreen.test.jsx]`
  - → passes

### Task 4 - Real-browser proof + repair of the pre-existing red friend-challenge test

- `[source inspected]` `tests/success-concat-button.spec.js`
  - → `setupSuccessScreen` accepts an optional `url` / `lessonId` and passes them to `page.goto` and `waitForLessonReady`
  - → the friend-challenge test runs against `/course/wouldyourather/lesson/a`
  - → its original assertions are unchanged (`#createVideoButton` visible, `#repeatButtonSuccess` and `#continueButtonSuccess` counts 0, one `ivp-choice-label-text`, CTA contains "Share this video with friends, family, and colleagues" and "They have 48 hours to respond")
  - → a second test sets `guestNativeLanguage: 'bn'` and asserts the CTA shows the Bengali sentence only: visible, contains the Bengali text, no "Share this video", no `<br>` inside the CTA
- `[npx playwright test tests/success-concat-button.spec.js]`
  - → all tests pass
- `[npx playwright test tests/video-overlay-italic.spec.js]`
  - → passes (the localized span stays upright)

### Task 5 - Full verification, including the known pre-existing failures

- `[npx vitest run]`
  - → fully green with this story's new files included. Known baseline trap: `scripts/lib/bootstrap-homepage-css.test.js > the vendored Bootstrap 5.3.8 stylesheet > is the pinned version` fails on a worktree whose `node_modules/bootstrap` is an older dist (observed: 5.3.3 installed against the lockfile's 5.3.8), because the vendored stylesheet then carries no `Bootstrap  v5.3.8` banner. Repair it by installing the pinned version (`npm install bootstrap@5.3.8`, or `npm ci` for a full reinstall) — never by editing the guard — and confirm `npm ls bootstrap` no longer reports `invalid`.
- `[npx vitest run src/components/video-overlay-italic.test.js src/components/guest-first-language.test.js src/components/widgets/clips-uploading-warning-wiring.test.js src/data/strings.test.js]`
  - → passes (the `<span lang={cta.lang}>` token, the guest-first rule and the shipped hi/bn copy are intact)
- `[npx eslint .]`
  - → exits 0 (0 errors; the `no-restricted-syntax` browser-only warnings are pre-existing)
- `[npm run build]`
  - → succeeds

## Notes

- No new dependency, no bootstrap steps, no config, no migration. `src/components/widgets/SuccessScreen.jsx` is the only file with a behavior change; everything else is test-only.
- One test was red on this branch's base commit and is repaired here because the acceptance review requires a green suite: `tests/success-concat-button.spec.js:321` `friend-challenge lesson shows only Share with the 48h call to action` — `model.json` has no `shareCta` lesson, so `findIndex` returns `-1` and the CTA never renders. Root cause and the verified minimal repair are in Task 4.
- A second baseline trap is environmental, not code: see Task 5 for the Bootstrap dist/lockfile drift that fails `scripts/lib/bootstrap-homepage-css.test.js`. Fix it by installing the pinned 5.3.8, not by weakening the guard.
- Do not weaken any of these guards to get green: the italic guard, the guest-first guard, the clips-uploading guard and the Bootstrap version guard are exactly the failure modes AGENTS.md calls out (`a guard that can never fail`, whole-file `toContain`, comment-stripping). Keep the assertions scoped and raw-source.
- The paragraph keeps its existing CSS (`#state-lesson-success .success-share-cta`: `max-width: 520px`, centered, white, 600 weight, text-shadow). Dropping the English line removes the wrapped second line, so the CTA reads as one short block in the water band — no layout change is required.
- `guestNativeLanguage` may be written uppercase (`'BN'`) by `confirmGuestLanguage`; `getBilingual()` lowercases both the lookup and the returned `lang`, so the `<span lang="bn">` is correct either way.
- This story was planned against `origin/main` (780586f). All referenced files (`SuccessScreen.jsx`, `strings.js`, `app.css`, `model.json`, `wouldyourather.json` lesson `a`, the three guard tests, `success-concat-button.spec.js`) were re-checked on that commit; the only drift is `app.css`'s `#state-lesson-success .success-share-cta` block moving to line 1266, which no assertion depends on.
