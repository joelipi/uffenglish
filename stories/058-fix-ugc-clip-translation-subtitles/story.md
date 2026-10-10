# Burned recap/UGC subtitle uses the guest-first session language

## Context

The end-of-lesson recap and the per-segment UGC clips burn a subtitle into each of the learner's own recorded segments. For a `closedResponse`/`friendClosedResponse` step the subtitle is `{ en: rec.matchedCue, translation: rec.translation || null }` (`_getResponseSubtitle`, `src/modules/video/video-processor-logic.js`), and `drawTextOverlay` renders the English line plus, when present, the localized translation line below it (`src/modules/video/video-processor.web.js`).

`rec.translation` is computed at answer time and stored on the recording by the answer pipeline:

```js
// src/modules/answer/answer-pipeline.js
const lang = userData?.native_language || appStore.getState().userData?.native_language || 'en';
const translation = getLocalizedCueTranslation(cue, matchedCue, lang);
await updateSpeechRecording(currentLessonId, stepIndex, { ..., ...(translation ? { translation } : {}) });
```

This expression reads the profile's `native_language` **only** — never the guest/adopted session language. But the recap resolves the language guest-first (`src/modules/video/video-processor.web.js:193`):

```js
const userLang = resolveConfigLanguage(snapshot.guestNativeLanguage, snapshot.userData?.native_language);
```

`resolveConfigLanguage(guestLang, profileLang)` is `guestLang || profileLang || 'en'` (`src/modules/bilingual/config-normalizer.js:19-21`), the same rule the rest of the app uses (AGENTS.md). The async profile bootstrap can write the fetched profile's `native_language: 'EN'` after a guest picked another language, and a mid-session login keeps the adopted language in `guestNativeLanguage` (documented known limitation, `src/hooks/use-guest-modal-guard.js:93-100`), so the two paths disagree: the recap is localized to the session language while `rec.translation` was computed with `'en'` and stored as nothing. The burned clip then shows English only.

**Production evidence (R2 clips, Oct 8–10):** the recap tailing CTA of `mctpp`, `exycy`, `fw5a8` and `bguy9` is fully Spanish (`¡Toma menos de 5 minutos!`, `Ingresa el código: …`) while their burned `wouldyourather-{a,b}-response-01` captions are English-only; `bduth`, `p6srf` and `pwspi`'s ask clip, recorded with the profile language equal to the session language, do carry the Spanish translation. This is why the reports looked like they "flipped" between lessons — the variable is the session language state, not the lesson.

The fix is to resolve the answer language with the same guest-first rule the recap uses.

## Out of Scope

- No change to `resolveConfigLanguage` / `normalizeConfig` (the recap already resolves guest-first; the answer path is what diverged).
- No change to `getLocalizedCueTranslation`, the cue-matching algorithm, or `src/modules/answer/answers.js`.
- No change to `_getResponseSubtitle`/`_getStepCue`'s subtitle rules (story 028): a closed response still burns the matched cue + translation, and nothing when no cue matched; an open response still burns the transcript.
- No backfill or re-render of already-published R2 clips (they must be re-recorded to pick up the translation).
- No change to the renderer, prefetch, playlist, or R2 upload mechanics.
- No new dependency.

## Implementation approach

All changes are in `src/modules/answer/answer-pipeline.js`.

Add one exported helper and route every language resolution through it:

```js
import { resolveConfigLanguage } from '../bilingual/config-normalizer.js';

/**
 * The active lesson language for answer processing, resolved guest-first exactly
 * like the recap and the rest of the app (AGENTS.md:
 * `guestNativeLanguage || userData.native_language || 'en'`).
 */
export function resolveAnswerLanguage(userData) {
    const state = appStore.getState();
    return resolveConfigLanguage(
        state.guestNativeLanguage,
        userData?.native_language || state.userData?.native_language
    );
}
```

Replace all seven language reads:

- the six `const lang = userData?.native_language || appStore.getState().userData?.native_language || 'en';` occurrences (the text-mode and voice paths that compute `rec.translation`, plus the chat/feedback paths) with `const lang = resolveAnswerLanguage(userData);`
- `buildFeedbackData({ ..., lang: userData?.native_language, ... })` with `lang: resolveAnswerLanguage(userData)`.

### Resolution rule (exhaustive)

For a call with `userData` (the argument, possibly `null`) and store state:

| `guestNativeLanguage` | `userData.native_language` | store `userData.native_language` | Result |
| --- | --- | --- | --- |
| set (e.g. `'es'`) | any | any | `guestNativeLanguage` (guest/adopted session language wins) |
| unset | set | any | `userData.native_language` |
| unset | unset | set | store `userData.native_language` |
| unset | unset | unset | `'en'` |

Consequences, all intentional:

- The burned subtitle's translation now uses the same language as the recap, so a guest/adopted session language no longer produces an English-only clip while the recap is localized.
- A logged-in user with no guest language is unchanged (profile language).
- An English session still stores no translation (`getLocalizedCueTranslation` returns `undefined` for `en`), so the burn stays English-only as today.

No import cycle: `answer-pipeline.js` already imports `../store/store.js`; `config-normalizer.js` imports only `data/strings.js`, `../utils/utils.js` and `../store/store.js`, and nothing imports `answer-pipeline.js` from that graph.

## Tasks

### Task 1 - Resolve the answer language guest-first

Tests in `src/modules/answer/answer-pipeline.test.js`.

- `resolveAnswerLanguage` with store `{ guestNativeLanguage: 'es', userData: { native_language: 'en' } }`
  - → returns `'es'`
- `resolveAnswerLanguage` with store `{ guestNativeLanguage: null, userData: { native_language: 'es' } }`
  - → returns `'es'`
- `resolveAnswerLanguage({ native_language: 'bn' })` with store `{ guestNativeLanguage: null, userData: null }`
  - → returns `'bn'`
- `resolveAnswerLanguage(null)` with store `{ guestNativeLanguage: null, userData: null }`
  - → returns `'en'`

### Task 2 - The stored burned-subtitle translation uses the guest-first language

Tests in `src/modules/answer/answer-pipeline.test.js`. Setup: a lesson whose single step is `{ responseType: 'friendClosedResponse', cue: [{ en: 'A million dollars today.', es: 'Un millón de dólares hoy.', … }], interactiveVideoUrl: null }`; pre-save a recording for `test-lesson` step 0, call `handleAnswer('A million dollars today', cue, step, …)`, then read it back via `getAllSpeechRecordingsForLesson('test-lesson')`.

- store `{ guestNativeLanguage: 'es', userData: { native_language: 'en' } }` + a correct answer
  - → the recording's `matchedCue` is `'A million dollars today.'`
  - → the recording's `translation` is `'Un millón de dólares hoy.'`
- store `{ guestNativeLanguage: null, userData: { native_language: 'es' } }` + a correct answer
  - → the recording's `translation` is `'Un millón de dólares hoy.'`
- store `{ guestNativeLanguage: null, userData: { native_language: 'en' } }` + a correct answer
  - → the recording's `translation` is `undefined`

- full suite `npm test -- --run`
  - → passes, including every existing `answer-pipeline.test.js` case.

### Task 3 - Document the behavior

Add a test to the existing recap-subtitle docs describe in `src/modules/video/video-processor-logic.test.js` (it already reads `docs/product.md`).

- test reading `docs/product.md`
  - → it contains the link `stories/058-fix-ugc-clip-translation-subtitles/story.md`.
  - → the Known Limitations slice (from `## Known Limitations`) contains `guest-first session language`.

## Technical Context

- No new dependencies and no new app/service/package: no Bootstrap section.
- `resolveConfigLanguage` lives in `src/modules/bilingual/config-normalizer.js:19-21`. `getLocalizedCueTranslation` (`src/modules/utils/utils.js:74-95`) returns `undefined` when the language normalizes to `'en'`, so an English session stores no `translation` (the update spreads `...(translation ? { translation } : {})`).
- `updateSpeechRecording` merges the update into the in-memory record (`src/modules/storage/storage.web.js:225-249`), which `getAllSpeechRecordingsForLesson` reads back synchronously — so the test can assert the stored value without IndexedDB.
- Unit tests: `npm test -- --run` (vitest 4.1.6 + jsdom 29.1.1, colocated `*.test.js`). The affected spec is `src/modules/answer/answer-pipeline.test.js`.
- The recap/UGC subtitle path consumes `rec.translation` via `_getResponseSubtitle` (`src/modules/video/video-processor-logic.js`), which is shared by the concatenated recap, the per-segment R2 export, and the native recap.

## Notes

- The regression only affects recordings whose answer-time `userData.native_language` differed from the guest-first session language; a user whose profile language equals the session language was unaffected, which is why only some clips on R2 show the translation.
- Already-published clips keep their English-only burn — the translation is fixed for newly recorded clips (or a re-record).
- No manual pixel verification is possible; the contract is `rec.translation` stored on the recording, which is exactly what the planner reads.
- Manual check: as a guest with a non-English language, complete lesson `b`, generate the clip, and confirm the burned subtitle shows the English cue plus the localized translation line.
