# Embed the concatenated video above the friend-challenge link, with multiple 48h entries

## Context

Story 012 added one "Practice English with Me" link per course to the public profile (`FriendLessonLinksSection.jsx`), stored in the `user_profiles.friend_links` jsonb map and removed at render time once `addedAt + 48h` passes. Story 021 later started uploading the concatenated end-of-lesson recap to R2 as `videos/<shareCode>-<courseId>-<lessonId>-complete.mp4` (same `videos/` namespace, 48h TTL, best-effort, skipped over 50 MB). Today the profile shows only the text link — the video the learner just made is nowhere on their profile.

This story puts the learner's concatenated recap **directly above** the link, on the public profile (`/<shareCode>`) **and** the signed-in owner's `/profile` page, and lets a profile hold **multiple** (video + link) entries, each with its own 48h countdown and its own removal at 48h. The link is always shown when in-window; the video is shown only when it is available.

**Author asymmetry (drives the key scheme).** An **A** (ask) video is single-author: the asker records their own questions, so `videos/<creator>-<courseId>-a-complete.mp4` is correct. A **B** (answer) video is **co-authored**: it concatenates the *other* participant's question clips (fetched from `<asker>-<courseId>-a-response-NN`, `friend.json:191/227/275`) with the responder's answers **and** the responder's own new questions (`publishLessonId: "a"`). It therefore involves two share codes, but today's key names only the responder — which is exactly why a second B run with a different friend overwrites the first. This story adds the co-participant's code to the B key and to the `friend_links` entry, so two-friend sessions survive as separate cards.

Confirmed product decisions (user answers):
1. The video is the complete recap produced by the **same export** that created the link (the entry stores the exported lesson id).
2. Multiple concurrent entries are supported; each export records an entry keyed per (course, lesson, co-participant), each with its own video, link, and countdown.
3. If the video is unavailable, **show the link but not the video**.
4. The embedded video appears on the public profile and the owner's private profile.
5. A poster is shown instead of eagerly loading the video.
6. A B video is co-authored, so its key carries **both** share codes; an A video stays single-code.
7. Each card's link still points at the creator's own questions (`/course/<course>/lesson/b?shareCode=<creator>`), so two B cards share a target but show different session videos.
8. The co-authored B video is surfaced **only on the creator's profile**; showing it on the other participant's profile needs a server-side cross-user write and is a separate story.

## Out of Scope

- **Cross-posting a co-authored B video to the other participant's profile.** Entries are written only to the exporter's own row (RLS `auth.uid() = id`); a cross-user surface would need a `SECURITY DEFINER` write like `record_friend_response` (story 019).
- **Per-participant keys for the responder's own `b` segments or the complete poster.** Segment keys stay `videos/<creator>-<courseId>-<lessonId>-response-NN.mp4`; the ask clips fetched by friends stay the fixed `<creator>-<courseId>-a-response-NN` slugs. Only the complete B key gains the co-participant code.
- **New R2 objects or a `-complete.jpg`.** The poster is an existing first-segment sibling `.jpg`.
- **Changing the upload cap, `uploadCompleteVideoToR2`'s best-effort behavior, or the Cloudflare Function.**
- **Changing `SHARE_WINDOW_HOURS`, `SHARE_URL_BASE`, the link target (`a` → `b`), the link copy, or the countdown format.**
- **A SQL migration.** `friend_links` stays a jsonb column (migration 004); only the app-side entry shape/keying changes. Migration 004 is not edited.
- **Backfilling `lessonId`/`otherShareCode` onto pre-existing entries.** Legacy entries keep rendering their link but get no embedded video until the next export.
- **Cleanup/deletion of expired entries.** Expiry remains a render-time rule (story 012).
- **Autoplay or a modal/lightbox player.** The video is an inline `controls` element.
- **The native profiles** (`UserProfile.native.jsx`) — native is not shipped.
- **New UI strings/translations.**

## Implementation approach

### 1. Complete-video key/URL + segment poster — `src/modules/video/video-url.js` (extend)

Add one root and the new helpers; `getCompleteVideoKey` gains an optional co-participant code (which must come **after** the creator's code so the Cloudflare Function's namespace check still passes):

```js
const R2_BASE = 'https://r2.ultrafastfluency.com/';
const CDN_BASE = `${R2_BASE}assets/videos/`;   // unchanged value
const UGC_BASE = `${R2_BASE}videos/`;          // unchanged value

// Full public URL for a `videos/` R2 key. `videos/` is never proxied in dev,
// so this is always absolute.
export function getUgcVideoUrl(r2Key) {
    if (!r2Key || typeof r2Key !== 'string') return null;
    return `${R2_BASE}${r2Key}`;
}

// Concatenated-recap key. A co-authored answer recap embeds the other
// participant's share code after the creator's, so two B sessions with two
// friends never collide while the key still starts `videos/<creator>-`.
export function getCompleteVideoKey({ shareCode, courseId, lessonId, otherShareCode } = {}) {
    if (!shareCode || !courseId || !lessonId) return null;
    const other = (typeof otherShareCode === 'string' && otherShareCode) ? `${otherShareCode}-` : '';
    return `videos/${shareCode}-${other}${courseId}-${lessonId}-complete.mp4`;
}

export function getCompleteVideoUrl({ shareCode, courseId, lessonId, otherShareCode } = {}) {
    return getUgcVideoUrl(getCompleteVideoKey({ shareCode, courseId, lessonId, otherShareCode }));
}

// Sibling .jpg of a segment: `<code>-<courseId>-<lessonId>-response-01`.
// Used for the recap's first clip (see resolveRecapFirstClip).
export function getSegmentPosterUrl({ shareCode, courseId, lessonId } = {}) {
    if (!shareCode || !courseId || !lessonId) return null;
    return getPosterUrl(`${shareCode}-${courseId}-${lessonId}-response-01`);
}
```

Examples:

| creator | other | course | lesson | key |
|---|---|---|---|---|
| `ab12` | — | `friend` | `a` | `videos/ab12-friend-a-complete.mp4` |
| `ab12` | — | `friend` | `b` | `videos/ab12-friend-b-complete.mp4` |
| `ab12` | `cd34` | `friend` | `b` | `videos/ab12-cd34-friend-b-complete.mp4` |

`otherShareCode: ''`/`null`/`undefined` reproduces the single-code key exactly (story 021 unchanged). The `-complete` key does **not** match `isFriendVideoSlug` (`-response-NN`), so it must go through `getUgcVideoUrl`, never `getVideoUrl`.

### 2. Multiple entries + the co-participant — `src/modules/user/friend-lesson-link-logic.js` (extend)

The map is re-keyed from `courseId` to `<courseId>:<lessonId>[:<otherShareCode>]`. `resolveFriendLessonLink` adds `lessonId` and `otherShareCode` to its payload; the **link target remains the fixed `ANSWER_LESSON_ID` ('b')**.

```js
// One entry per (course, lesson) — plus the co-participant for a co-authored
// answer recap, so the same user answering friend 1 and friend 2 keeps two.
export function friendLinkEntryKey(entry) {
    const lesson = entry?.lessonId || 'legacy';
    const other = entry?.otherShareCode ? `:${entry.otherShareCode}` : '';
    return `${entry?.courseId}:${lesson}${other}`;
}

// Immutable merge. Drops a legacy story-012 course-keyed entry (no `lessonId`)
// for the same course so the export migrates rather than duplicates; the new
// entry replaces any existing entry for the same key.
export function upsertFriendLinkMap(existing, entry) {
    const map = (existing && typeof existing === 'object' && !Array.isArray(existing)) ? { ...existing } : {};
    if (map[entry.courseId] && !map[entry.courseId].lessonId) delete map[entry.courseId];
    return { ...map, [friendLinkEntryKey(entry)]: entry };
}

// The recap's actual first clip — its poster. An ask recap opens with the
// creator's own questions; a co-authored answer recap opens with the other
// participant's question clips (recapSources 'friend'); an answer recap with no
// other participant opens with the creator's own answers. Pure; null when a
// required part is missing.
export function resolveRecapFirstClip({ shareCode, courseId, lessonId, otherShareCode } = {}) {
    if (!shareCode || !courseId || !lessonId) return null;
    if (lessonId === ASK_LESSON_ID) return { shareCode, courseId, lessonId: ASK_LESSON_ID };
    if (otherShareCode) return { shareCode: otherShareCode, courseId, lessonId: ASK_LESSON_ID };
    return { shareCode, courseId, lessonId: ANSWER_LESSON_ID };
}

// ...existing getFriendLinkRemainingMs/isFriendLinkActive/formatFriendLinkRemaining/listActiveFriendLinks unchanged...

export function resolveFriendLessonLink({ configData, lessonId, courseId, shareCode, succeeded, askPublished = false, otherShareCode = '' }) {
    if (!succeeded || !shareCode || !courseId || !configData?.lessons) return null;
    if (lessonId !== ASK_LESSON_ID && !askPublished) return null;
    if (!configData.lessons.some((l) => l.lessonId === ANSWER_LESSON_ID)) return null;
    // Only a co-authored answer export carries the other participant's code.
    const other = (askPublished && lessonId !== ASK_LESSON_ID) ? String(otherShareCode || '') : '';
    return { courseId, lessonId, shareCode, otherShareCode: other };
}
```

Stored shape (new):

```json
{
  "friend:a":      { "courseId": "friend", "lessonId": "a", "shareCode": "ab12", "otherShareCode": "",     "addedAt": "2026-09-24T11:00:00.000Z" },
  "friend:b:cd34": { "courseId": "friend", "lessonId": "b", "shareCode": "ab12", "otherShareCode": "cd34", "addedAt": "2026-09-24T12:00:00.000Z" },
  "friend:b:ef56": { "courseId": "friend", "lessonId": "b", "shareCode": "ab12", "otherShareCode": "ef56", "addedAt": "2026-09-24T13:00:00.000Z" }
}
```

Legacy shape (still readable, link only): `{ "friend": { "courseId": "friend", "shareCode": "ab12", "addedAt": "..." } }`.

**Decision (evidence):** re-exporting the *same* key replaces that entry rather than appending, because the underlying R2 keys are deterministic per key and are overwritten. Multiple entries come from distinct (course, lesson, co-participant) tuples. `appStore.friendCode` is already trimmed + lowercased at capture (`App.jsx:30`), so the stored `otherShareCode` matches the R2 namespace.

### 3. Record the co-participant on export — `src/components/widgets/SuccessButtons.jsx`

Inside the existing `if (publishSegments)` block, compute the co-participant once from the export result and pass it to both the complete-video upload and the link resolver:

```js
const exportResult = await exportSegmentsToR2(lessonId);
const { configData, courseId, userData } = appStore.getState();
// A co-authored B recap carries the other participant's code into its key.
const otherShareCode = exportResult?.askPublished ? appStore.getState().friendCode : null;
uploadCompleteVideoToR2(result.blob, lessonId, otherShareCode)
  .catch((e) => console.error('[Success] complete-video upload failed (non-fatal):', e));
const payload = resolveFriendLessonLink({
  configData, lessonId, courseId,
  shareCode: userData?.shareCode,
  succeeded: exportResult?.succeeded,
  askPublished: exportResult?.askPublished,
  otherShareCode,
});
if (payload) {
  await friendLinkMutation.mutateAsync({ userId: userData.$id, entry: { ...payload, addedAt: new Date().toISOString() } });
  trackEvent('friend_lesson_link_created', payload);
}
```

The payload spread already carries `lessonId`/`otherShareCode` into the stored entry; `api.js` (which merges via `upsertFriendLinkMap`) needs no change.

### 4. Complete-video upload signature — `src/modules/video/video-processor.web.js`

`uploadCompleteVideoToR2(blob, lessonId, otherShareCode = null)` passes `otherShareCode` into `getCompleteVideoKey`. All existing 2-arg behavior is unchanged (default `null`). The Function is not modified: its prefix check (`functions/api/upload-segment.js:28`) still sees `videos/<creatorShareCode>-`.

### 5. Video + link card — `src/components/profile/FriendLessonLinksSection.jsx` (extend)

`FriendLessonLink` gains a `videoFailed` state and renders the video above the anchor (no new strings, no data fetching; `video-url.js` is pure):

```jsx
function FriendLessonLink({ entry, lang, now }) {
    const [videoFailed, setVideoFailed] = useState(false);
    const remainingMs = getFriendLinkRemainingMs(new Date(entry.addedAt).getTime(), now);
    const url = buildFriendLessonLink({ courseId: entry.courseId, lessonId: ANSWER_LESSON_ID, shareCode: entry.shareCode });
    const videoUrl = entry.lessonId
        ? getCompleteVideoUrl({ shareCode: entry.shareCode, courseId: entry.courseId, lessonId: entry.lessonId, otherShareCode: entry.otherShareCode })
        : null;
    const firstClip = resolveRecapFirstClip(entry);
    const posterUrl = firstClip ? getSegmentPosterUrl(firstClip) : null;
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
            <a data-testid="friend-lesson-link" href={toFriendLessonHref(url)} style={{ fontSize: '32px', fontWeight: 800, color: '#ffffff', textDecoration: 'underline', lineHeight: 1.2, display: 'inline-block' }}>
                {Strings.get('profile_friend_lesson_link', lang)}
            </a>
            <p data-testid="friend-lesson-link-countdown" style={{ color: '#adb5bd', fontSize: '14px', margin: '8px 0 0' }}>
                {Strings.get('profile_friend_link_available', lang, { time: formatFriendLinkRemaining(remainingMs) })}
            </p>
        </div>
    );
}
```

The section's list key becomes `key={friendLinkEntryKey(entry)}` (unique per entry). Everything else (the ticking clock, `listActiveFriendLinks`, `null` when empty) is unchanged.

**Decision (bandwidth + unavailability):** `preload="none"` means no video bytes are fetched until the user presses play; the poster (the recap's first clip `.jpg`) is the visible thumbnail. If the object is missing/expired/never uploaded (>50 MB), the browser fires `error` on interaction, `videoFailed` hides the `<video>`, and the link + countdown remain. A legacy entry with no `lessonId` never renders a video.

### 6. Surfaces

- **Public profile** (`PublicProfile.jsx`): already renders `<FriendLessonLinksSection friendLinks={profile?.friendLinks} lang={lang} />` — no change.
- **Owner profile** (`UserProfile.jsx`): import `FriendLessonLinksSection` and render it inside the content column, after the header card and before the `Section` blocks:
  `<FriendLessonLinksSection friendLinks={profile?.friendLinks} lang={lang} />`.
  `useUserProfile()` selects `*` and `fromDbRow` already aliases `friendLinks: row.friend_links`, so no data change.

### 7. Edge cases

- **Video object missing** (>50 MB skip, upload failure, or expired): `onError` hides the `<video>`; the link + countdown still render.
- **Same user answers two friends in lesson `b`**: keys `friend:b:<friendA>` and `friend:b:<friendB>` → two entries, two videos (both survive 48h).
- **Same user answers the same friend twice**: same key → the entry refreshes (`addedAt` reset), the complete key is overwritten — one card.
- **A export shared with many friends**: one question set, one entry (`friend:a`), one card; all friends answer the same clips.
- **B+ask export with no friend link present** (`friendCode` null): `otherShareCode: ''` → single-code key, one card.
- **Legacy entry without `lessonId`/`otherShareCode`**: link renders, no video.
- **Legacy migration**: the next export for that course deletes the course-keyed entry and writes a keyed entry.
- **Exactly 48h old**: `remainingMs === 0` → inactive → entry removed (boundary unchanged).
- **Malformed / non-object / array `friendLinks`**: `listActiveFriendLinks` → `[]` → section renders nothing.
- **Missing `shareCode`/`courseId`/`lessonId` on an entry**: `getCompleteVideoUrl`/`getSegmentPosterUrl` return null → no video; link still builds.
- **Poster 404** (thumbBlob absent, or the co-participant's clip expired): the poster silently fails; the video element still plays once pressed.
- **Non-string `video-url` inputs**: helpers return `null`, never throw.

## Tasks

### Task 1 - Complete-video key/URL + segment poster (`src/modules/video/video-url.test.js`, extend existing)

- `getUgcVideoUrl('videos/ab12-friend-a-complete.mp4')`
  - → `'https://r2.ultrafastfluency.com/videos/ab12-friend-a-complete.mp4'`
- `getUgcVideoUrl(null)` / `('')` / `(undefined)` / `(42)`
  - → `null` for each
- `getCompleteVideoKey({ shareCode: 'ab12', courseId: 'friend', lessonId: 'a' })` / `({ ...courseId: 'model', lessonId: 'w' })` / `({ ...courseId: 'friend', lessonId: 'b' })`
  - → `'videos/ab12-friend-a-complete.mp4'` / `'videos/ab12-model-w-complete.mp4'` / `'videos/ab12-friend-b-complete.mp4'` (single-code unchanged)
- `getCompleteVideoKey({ shareCode: 'ab12', courseId: 'friend', lessonId: 'b', otherShareCode: 'cd34' })`
  - → `'videos/ab12-cd34-friend-b-complete.mp4'`
- the two-code key with `otherShareCode: ''` / `undefined` / `null`
  - → same as the single-code key for each
- `getCompleteVideoKey({ shareCode: 'ab12', courseId: 'friend', lessonId: 'b', otherShareCode: 'cd34' })`
  - → starts with `'videos/ab12-'` and ends with `'.mp4'` and does not contain `concatenated`
- `getCompleteVideoKey` with any of `shareCode`/`courseId`/`lessonId` missing
  - → `null` (including when `otherShareCode` is present)
- `getCompleteVideoUrl({ shareCode: 'ab12', courseId: 'friend', lessonId: 'b', otherShareCode: 'cd34' })`
  - → `'https://r2.ultrafastfluency.com/videos/ab12-cd34-friend-b-complete.mp4'`
- `getCompleteVideoUrl` with missing parts / `{}` / no arg
  - → `null` for each
- `getSegmentPosterUrl({ shareCode: 'ab12', courseId: 'friend', lessonId: 'a' })`
  - → `'https://r2.ultrafastfluency.com/videos/ab12-friend-a-response-01.jpg'`
- `getSegmentPosterUrl({ shareCode: 'cd34', courseId: 'friend', lessonId: 'a' })`
  - → `'https://r2.ultrafastfluency.com/videos/cd34-friend-a-response-01.jpg'`
- `getSegmentPosterUrl` with any missing part / `{}` / no arg
  - → `null` for each
- existing `getVideoUrl` / `getPosterUrl` / `getUgcThumbKey` / `getCompleteVideoKey` (single-code) cases
  - → still pass unchanged (regression)

### Task 2 - Entry keying, co-participant payload, recap first clip (`src/modules/user/friend-lesson-link-logic.test.js`, update existing)

- `friendLinkEntryKey({ courseId: 'friend', lessonId: 'a' })`
  - → `'friend:a'`
- `friendLinkEntryKey({ courseId: 'friend', lessonId: 'b' })`
  - → `'friend:b'`
- `friendLinkEntryKey({ courseId: 'friend', lessonId: 'b', otherShareCode: 'cd34' })`
  - → `'friend:b:cd34'`
- `friendLinkEntryKey({ courseId: 'friend' })` / `({ courseId: 'friend', lessonId: '' })`
  - → `'friend:legacy'` for each
- `upsertFriendLinkMap(null, entryB1)` and `upsertFriendLinkMap({}, entryB1)` where `entryB1 = { courseId: 'friend', lessonId: 'b', otherShareCode: 'cd34', shareCode: 'ab12', addedAt }`
  - → `{ 'friend:b:cd34': entryB1 }` for each
- `upsertFriendLinkMap({ 'friend:b:cd34': entryB1 }, entryB2)` where `entryB2.otherShareCode === 'ef56'`
  - → keys `['friend:b:cd34', 'friend:b:ef56']` (two friends → two entries)
- `upsertFriendLinkMap({ 'friend:b:cd34': oldB1 }, newB1)` with the same key
  - → `{ 'friend:b:cd34': newB1 }` (replace, `addedAt` updated)
- `upsertFriendLinkMap({ friend: legacyEntry }, entryA)` (legacy migration)
  - → no `friend` key remains; only `'friend:a'` mapped to `entryA`
- `upsertFriendLinkMap({ 'friend:a': entryA }, entryOther)` where `entryOther.courseId === 'other'`
  - → keys include both `'friend:a'` and `'other:b'`
- `upsertFriendLinkMap` called with an input map
  - → the input object is not mutated
- `upsertFriendLinkMap('x', entryA)` / `([entryA], entryA)`
  - → `{ 'friend:a': entryA }` for each
- `listActiveFriendLinks` with a legacy entry and two active B entries
  - → all three returned, sorted newest first, legacy returned unchanged (no `lessonId`)
- `listActiveFriendLinks` with an entry exactly 48h old / missing / invalid `addedAt`
  - → excluded (boundary unchanged)
- `listActiveFriendLinks(null, now)` / `({}, now)` / `('x', now)` / `([entry], now)`
  - → `[]` for each
- `resolveRecapFirstClip({ shareCode: 'ab12', courseId: 'friend', lessonId: 'a' })`
  - → `{ shareCode: 'ab12', courseId: 'friend', lessonId: 'a' }`
- `resolveRecapFirstClip({ shareCode: 'ab12', courseId: 'friend', lessonId: 'b', otherShareCode: 'cd34' })`
  - → `{ shareCode: 'cd34', courseId: 'friend', lessonId: 'a' }`
- `resolveRecapFirstClip({ shareCode: 'ab12', courseId: 'friend', lessonId: 'b' })` (no other)
  - → `{ shareCode: 'ab12', courseId: 'friend', lessonId: 'b' }`
- `resolveRecapFirstClip` with `shareCode`/`courseId`/`lessonId` missing
  - → `null` for each
- `resolveFriendLessonLink({ configData: configWithB, lessonId: 'a', courseId: 'friend', shareCode: 'ab12', succeeded: 3 })`
  - → `{ courseId: 'friend', lessonId: 'a', shareCode: 'ab12', otherShareCode: '' }`
- `resolveFriendLessonLink({ ..., lessonId: 'b', askPublished: true, otherShareCode: 'cd34', succeeded: 3 })`
  - → `{ courseId: 'friend', lessonId: 'b', shareCode: 'ab12', otherShareCode: 'cd34' }`
- `resolveFriendLessonLink({ ..., lessonId: 'b', askPublished: true })` (no `otherShareCode`)
  - → `otherShareCode: ''`
- `resolveFriendLessonLink({ ..., lessonId: 'a', askPublished: false, otherShareCode: 'cd34' })`
  - → `otherShareCode: ''` (an A video is never co-authored)
- `resolveFriendLessonLink` with `lessonId: 'b'` and no `askPublished`, `succeeded: 0`, `shareCode: ''`, `courseId: ''`, a config without lesson `b`, `configData: null`/`undefined`
  - → `null` for each (guards unchanged)

### Task 3 - Video + link card (`src/components/profile/FriendLessonLinksSection.jsx`; new `src/components/profile/FriendLessonLinksSection.test.js`)

Rendered with `createRoot` + `act` (pattern from `src/components/intro-caller-name.test.js`), `globalThis.IS_REACT_ACT_ENVIRONMENT = true`; no network; entries use `new Date().toISOString()`.

- an A entry `{ courseId: 'friend', lessonId: 'a', shareCode: 'ab12', otherShareCode: '', addedAt: now }`
  - → `[data-testid="friend-lesson-video"]` count is `1`
  - → its `src` is `'https://r2.ultrafastfluency.com/videos/ab12-friend-a-complete.mp4'`
  - → its `poster` is `'https://r2.ultrafastfluency.com/videos/ab12-friend-a-response-01.jpg'`
  - → it has `controls`, `playsInline`, and `preload="none"`
  - → the video precedes `[data-testid="friend-lesson-link"]` in document order
  - → the link's `href` is `'https://ultrafastfluency.com/course/friend/lesson/b?shareCode=ab12'` (target stays lesson `b`)
- a co-authored B entry `{ courseId: 'friend', lessonId: 'b', shareCode: 'ab12', otherShareCode: 'cd34', addedAt: now }`
  - → its `src` is `'https://r2.ultrafastfluency.com/videos/ab12-cd34-friend-b-complete.mp4'`
  - → its `poster` is `'https://r2.ultrafastfluency.com/videos/cd34-friend-a-response-01.jpg'`
  - → the link's `href` still uses `shareCode=ab12`
- an entry with no `lessonId` (legacy)
  - → `[data-testid="friend-lesson-video"]` count is `0`
  - → `[data-testid="friend-lesson-link"]` count is `1`
- an entry with `lessonId` after dispatching an `error` event on `[data-testid="friend-lesson-video"]`
  - → `[data-testid="friend-lesson-video"]` count is `0`
  - → `[data-testid="friend-lesson-link"]` count is `1` (link kept)
- two co-authored B entries (`cd34` and `ef56`), both active
  - → `[data-testid="friend-lesson-video"]` count is `2`
  - → `[data-testid="friend-lesson-link"]` count is `2`
- one active entry and one entry exactly 48h old
  - → video count `1` and link count `1`
- `friendLinks` `{}` / `null` / `[]` / `'x'`
  - → `[data-testid="friend-lesson-links"]` count is `0`

### Task 4 - Private-profile surface (`src/components/profile/UserProfile.jsx`; source guard `src/components/profile/user-profile-friend-links.test.js`, new)

- `UserProfile.jsx` source, comments stripped
  - → imports `FriendLessonLinksSection` from `./FriendLessonLinksSection.jsx`
  - → renders `<FriendLessonLinksSection` with a `friendLinks` prop
- `src/components/profile/FriendLessonLinksSection.test.js` (Task 3)
  - → passes (shared behavior, no page-specific code)

### Task 5 - Export/upload wiring (`src/components/widgets/SuccessButtons.jsx`, `src/modules/video/video-processor.web.js`; update `src/modules/video/complete-video-upload.test.js`, `src/modules/video/complete-video-wiring.test.js`, `src/modules/user/friend-lesson-link-wiring.test.js`)

- `video-processor.web.js` source
  - → `uploadCompleteVideoToR2(blob, lessonId, otherShareCode = null)` and `getCompleteVideoKey({ shareCode, courseId, lessonId, otherShareCode })`
- `complete-video-upload.test.js` (extend)
  - → `uploadCompleteVideoToR2(BLOB, 'b', 'cd34')` with `courseId: 'friend'` uploads with key `'videos/ab12-cd34-friend-b-complete.mp4'`
  - → existing 2-arg cases still upload the single-code key (default `null`)
- `SuccessButtons.jsx` source, comments stripped
  - → reads `const otherShareCode = exportResult?.askPublished ? appStore.getState().friendCode : null;`
  - → calls `uploadCompleteVideoToR2(result.blob, lessonId, otherShareCode)`
  - → passes `otherShareCode` into `resolveFriendLessonLink`
  - → still spreads the payload into the mutation entry (`entry: { ...payload, addedAt`), so `lessonId`/`otherShareCode` are stored
- `complete-video-wiring.test.js` (update)
  - → the call-site assertion matches the 3-arg call and remains fire-and-forget (`.catch(`, not awaited)
- `friend-lesson-link-wiring.test.js` (extend)
  - → `resolveFriendLessonLink`'s success return contains `lessonId` and `otherShareCode`
  - → `api.js` still merges through `upsertFriendLinkMap(row?.friend_links, entry)`

### Task 6 - Function accepts the co-authored key (`functions/api/upload-segment.test.js`, extend existing)

The Function is unchanged; this locks the two-code scheme into its contract.

- `onRequestPost` with `key: 'videos/ab12-cd34-friend-b-complete.mp4'`, valid token, matching profile `share_code`
  - → `200`, `env.UFF_R2.put` called with that key and `{ httpMetadata: { contentType: 'video/mp4', cacheControl: 'public, max-age=3600' } }`
- `onRequestPost` with `key: 'videos/other-cd34-friend-b-complete.mp4'` (wrong creator prefix)
  - → `403`, no `put`

### Task 7 - Browser behavior (`tests/friend-lesson-link.spec.js`, update existing Playwright)

Fixtures include `lessonId`/`otherShareCode`. `beforeEach` also routes `'**r2.ultrafastfluency.com/**'` to `route.abort()` (no real R2 traffic; a failed poster does not fire the video's `error`, and `preload="none"` never fetches the video).

- `/friendtest1` loaded with an A entry (`lessonId: 'a'`) added 1h ago
  - → `[data-testid="friend-lesson-video"]` is visible with `src` `'https://r2.ultrafastfluency.com/videos/friendtest1-friend-a-complete.mp4'` and `poster` `'.../friendtest1-friend-a-response-01.jpg'`
  - → it precedes `[data-testid="friend-lesson-link"]` in the DOM
  - → the existing link/countdown assertions still pass
- `/friendtest1` loaded with a co-authored B entry (`lessonId: 'b'`, `otherShareCode: 'cd34'`)
  - → the video's `src` is `'https://r2.ultrafastfluency.com/videos/friendtest1-cd34-friend-b-complete.mp4'`
  - → its `poster` is `'https://r2.ultrafastfluency.com/videos/cd34-friend-a-response-01.jpg'`
- `/friendtest1` loaded with two co-authored B entries (`cd34`, `ef56`)
  - → `[data-testid="friend-lesson-video"]` count is `2` and `[data-testid="friend-lesson-link"]` count is `2`
- `/friendtest1` loaded with a legacy entry (no `lessonId`)
  - → `[data-testid="friend-lesson-video"]` count is `0`, link visible
- `/friendtest1` loaded with an A entry, then an `error` event dispatched on the video
  - → `[data-testid="friend-lesson-video"]` count is `0`, link visible
- existing expiry / empty / unresolved-profile cases
  - → still pass

## Technical Context

- **No new dependencies.** Reuses React 19.2.6, `@tanstack/react-query` 5.100.14, `zustand` 5.0.13, `@supabase/supabase-js` 2.112.4, `react-router-dom` 7.15.1. Unit tests: vitest 4.1.6 + jsdom 29.1.1 (colocated `*.test.js`; `vitest.config.js` excludes `tests/**` and `*.spec.js`). Browser tests: `@playwright/test` 1.60.0. Gate: `npm test -- --run`; the Playwright spec is supplementary (outside the vitest gate).
- **Upload auth accepts the two-code key:** `functions/api/upload-segment.js:28` requires `key.startsWith('videos/' + shareCode + '-')` and a `.mp4`/`.jpg` extension; putting the creator's code first preserves it. The same file enforces the 50 MB cap.
- **Co-participant source:** `appStore.friendCode` (`App.jsx:19-37`) is the `?shareCode=` param, trimmed + lowercased (`App.jsx:30`), persisted (`store.js:98/227`), and already used for friend-response notifications. `exportResult.askPublished` (`video-processor.web.js:1394`) distinguishes a co-authored B export.
- **R2 URL routing (`video-url.js`):** `isFriendVideoSlug` matches `-response-\d+$` only, so `-complete` keys must use `getUgcVideoUrl`. `videos/` is not proxied in dev (`README.md:15`), so UGC URLs are always absolute.
- **Poster availability:** `exportSegmentsToR2` uploads each segment's `thumbBlob` as `<segment-key>.jpg` (`video-processor.web.js:1379-1385`). The first clip of an A recap is the creator's `a-response-01`, and of a co-authored B recap is the co-participant's `a-response-01` (recapSources `friend`) — both have sibling `.jpg`s. If a thumb was never uploaded the poster 404s silently (video still plays).
- **Data access:** `fromDbRow` already aliases `friendLinks: row.friend_links` (`api.js:64`); `useUserByShareCode`'s `SAFE_COLS` already includes `friend_links` (`api.js:298`); `useAddFriendLinkMutation` already merges via `upsertFriendLinkMap` (`api.js:324-346`). The anon `public_profiles` view exposes `otherShareCode`, which is already public (it is the other user's profile URL). No grant change.
- **Entry shape is app-side jsonb only:** migration `004` is unchanged, and its static guard (`src/modules/api/friend-links-migration.test.js`) stays green.
- **Existing guards to preserve:** `friend-lesson-link-wiring.test.js` (`upsertFriendLinkMap(row?.friend_links, entry)`), `friend-links-migration.test.js`, `video-url.test.js`'s `no POSTER_BASE / assets/posters` assertions, and `complete-video-wiring.test.js`'s "after exportSegmentsToR2" ordering (append `uploadCompleteVideoToR2` changes only its call signature).
- **Playwright determinism:** `page.clock.setFixedTime` + `queryClient.setQueryData` injection (pattern already in the spec); route Supabase and R2 so nothing escapes.

## Notes

- **Confirmed product decisions (user answers):** (1) embed the complete recap from the same export; (2) support multiple concurrent (video, link) entries; (3) show the link but not the video when the video is unavailable; (4) show on both the public and private profile; (5) show a poster rather than eagerly loading the video; (6) a B video is co-authored and its key carries both share codes (A stays single-code); (7) each card's link keeps pointing at the creator's own questions; (8) the co-authored video is surfaced only on the creator's profile (cross-linking is a separate story).
- **Decision (evidence):** the co-participant code is placed after the creator's in the B key (`videos/<creator>-<other>-<course>-b-complete.mp4`) so the Cloudflare Function's `videos/<creator>-` namespace check still authorizes the write, while two B sessions with two friends no longer collide. Entries are keyed `<course>:<lesson>[:<other>]`; re-exporting the same key replaces that entry, because the underlying R2 objects are deterministic.
- **Decision:** the embedded video is the exported lesson's complete recap. A legacy story-012 entry has no `lessonId`/`otherShareCode`, so its link renders without a video until the next export; backfilling an inferred value was rejected as a guess.
- **Decision:** `preload="none"` + the recap's first-clip poster keeps the profile light (no video bytes until play) and makes the Playwright test deterministic; unavailability is detected on play via `onError`, which hides the video and keeps the link.
- **Known cosmetic limit:** the responder's own `b` segment keys and the `-response-01` poster for a plain (no-friend) B entry are shared across B runs; only the co-authored complete video is per-participant. Per-participant `b` segments are out of scope because nothing fetches them (the recap is stitched client-side), so the extra key churn is not justified.
- **No new strings:** the card reuses `profile_friend_lesson_link` and `profile_friend_link_available`; the `<video>` is unlabeled. `src/data/strings.test.js` is unaffected.
- **Documentation (non-automatable):** update `docs/product.md` — extend the "Friend-challenge practice link" feature bullet to mention the embedded concatenated video, multiple per-(course, lesson, co-participant) entries with independent 48h removal on both profiles, and that co-authored B videos carry both share codes; add a Known Limitation that the video is best-effort (hidden, while the link persists, when the R2 object is missing/expired/over 50 MB) and that pre-existing entries without a `lessonId` show no video. Optionally note the new `getUgcVideoUrl`/`getCompleteVideoUrl`/`getSegmentPosterUrl` helpers in `agents.md`'s concatenated-recap paragraph.
- **Manual verification** (R2/MediaRecorder and Supabase cannot be exercised headlessly; logic/UI are covered by Tasks 1-6):
  1. `npm run dev`, log in as A, complete and export `/course/friend/lesson/a`; confirm `videos/<A>-friend-a-complete.mp4` and `<A>-friend-a-response-01.jpg` exist on R2.
  2. Open `/<A>` logged out: the A card sits above "Practice English with Me" with the poster.
  3. As B, open `/course/friend/lesson/b?shareCode=<A>`, complete and export; confirm `videos/<B>-<A>-friend-b-complete.mp4` exists and B's profile shows a B card whose poster is `<A>-friend-a-response-01.jpg`.
  4. As B, do the same against a second asker C; confirm B's profile now shows **two** B cards (`friend:b:<A>` and `friend:b:<C>`), each with its own video.
  5. Delete/rename a complete object on R2, reload, press play: the video disappears, the link and countdown remain.
  6. Set an entry's `addedAt` to exactly 48h ago: the whole card (video + link) is gone.
