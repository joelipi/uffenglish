# B-lesson ask clips — embed the A questions in B and publish them under lesson `a`

## Context

The friend-challenge loop is currently one-directional for a **responder**. A learner who opens a friend's share link goes straight to answer lesson `b` (the answer lesson; `wa`/`wfa` in `model.json`). They record 3 answers, generate a recap, and share it. But they never become an asker: they have no ask clips published, so they have no profile link of their own, and the chain stops.

We want every responder to become a challenger **in the same session** — the user explicitly rejected chaining `b` → `a` because after `b` they generate a video and leave to WhatsApp to share it, at which point they are gone. So the ask questions must be recorded **inside the `b` lesson, before the export/share**, and the shared `b` recap then also contains the responder's own questions.

The one technical obstacle: a user clip's R2 key is generated in code from the **lesson being exported** plus a running segment number (`src/modules/video/video-processor.web.js:1352`):

```
videos/{shareCode}-{courseId}-{lessonId}-response-NN.mp4
```

while a friend's `b` lesson looks up the asker's clips by a **literal config slug** (`{friendCode}-{courseId}-a-response-NN`, e.g. `"{friendCode}friend-a-response-01"`). So even if the ask steps are appended to `b`, their recordings would publish as `...-b-response-04/05/06` and never match `...-a-response-01/02/03`.

This story makes the export honor a per-step **publish target**, so the ask steps embedded in `b` publish under lesson `a` exactly where friends look. Lesson ids are always `a` (ask) and `b` (answer) in every course; a course is eligible only if it contains lesson `b` (existing guard).

## Out of Scope

- **Chaining `b` → `a`.** Rejected: the share hand-off loses the user. The ask recording happens inside `b`.
- **Converting other courses.** The code is course-agnostic. `friend.json` lesson `b` is converted in this story (Task 5); any other course that gains `a`/`b` is converted the same way.
- **A new R2 namespace, table, endpoint, or prompt source.** The clips still land in `videos/` under the existing key scheme.
- **Changing the link target, CTA copy/URL, or the friend success screen.** The link still points at lesson `b`; the recap CTA still shows `ultrafastfluency.com/<shareCode>`; friend lessons still show only the Share button.
- **Recording-flow changes.** `handleStepCore`, scoring, and the answer pipeline are untouched; the appended steps are ordinary `friendClosedResponse` recordings.
- **Native export.** `video-processor.native.jsx` is dead code; only its `exportSegmentsToR2` stub return is kept in sync.
- **Backfilling clips/links for lessons already exported.**

## Implementation approach

### 1. Config contract — a per-step `publishLessonId`

A step may declare `publishLessonId`: the lesson namespace its recording publishes under. Absent/empty → the lesson being exported (today's behavior). Lesson `b` includes the ask steps tagged `"publishLessonId": "a"` (Task 5; template in Notes).

The recorder, scoring, and recap are unaffected: the step is a normal `friendClosedResponse`, and because its `simpleVideoUrl` prompt is a system prompt (not `-response-NN`), the `recapSources: "friend"` recap still only concatenates the friend's prompt clips — the responder's own webcam recordings (answers **and** questions) are all included as `webcam` segments automatically.

### 2. Pure helpers — `src/modules/video/video-processor-logic.js`

Thin, testable functions (the file must stay platform-agnostic: no `window`/`document`/`navigator`, no URL scheme):

```js
// The lesson a step's clip publishes under. Steps tagged `publishLessonId`
// upload under that lesson (ask steps embedded in an answer lesson publish as
// lesson 'a'); everything else uses the lesson being exported.
export function resolvePublishLessonId(step, defaultLessonId) {
    return (step && step.publishLessonId) || defaultLessonId;
}

// Assigns each publishable segment its { lessonId, index } (index is 1-based and
// restarts per target lesson, in input order). Precomputed from position so a
// failed segment leaves a gap — it never renumbers the segments after it.
export function assignSegmentTargets(publishable, defaultLessonId) {
    const counts = {};
    return (publishable || []).map((step) => {
        const lessonId = resolvePublishLessonId(step, defaultLessonId);
        const index = (counts[lessonId] || 0) + 1;
        counts[lessonId] = index;
        return { lessonId, index };
    });
}

// The R2 key for a user-generated segment.
export function buildUgcSegmentKey({ shareCode, courseId, lessonId, index }) {
    return `videos/${shareCode}-${courseId}-${lessonId}-response-${String(index).padStart(2, '0')}.mp4`;
}
```

### 3. Planner carries the target — `generatePlan()` / `_getPublishLessonId`

- Add `_getPublishLessonId(rec)`: looks up `this._getLesson(rec)?.steps?.[rec.originalStepIndex]?.publishLessonId || null`.
- Add `publishLessonId: this._getPublishLessonId(rec)` to the `webcam` plan step (alongside `thumbBlob`, `trim`, …). The `remote` and `tailing` steps are unchanged.

### 4. Exporter groups by target — `exportSegmentsToR2` (`video-processor.web.js`)

- Compute `const targets = assignSegmentTargets(publishable, lessonId);` once, before the upload loop, and `const courseId = appStore.getState().courseId;` once.
- For each successfully rendered/transcoded segment use `targets[i]`:
  ```js
  const { lessonId: targetLessonId, index } = targets[i];
  const key = buildUgcSegmentKey({ shareCode, courseId, lessonId: targetLessonId, index });
  ```
- Track `askPublished`: set to `true` when a segment uploads under a lesson other than the exported one (`targetLessonId !== lessonId`).
- Return `{ count: publishable.length, succeeded, askPublished }`; every early return becomes `{ count: 0, succeeded: 0, askPublished: false }`.
- Numbering is keyed off `targets[i]` (position), **not** `i`/`succeeded`, so a failed ask segment leaves a gap (`response-01`, `response-03`) rather than shifting later clips — matching the existing "one key per step position" behavior.

### 5. Link trigger — `resolveFriendLessonLink` + `SuccessButtons`

- `resolveFriendLessonLink({ configData, lessonId, courseId, shareCode, succeeded, askPublished = false })`: replace the `lessonId !== ASK_LESSON_ID → null` early return with `if (lessonId !== ASK_LESSON_ID && !askPublished) return null;`. The other guards (`succeeded`, `shareCode`, `courseId`, config contains lesson `b`) are unchanged, and the payload is still `{ courseId, shareCode }` (target is always `b`).
- `SuccessButtons.runProcessing` passes `askPublished: exportResult?.askPublished` into the resolver. Everything else (mutation, non-fatal catch, CTA) is unchanged.
- Native stub returns `{ count: 0, succeeded: 0, askPublished: false }`.

### 6. Edge cases

- **Course `b` with no ask steps** (unconverted config): `askPublished` stays false and `lessonId === 'b'` → no link (existing behavior preserved).
- **Existing `a` export**: `lessonId === 'a'` → link created as today, regardless of `askPublished`.
- **All ask steps in text mode** (null blobs): filtered from `publishable` → `askPublished` false → no link (same as today's text-mode limitation).
- **Partial ask upload failure**: the successful ask clips keep their step-aligned numbers (`01`,`03`), consistency preserved; the friend simply 404s the missing one, exactly as a partially-published `a` lesson does today.
- **`publishLessonId` set on a step in lesson `a`** (not expected): it publishes under that lesson; `askPublished` becomes true if it differs from `a`. Harmless.
- **Retries**: storage dedupes by `originalStepIndex`, so each step contributes at most one recording and numbering stays stable.
- **Non-friend lessons**: no `publishLessonId` anywhere → targets all equal the exported lesson → byte-identical behavior and keys.

## Tasks

### Task 1 - Pure helpers (`src/modules/video/video-processor-logic.test.js`)

- `resolvePublishLessonId({ publishLessonId: 'a' }, 'b')` / `({}, 'b')` / `(null, 'b')` / `({ publishLessonId: '' }, 'b')` / `({ publishLessonId: null }, 'b')`
  - → `'a'` / `'b'` / `'b'` / `'b'` / `'b'`
- `assignSegmentTargets([{}, { publishLessonId: 'a' }, { publishLessonId: 'a' }], 'b')`
  - → `[{ lessonId: 'b', index: 1 }, { lessonId: 'a', index: 1 }, { lessonId: 'a', index: 2 }]`
- `assignSegmentTargets([{ publishLessonId: 'a' }, { publishLessonId: 'a' }, {}], 'b')`
  - → `[{ lessonId: 'a', index: 1 }, { lessonId: 'a', index: 2 }, { lessonId: 'b', index: 1 }]` (numbering restarts per target)
- `assignSegmentTargets(null, 'b')` / `([], 'b')`
  - → `[]`
- `assignSegmentTargets` with 12+ segments targeting the same lesson
  - → the 10th is `index: 10` and the 12th `index: 12` (no pad truncation in the assignment; keys pad to 2)
- `buildUgcSegmentKey({ shareCode: 'ab12', courseId: 'friend', lessonId: 'a', index: 1 })`
  - → `'videos/ab12-friend-a-response-01.mp4'`
- `buildUgcSegmentKey({ shareCode: 'ab12', courseId: 'model', lessonId: 'b', index: 12 })`
  - → `'videos/ab12-model-b-response-12.mp4'`
- `src/modules/video/video-processor-logic.js` read as source text
  - → contains no `window`/`document`/`navigator` and no URL scheme (existing platform-agnostic guard still passes)

### Task 2 - Planner carries `publishLessonId` (`src/modules/video/video-processor-logic.test.js`)

- Planner built with a lesson whose `steps[1]` has `publishLessonId: 'a'` and `steps[0]` has none, plus recordings for `originalStepIndex` 0 and 1, `generatePlan()`
  - → the `webcam` step for `originalStepIndex` 0 has `publishLessonId === null`
  - → the `webcam` step for `originalStepIndex` 1 has `publishLessonId === 'a'`
- Planner built with a config where the step index has no entry (recording references a missing step)
  - → the `webcam` step's `publishLessonId` is `null`
- Planner built with recordings but no `configData.lessons`
  - → every `webcam` step's `publishLessonId` is `null`

### Task 3 - Export target grouping + wiring (`src/modules/user/friend-lesson-link-wiring.test.js` updated)

- `exportSegmentsToR2` source inspected (`src/modules/video/video-processor.web.js`)
  - → computes `assignSegmentTargets(publishable, lessonId)` before the upload loop
  - → builds the key via `buildUgcSegmentKey({ shareCode, courseId, lessonId: targetLessonId, index })` (no inline `videos/` template remains)
  - → sets `askPublished` when a segment uploads under a target other than the exported lesson
  - → every early return yields `{ count: 0, succeeded: 0, askPublished: false }`
  - → the final return yields `{ count: publishable.length, succeeded, askPublished }`
- `src/components/widgets/SuccessButtons.jsx` source inspected
  - → passes `askPublished: exportResult?.askPublished` into `resolveFriendLessonLink`
  - → still gates on `succeeded: exportResult?.succeeded` and still catches/logs `R2 publish / friend link failed (non-fatal)`
- `src/modules/video/video-processor.native.jsx` source inspected
  - → the stub returns `{ count: 0, succeeded: 0, askPublished: false }`

### Task 4 - Link trigger for embedded ask clips (`src/modules/user/friend-lesson-link-logic.test.js`)

- `resolveFriendLessonLink` with `lessonId: 'b'`, `askPublished: true`, a config containing lesson `b`, `succeeded: 3`, `shareCode: 'ab12'`, `courseId: 'friend'`
  - → `{ courseId: 'friend', shareCode: 'ab12' }`
- `resolveFriendLessonLink` with `lessonId: 'b'`, `askPublished: false` (and default)
  - → `null` (a plain `b` export with no ask clips creates no link)
- `resolveFriendLessonLink` with `lessonId: 'a'`, `askPublished: false`
  - → `{ courseId, shareCode }` (existing ask flow unchanged)
- `resolveFriendLessonLink` with `lessonId: 'b'`, `askPublished: true`, but the config has no lesson `b`
  - → `null` (guard preserved)
- `resolveFriendLessonLink` with `lessonId: 'b'`, `askPublished: true`, but `succeeded: 0` / `shareCode: ''` / `courseId: ''`
  - → `null` for each

### Task 5 - Convert `friend.json` lesson `b` (`src/config/friend-lesson-link-config.test.js`)

- `src/config/friend.json` parsed + lesson `b` steps filtered by `publishLessonId === 'a'`
  - → exactly 3 such steps
  - → each is `responseType: 'friendClosedResponse'`
  - → none has a `-response-\d+` `simpleVideoUrl` (they are system prompts, so lesson `b`'s `recapSources: 'friend'` invariant still holds)
- `src/config/friend.json` parsed + lesson `b` steps whose `simpleVideoUrl` starts with `{friendCode}`
  - → exactly `['{friendCode}friend-a-response-01', '{friendCode}friend-a-response-02', '{friendCode}friend-a-response-03']` (answers intact)
- Every config file in `src/config/` parsed + every step inspected for `publishLessonId`
  - → only `friend.json` lesson `b` tags steps, only with `'a'`

## Technical Context

- **No new dependencies.** Reuses React 19.2.0, `@tanstack/react-query` 5.100.14, `zustand` 5.0.13, `@supabase/supabase-js` 2.112.4. Unit tests: vitest 4.1.6 + jsdom 29.1.1 (colocated `*.test.js`; `vitest.config.js` excludes `tests/**` and `*.spec.js`).
- **Key generation today** is inline at `video-processor.web.js:1352` and uses the exported lesson + loop index. `getUgcThumbKey(key)` derives the sibling `.jpg`, so the thumb follows the new key automatically.
- **Recordings** carry `originalLessonId`/`originalStepIndex` (`storage.web.js:63-64`); `getAllSpeechRecordingsForLesson(lessonId)` filters by `originalLessonId` and dedupes by step index (latest wins). The `webcam` plan step currently drops the step index, which is why the planner must carry `publishLessonId`.
- **Read path:** a friend's `b` lesson fetches the asker's clips via the literal slug `{friendCode}-<courseId>-a-response-NN` (e.g. `friend.json:191`); `{friendCode}` is substituted by `normalizeConfig` from the `?sharecode=` param. Nothing on the read side changes.
- **Link logic** (`friend-lesson-link-logic.js`): `ASK_LESSON_ID = 'a'`, `ANSWER_LESSON_ID = 'b'`, one `friend_links` entry per course, 48h render-time expiry. Story 012 / migration 004.
- **Platform-agnostic guard:** `video-processor-logic.test.js` asserts the source contains no `window`/`document`/`navigator` and no `http(s)://`; the new helpers must not introduce either (keys are `videos/...`, no scheme).
- **`friend.json` `b` steps** now include the ask question steps (Task 5). `SuccessScreen.jsx` classifies a friend lesson as `recapOverlay === 'shareCta'` and shows only Share — unchanged.
- **Existing tests that will need updating:** `friend-lesson-link-wiring.test.js` (return shape + `askPublished`), because `exportSegmentsToR2`'s contract changes. `video-processor-share-cta.test.js`, `model-config.test.js`, and the Playwright spec are unaffected.

## Notes

**Config template (applied to `friend.json` lesson `b` in Task 5; use the same shape for any other course that has `a`/`b`).** Append these to lesson `b` immediately before its `success` step — the ask lesson's question steps, each tagged `publishLessonId: "a"`. Use the course's own ask prompts and localized cue/subtitles (copy the shape from lesson `a`):

```json
{
  "cue": { "en": "Would you rather have a million dollars or live five years longer?",
           "es": "¿Preferirías tener un millón de dólares o vivir cinco años más?",
           "pt": "Você preferiria ter um milhão de dólares ou viver cinco anos a mais?",
           "bn": "আপনি কি দশ লাখ ডলার পেতে চান নাকি আরও পাঁচ বছর বাঁচতে চান?" },
  "responseType": "friendClosedResponse",
  "simpleVideoUrl": "testvideo02",
  "publishLessonId": "a",
  "subtitles": { "en": "Would you rather have a million dollars or live five years longer?", "es": "...", "pt": "...", "bn": "..." }
}
```

Repeat for the remaining two questions (`testvideo03`/`testvideo04`, or the course's equivalents). The `publishLessonId: "a"` is the only non-obvious field; without it the clips upload as `...-b-response-NN` and friends' `b` lessons will 404 them.

**Manual verification** (the R2/MediaRecorder path can't run in vitest; the mapping logic is covered by Tasks 1-5, but the end-to-end needs a real export):

1. `friend.json` lesson `b` already contains the ask question steps (`publishLessonId: "a"`, Task 5).
2. `npm run dev`, log in, open `/course/friend/lesson/b?sharecode=<a friend's code>` — complete the answers **and** the appended questions, then Generate.
3. Confirm R2 now has `videos/<yourCode>-friend-b-response-01..03.mp4` **and** `videos/<yourCode>-friend-a-response-01..03.mp4`.
4. Open `/<yourCode>` — the "Practice English with Me" link appears (created from the `b` export because ask clips published).
5. Have a second account open `/course/friend/lesson/b?sharecode=<yourCode>` — your three question clips play.
6. Regression: a course whose `b` has no ask steps creates no link on `b` export; a plain `a` export still creates the link.

**Review checklist (non-automatable/structural):**
- The inline `videos/...` template is gone from `video-processor.web.js`; key building lives in `buildUgcSegmentKey`.
- `assignSegmentTargets` is position-based, so failed uploads leave gaps, never renumber.
- Non-friend lessons (no `publishLessonId`) produce byte-identical keys to before.
- Comments and `console.log` statements preserved per `agents.md`.
