# Embed the concatenated video above the friend-challenge link, with multiple 48h entries

## Context

Story 012 added one "Practice English with Me" link per course to the public profile (`FriendLessonLinksSection.jsx`), stored in the `user_profiles.friend_links` jsonb map and removed at render time once `addedAt + 48h` passes. Story 021 later started uploading the concatenated end-of-lesson recap to R2 as `videos/<shareCode>-<courseId>-<lessonId>-complete.mp4` (same `videos/` namespace, 48h TTL, best-effort, skipped over 50 MB). Today the profile shows only the text link — the video the learner just made is nowhere on their profile.

This story puts the learner's concatenated recap **directly above** the link, on the public profile (`/<shareCode>`) **and** the signed-in owner's `/profile` page, and lets a profile hold **multiple** (video + link) entries, each with its own 48h countdown and its own removal at 48h. The link is always shown when in-window; the video is shown only when it is available.

Confirmed product decisions (user answers):
1. The video is the complete recap produced by the **same export** that created the link (entry stores the exported lesson id).
2. Multiple concurrent entries are supported; each export records an entry keyed per (course, lesson), each with its own video, link, and countdown.
3. If the video is unavailable, **show the link but not the video**.
4. The embedded video appears on the public profile and the owner's private profile.
5. A poster is shown instead of eagerly loading the video.

## Out of Scope

- **New R2 uploads or a new complete-video poster object.** The existing complete recap (`videos/<shareCode>-<courseId>-<lessonId>-complete.mp4`, story 021) is reused as-is. There is no `-complete.jpg`; the poster is the existing first-segment sibling `.jpg`.
- **Changing the R2 key scheme, the upload cap, or `uploadCompleteVideoToR2`.** The 50 MB best-effort behavior is untouched.
- **Changing `SHARE_WINDOW_HOURS`, `SHARE_URL_BASE`, the link target (`a` → `b`), the link copy, or the countdown format.**
- **A SQL migration.** `friend_links` stays a jsonb column (migration 004); only the app-side entry shape/keying changes. Migration 004 is not edited.
- **Backfilling a `lessonId` onto pre-existing `friend_links` entries.** Legacy entries (no `lessonId`) keep rendering their link but get no embedded video until the next export.
- **Cleanup/deletion of expired entries.** Expiry remains a render-time rule (story 012).
- **Autoplay or a modal/lightbox player.** The video is an inline `controls` element.
- **The owner's `/profile` native counterpart** (`UserProfile.native.jsx`) — native is not shipped.
- **New UI strings/translations.**

## Implementation approach

### 1. Complete-video URL + poster helpers — `src/modules/video/video-url.js` (extend)

The R2 bases are currently inline (`CDN_BASE`, `UGC_BASE`). Add a single root and two helpers:

```js
const R2_BASE = 'https://r2.ultrafastfluency.com/';
const CDN_BASE = `${R2_BASE}assets/videos/`;   // unchanged value
const UGC_BASE = `${R2_BASE}videos/`;          // unchanged value

// Full public URL for a `videos/` R2 key (e.g. from getCompleteVideoKey).
// `videos/` is never proxied in dev, so this is always an absolute URL.
export function getUgcVideoUrl(r2Key) {
    if (!r2Key || typeof r2Key !== 'string') return null;
    return `${R2_BASE}${r2Key}`;
}

// Public URL for the concatenated recap of a (shareCode, course, lesson).
export function getCompleteVideoUrl({ shareCode, courseId, lessonId } = {}) {
    return getUgcVideoUrl(getCompleteVideoKey({ shareCode, courseId, lessonId }));
}

// Poster for the complete video: the sibling .jpg of the lesson's first
// segment (`-response-01`), uploaded at publish time by exportSegmentsToR2.
// There is no -complete.jpg. Returns null when any part is missing. In dev this
// still resolves to an absolute R2 URL because -response-NN routes to videos/.
export function getCompleteVideoPosterUrl({ shareCode, courseId, lessonId } = {}) {
    if (!shareCode || !courseId || !lessonId) return null;
    return getPosterUrl(`${shareCode}-${courseId}-${lessonId}-response-01`);
}
```

`getCompleteVideoKey` (story 021) is unchanged. The `-complete` key does **not** match `isFriendVideoSlug` (`-response-NN`), so it must go through `getUgcVideoUrl`, never `getVideoUrl`.

### 2. Multiple entries + the exported lesson — `src/modules/user/friend-lesson-link-logic.js` (extend)

The map is re-keyed from `courseId` to `<courseId>:<lessonId>` so distinct complete videos can coexist. `resolveFriendLessonLink` adds `lessonId` (the exported lesson, i.e. the one whose recap was uploaded) to its payload; the **link target remains the fixed `ANSWER_LESSON_ID` ('b')**.

```js
// One entry per (course, lesson). A link can be created by an ask-lesson ('a')
// export or by an answer-lesson export that published ask clips ('b'); each
// carries its own complete video, so both may be present at once.
export function friendLinkEntryKey(entry) {
    return `${entry?.courseId}:${entry?.lessonId || 'legacy'}`;
}

// Immutable merge. Drops a legacy story-012 course-keyed entry (no `lessonId`)
// for the same course so the export migrates rather than duplicates; the new
// entry replaces any existing entry for the same (course, lesson).
export function upsertFriendLinkMap(existing, entry) {
    const map = (existing && typeof existing === 'object' && !Array.isArray(existing)) ? { ...existing } : {};
    if (map[entry.courseId] && !map[entry.courseId].lessonId) delete map[entry.courseId];
    return { ...map, [friendLinkEntryKey(entry)]: entry };
}

// ...existing getFriendLinkRemainingMs/isFriendLinkActive/formatFriendLinkRemaining/listActiveFriendLinks unchanged...

export function resolveFriendLessonLink({ configData, lessonId, courseId, shareCode, succeeded, askPublished = false }) {
    if (!succeeded || !shareCode || !courseId || !configData?.lessons) return null;
    if (lessonId !== ASK_LESSON_ID && !askPublished) return null;
    if (!configData.lessons.some((l) => l.lessonId === ANSWER_LESSON_ID)) return null;
    return { courseId, lessonId, shareCode };
}
```

Stored shape (new):

```json
{
  "friend:a": { "courseId": "friend", "lessonId": "a", "shareCode": "ab12", "addedAt": "2026-09-24T11:00:00.000Z" },
  "friend:b": { "courseId": "friend", "lessonId": "b", "shareCode": "ab12", "addedAt": "2026-09-24T12:00:00.000Z" }
}
```

Legacy shape (still readable, link only): `{ "friend": { "courseId": "friend", "shareCode": "ab12", "addedAt": "..." } }`.

**Decision (evidence):** re-exporting the *same* (course, lesson) replaces that entry rather than appending, because the R2 keys (`...-<lesson>-complete.mp4`, `...-<lesson>-response-NN`) are deterministic per lesson and are overwritten on re-export — an appended second entry would point at the same objects. Multiple entries come from distinct (course, lesson) pairs.

### 3. Record the lesson on export — no code change

`SuccessButtons.jsx` already does `friendLinkMutation.mutateAsync({ userId, entry: { ...payload, addedAt } })`, and `useAddFriendLinkMutation` merges via `upsertFriendLinkMap`. Because `resolveFriendLessonLink` now returns `lessonId`, the stored entry automatically carries it. `api.js` needs no change.

### 4. Video + link card — `src/components/profile/FriendLessonLinksSection.jsx` (extend)

`FriendLessonLink` gains a `videoFailed` state and renders the video above the anchor (no new strings, no data fetching; `video-url.js` is pure):

```jsx
function FriendLessonLink({ entry, lang, now }) {
    const [videoFailed, setVideoFailed] = useState(false);
    const remainingMs = getFriendLinkRemainingMs(new Date(entry.addedAt).getTime(), now);
    const url = buildFriendLessonLink({ courseId: entry.courseId, lessonId: ANSWER_LESSON_ID, shareCode: entry.shareCode });
    const videoUrl = entry.lessonId
        ? getCompleteVideoUrl({ shareCode: entry.shareCode, courseId: entry.courseId, lessonId: entry.lessonId })
        : null;
    const posterUrl = entry.lessonId
        ? getCompleteVideoPosterUrl({ shareCode: entry.shareCode, courseId: entry.courseId, lessonId: entry.lessonId })
        : null;
    return (
        <div style={cardStyle}>
            {videoUrl && !videoFailed && (
                <video
                    data-testid="friend-lesson-video"
                    src={videoUrl}
                    poster={posterUrl || undefined}
                    controls
                    playsInline
                    preload="none"
                    onError={() => setVideoFailed(true)}
                    style={{ display: 'block', width: '100%', maxHeight: '70vh', objectFit: 'contain', backgroundColor: '#000', borderRadius: '8px', marginBottom: '12px' }}
                />
            )}
            <a data-testid="friend-lesson-link" href={toFriendLessonHref(url)} style={/* unchanged */}>
                {Strings.get('profile_friend_lesson_link', lang)}
            </a>
            <p data-testid="friend-lesson-link-countdown" style={{ color: '#adb5bd', fontSize: '14px', margin: '8px 0 0' }}>
                {Strings.get('profile_friend_link_available', lang, { time: formatFriendLinkRemaining(remainingMs) })}
            </p>
        </div>
    );
}
```

**Decision (bandwidth + unavailability):** `preload="none"` means no video bytes are fetched until the user presses play; the poster (first-segment `.jpg`) is the visible thumbnail. If the object is missing/expired/never uploaded (>50 MB), the browser fires `error` on interaction, `videoFailed` hides the `<video>`, and the link + countdown remain. A legacy entry with no `lessonId` never renders a video.

The section's list key changes from `entry.courseId` to a per-entry key: `key={`${entry.courseId}:${entry.lessonId || 'legacy'}:${entry.addedAt}`}`. Everything else (the ticking clock, `listActiveFriendLinks`, `null` when empty) is unchanged.

### 5. Surfaces

- **Public profile** (`PublicProfile.jsx`): already renders `<FriendLessonLinksSection friendLinks={profile?.friendLinks} lang={lang} />` — no change.
- **Owner profile** (`UserProfile.jsx`): import `FriendLessonLinksSection` and render it inside the content column, after the header card and before the `Section` blocks:
  `<FriendLessonLinksSection friendLinks={profile?.friendLinks} lang={lang} />`.
  `useUserProfile()` selects `*` and `fromDbRow` already aliases `friendLinks: row.friend_links`, so no data change.

### 6. Edge cases

- **Video object missing** (>50 MB skip, upload failure, or expired): `onError` hides the `<video>`; the link + countdown still render.
- **Legacy entry without `lessonId`**: link renders, no video.
- **Legacy entry migrated**: the next export for that course deletes the course-keyed entry and writes a `<course>:<lesson>` entry.
- **Two lessons in one course** (an `a` export then a `b`+ask export): two entries → two cards, each with its own video/countdown (`friend:a`, `friend:b`).
- **Re-export of the same lesson**: that entry's `addedAt` resets; the key is unchanged (replace, not duplicate).
- **Exactly 48h old**: `remainingMs === 0` → inactive → entry removed (boundary unchanged).
- **Malformed / non-object / array `friendLinks`**: `listActiveFriendLinks` → `[]` → section renders nothing.
- **Missing/empty `shareCode`/`courseId`/`lessonId` on a new entry**: `getCompleteVideoUrl`/`getCompleteVideoPosterUrl` return null → no video; link still builds (existing behavior).
- **Non-array/empty `video-url` inputs**: helpers return `null`, never throw.

## Tasks

### Task 1 - Complete-video URL + poster helpers (`src/modules/video/video-url.test.js`, extend existing)

- `getUgcVideoUrl('videos/ab12-friend-a-complete.mp4')`
  - → `'https://r2.ultrafastfluency.com/videos/ab12-friend-a-complete.mp4'`
- `getUgcVideoUrl(null)` / `('')` / `(undefined)` / `(42)`
  - → `null` for each
- `getCompleteVideoUrl({ shareCode: 'ab12', courseId: 'friend', lessonId: 'a' })`
  - → `'https://r2.ultrafastfluency.com/videos/ab12-friend-a-complete.mp4'`
- `getCompleteVideoUrl({ shareCode: 'ab12', courseId: 'friend', lessonId: 'b' })` and `({ shareCode: 'ab12', courseId: 'model', lessonId: 'w' })`
  - → `'.../videos/ab12-friend-b-complete.mp4'` / `'.../videos/ab12-model-w-complete.mp4'`
- `getCompleteVideoUrl` with any missing part / `{}` / no arg
  - → `null` for each
- `getCompleteVideoPosterUrl({ shareCode: 'ab12', courseId: 'friend', lessonId: 'a' })`
  - → `'https://r2.ultrafastfluency.com/videos/ab12-friend-a-response-01.jpg'`
- `getCompleteVideoPosterUrl` with any missing part / `{}` / no arg
  - → `null` for each
- `getCompleteVideoUrl(...)` / `getCompleteVideoPosterUrl(...)` for `friend/a`
  - → the video URL ends `.mp4` and contains `/videos/`; the poster ends `.jpg` and contains `/videos/`
- existing `getVideoUrl` / `getPosterUrl` / `getUgcThumbKey` / `getCompleteVideoKey` cases
  - → still pass unchanged (regression)

### Task 2 - Multiple-entry keying + `lessonId` payload (`src/modules/user/friend-lesson-link-logic.test.js`, update existing)

- `friendLinkEntryKey({ courseId: 'friend', lessonId: 'a' })`
  - → `'friend:a'`
- `friendLinkEntryKey({ courseId: 'friend' })` / `({ courseId: 'friend', lessonId: '' })`
  - → `'friend:legacy'` for each
- `upsertFriendLinkMap(null, entryA)` and `upsertFriendLinkMap({}, entryA)` where `entryA = { courseId: 'friend', lessonId: 'a', shareCode: 'ab12', addedAt }`
  - → `{ 'friend:a': entryA }` for each
- `upsertFriendLinkMap({ 'friend:a': entryA }, entryB)` where `entryB.courseId === 'friend'`, `entryB.lessonId === 'b'`
  - → keys `['friend:a', 'friend:b']` (multiple entries coexist)
- `upsertFriendLinkMap({ 'friend:a': oldA }, newA)` with the same course+lesson
  - → `{ 'friend:a': newA }` (replace, `addedAt` updated)
- `upsertFriendLinkMap({ friend: legacyEntry }, entryA)` (legacy migration)
  - → no `friend` key remains; the result has only `'friend:a'` mapped to `entryA`
- `upsertFriendLinkMap({ 'friend:a': entryA }, entryOtherB)` where `entryOtherB.courseId === 'other'`
  - → keys include both `'friend:a'` and `'other:b'`
- `upsertFriendLinkMap` called with an input map
  - → the input object is not mutated
- `upsertFriendLinkMap('x', entryA)` / `([entryA], entryA)`
  - → `{ 'friend:a': entryA }` for each
- `listActiveFriendLinks` with a legacy entry (no `lessonId`) and a new entry
  - → both returned, sorted newest first, and the legacy entry is returned unchanged (still has no `lessonId`)
- `listActiveFriendLinks` with an entry exactly 48h old / missing / invalid `addedAt`
  - → excluded (boundary unchanged)
- `listActiveFriendLinks(null, now)` / `({}, now)` / `('x', now)` / `([entry], now)`
  - → `[]` for each
- `resolveFriendLessonLink({ configData: configWithB, lessonId: 'a', courseId: 'friend', shareCode: 'ab12', succeeded: 3 })`
  - → `{ courseId: 'friend', lessonId: 'a', shareCode: 'ab12' }`
- `resolveFriendLessonLink({ ..., lessonId: 'b', askPublished: true, succeeded: 3 })`
  - → `{ courseId: 'friend', lessonId: 'b', shareCode: 'ab12' }`
- `resolveFriendLessonLink` with `lessonId: 'b'` and no `askPublished`, `succeeded: 0`, `shareCode: ''`, `courseId: ''`, a config without lesson `b`, `configData: null`/`undefined`
  - → `null` for each (guards unchanged)

### Task 3 - Video + link card (`src/components/profile/FriendLessonLinksSection.jsx`; new `src/components/profile/FriendLessonLinksSection.test.js`)

Rendered with `createRoot` + `act` (pattern from `src/components/intro-caller-name.test.js`), `globalThis.IS_REACT_ACT_ENVIRONMENT = true`; no network; `Date.now()` is real so entries use `new Date().toISOString()`. Fixtures use `shareCode: 'ab12'`.

- an entry `{ courseId: 'friend', lessonId: 'a', shareCode: 'ab12', addedAt: now }`
  - → `[data-testid="friend-lesson-video"]` count is `1`
  - → its `src` is `'https://r2.ultrafastfluency.com/videos/ab12-friend-a-complete.mp4'`
  - → its `poster` is `'https://r2.ultrafastfluency.com/videos/ab12-friend-a-response-01.jpg'`
  - → it has `controls`, `playsInline`, and `preload="none"`
  - → the video precedes `[data-testid="friend-lesson-link"]` in document order
  - → the link's `href` is `'https://ultrafastfluency.com/course/friend/lesson/b?shareCode=ab12'` (target stays lesson `b`)
- an entry with no `lessonId` (legacy)
  - → `[data-testid="friend-lesson-video"]` count is `0`
  - → `[data-testid="friend-lesson-link"]` count is `1`
- an entry with `lessonId` after dispatching an `error` event on `[data-testid="friend-lesson-video"]`
  - → `[data-testid="friend-lesson-video"]` count is `0`
  - → `[data-testid="friend-lesson-link"]` count is `1` (link kept)
- two entries `friend:a` and `friend:b`, both active
  - → `[data-testid="friend-lesson-video"]` count is `2`
  - → `[data-testid="friend-lesson-link"]` count is `2`
- one active entry and one entry exactly 48h old
  - → `[data-testid="friend-lesson-video"]` count is `1` and `[data-testid="friend-lesson-link"]` count is `1`
- `friendLinks` `{}` / `null` / `[]` / `'x'`
  - → `[data-testid="friend-lesson-links"]` count is `0`

### Task 4 - Private-profile surface (`src/components/profile/UserProfile.jsx`; source guard `src/components/profile/user-profile-friend-links.test.js`, new)

- `UserProfile.jsx` source, comments stripped
  - → imports `FriendLessonLinksSection` from `./FriendLessonLinksSection.jsx`
  - → renders `<FriendLessonLinksSection` with a `friendLinks` prop (the profile's `friendLinks`)
- `src/components/profile/FriendLessonLinksSection.test.js` (Task 3)
  - → passes (shared behavior, no page-specific code)

### Task 5 - Export payload wiring (`src/modules/user/friend-lesson-link-wiring.test.js`, extend existing)

- `friend-lesson-link-logic.js` source
  - → `resolveFriendLessonLink`'s success return contains `lessonId` (e.g. `return { courseId, lessonId, shareCode };`)
- `SuccessButtons.jsx` source
  - → the friend-link mutation entry spreads the resolver payload (`entry: { ...payload, addedAt`)
  - → existing assertions (`friendLinkMutation.mutateAsync({`, `succeeded: exportResult?.succeeded`, `askPublished: exportResult?.askPublished`, `R2 publish / friend link failed (non-fatal)`) still pass
- `api.js` source
  - → still merges through `upsertFriendLinkMap(row?.friend_links, entry)` (no change required)

### Task 6 - Browser behavior (`tests/friend-lesson-link.spec.js`, update existing Playwright)

Fixtures now include `lessonId`. `beforeEach` also routes `'**r2.ultrafastfluency.com/**'` to `route.abort()` (no real R2 traffic; a failed poster does not fire the video's `error`, and `preload="none"` never fetches the video).

- `/friendtest1` loaded with a `friend:a` entry (`lessonId: 'a'`) added 1h ago
  - → `[data-testid="friend-lesson-video"]` is visible
  - → its `src` is `'https://r2.ultrafastfluency.com/videos/friendtest1-friend-a-complete.mp4'`
  - → its `poster` is `'https://r2.ultrafastfluency.com/videos/friendtest1-friend-a-response-01.jpg'`
  - → it precedes `[data-testid="friend-lesson-link"]` in the DOM
  - → the existing link/countdown assertions still pass
- `/friendtest1` loaded with a `friend` entry with no `lessonId`
  - → `[data-testid="friend-lesson-video"]` count is `0`
  - → `[data-testid="friend-lesson-link"]` is visible
- `/friendtest1` loaded with a `friend:a` entry, then an `error` event dispatched on the video
  - → `[data-testid="friend-lesson-video"]` count is `0`
  - → `[data-testid="friend-lesson-link"]` is visible
- `/friendtest1` loaded with `friend:a` and `friend:b` entries, both active
  - → `[data-testid="friend-lesson-video"]` count is `2`
  - → `[data-testid="friend-lesson-link"]` count is `2`
- existing expiry / empty / unresolved-profile / two-course cases
  - → still pass

## Technical Context

- **No new dependencies.** Reuses React 19.2.0, `@tanstack/react-query` 5.100.14, `zustand` 5.0.13, `@supabase/supabase-js` 2.112.4, `react-router-dom` 7.15.1. Unit tests: vitest 4.1.6 + jsdom 29.1.1 (colocated `*.test.js`; `vitest.config.js` excludes `tests/**` and `*.spec.js`). Browser tests: `@playwright/test` 1.60.0 (`tests/*.spec.js`, `playwright.config.js`, `webServer: npx vite --port 5173`). Gate: `npm test -- --run`; the Playwright spec is supplementary (outside the vitest gate).
- **R2 URL routing (`video-url.js`):** `isFriendVideoSlug` matches `-response-\d+$` only, so `-complete` keys must use `getUgcVideoUrl` (never `getVideoUrl`, which would build an `assets/videos/` URL). `videos/` is not proxied in dev (`README.md:15`, `vite.config.js` proxies `/assets/videos/` + `/whisper/` only), so UGC URLs are always absolute.
- **Poster availability:** `exportSegmentsToR2` uploads each segment's `thumbBlob` as `<segment-key>.jpg` (`video-processor.web.js:1379-1385`). The first segment targeting the exported lesson (`-response-01`) therefore has a sibling poster. `friend.json` lesson `a` (`recapSources: "none"`) starts its recap with that first question clip; lesson `b` (`recapSources: "friend"`) starts with the friend's remote clip, so for a `b` entry the poster is the responder's first answer rather than the video's first frame (acceptable; it is a real frame of the user).
- **Complete video availability:** `uploadCompleteVideoToR2` is best-effort and skips uploads over `MAX_R2_UPLOAD_BYTES` (`src/modules/video/r2-upload-limits.js`), and all `videos/` objects expire at 48h. The `onError` path is the contract for "link yes, video no".
- **Data access:** `fromDbRow` already aliases `friendLinks: row.friend_links` (`api.js:64`); `useUserByShareCode`'s `SAFE_COLS` already includes `friend_links` (`api.js:298`); `useAddFriendLinkMutation` already merges via `upsertFriendLinkMap` (`api.js:324-346`). No Supabase query or grant change; the anon `public_profiles` view still exposes only link data (now also `lessonId`).
- **Entry shape is app-side jsonb only:** migration `004` is unchanged, and its static guard (`src/modules/api/friend-links-migration.test.js`) stays green.
- **Existing guards to preserve:** `friend-lesson-link-wiring.test.js` (`upsertFriendLinkMap(row?.friend_links, entry)`), `friend-links-migration.test.js`, and `video-url.test.js`'s `no POSTER_BASE / assets/posters` assertions.
- **Playwright determinism:** `page.clock.setFixedTime` + `queryClient.setQueryData` injection (pattern already in the spec); route Supabase and R2 so nothing escapes.

## Notes

- **Confirmed product decisions (user answers):** (1) embed the complete recap from the same export; (2) support multiple concurrent (video, link) entries; (3) show the link but not the video when the video is unavailable; (4) show on both the public and private profile; (5) show a poster rather than eagerly loading the video.
- **Decision (evidence):** entries are keyed `<courseId>:<lessonId>` and re-export of the same lesson replaces (not appends) that entry, because the R2 object keys are deterministic per lesson and are overwritten. Multiple entries therefore come from distinct (course, lesson) pairs. If product later wants distinct numbered rounds, the R2 key scheme must change (a separate story), not just the map key.
- **Decision:** the embedded video is the exported lesson's complete recap (`lessonId` in the entry). A legacy story-012 entry has no `lessonId`, so its link renders without a video until the next export. Backfilling an inferred `lessonId` was rejected as a guess (entries created by the `b`+ask path would be misidentified).
- **Decision:** `preload="none"` + the first-segment poster keeps the profile light (no video bytes until play) and makes the Playwright test deterministic; unavailability is detected on play via `onError`, which hides the video and keeps the link. This is the user's "poster rather than loading the entire video" preference.
- **No new strings:** the card reuses `profile_friend_lesson_link` and `profile_friend_link_available`; the `<video>` is unlabeled. `src/data/strings.test.js` is unaffected.
- **Documentation (non-automatable):** during implementation, update `docs/product.md` — extend the "Friend-challenge practice link" feature bullet to mention the embedded concatenated video and multiple per-(course, lesson) entries with independent 48h removal, and add a Known Limitation that the video is best-effort (hidden, while the link persists, when the R2 object is missing/expired/over 50 MB) and that pre-existing entries without a `lessonId` show no video. Optionally note the new `getCompleteVideoUrl`/`getCompleteVideoPosterUrl` helpers in `agents.md`'s concatenated-recap paragraph.
- **Manual verification** (R2/MediaRecorder and Supabase cannot be exercised headlessly; logic/UI are covered by Tasks 1-5):
  1. `npm run dev`, log in, complete and export `/course/friend/lesson/a`; confirm `videos/<code>-friend-a-complete.mp4` and `<code>-friend-a-response-01.jpg` exist on R2.
  2. Open `/<code>` logged out: the video card sits above "Practice English with Me" with the poster, and the countdown reads ~48h.
  3. Open `/profile`: the same card appears for the owner.
  4. Delete/rename the complete object on R2, reload, press play: the video disappears, the link and countdown remain.
  5. Set an entry's `addedAt` to exactly 48h ago: the whole card (video + link) is gone.
