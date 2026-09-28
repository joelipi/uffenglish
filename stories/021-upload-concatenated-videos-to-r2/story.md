# Upload the concatenated recap video to R2

## Context

Finishing a lesson already publishes the learner's **per-segment** webcam clips to R2 under the `videos/` prefix (`exportSegmentsToR2`, `src/modules/video/video-processor.web.js:1253`), keyed `videos/${shareCode}-${courseId}-${lessonId}-response-NN.mp4`. Those objects inherit the dashboard-managed 48h lifecycle for the `videos/` prefix (`wrangler.toml:5-10`, `README.md:102`).

The **concatenated** end-of-lesson recap — the stitched video the learner sees and shares — is produced by `processVideo()` (`video-processor.web.js:276-279`) and returned as `{ blob, ext }` (`video-processor.web.js:227-248`), then held in the store as `successVideoBlob` (`SuccessButtons.jsx:82`). It is only ever shared via the Web Share API (`shareVideo`, `video-share.web.js:28-81`); it is **never uploaded to R2**. So the complete lesson video is lost after the session while its individual segments survive for 48h.

This story uploads the concatenated recap to R2 as well, in the same `videos/` namespace so it gets the same 48h TTL, for **every** lesson that publishes segments — including the friend ask/answer lessons `a` and `b` (`src/config/friend.json`) and their `model.json` equivalents `w`/`wf`/`wa`/`wfa`.

**Naming decision.** The key must not contain the word "concatenated". It follows the existing share-code convention plus the lesson id and a `complete` suffix:

```
videos/${shareCode}-${courseId}-${lessonId}-complete.mp4
```

e.g. `videos/ab12-model-w-complete.mp4`. This starts with `videos/${shareCode}-` and ends in `.mp4`, so it passes the Function's namespace/extension check (`functions/api/upload-segment.js:25-29`) and inherits the 48h lifecycle. The user's **name** is deliberately not used: names are not unique, can contain characters unsafe for object keys, and the share code is already the per-user namespace the Function authorizes against (`upload-segment.js:52-73`).

**Size constraint (important).** The Function caps each object at 20 MB (`MAX_BYTES`, `functions/api/upload-segment.js:17,78-86`). A full concatenated recap can exceed that, so the upload is **best-effort**: the client checks the transcoded blob size first and skips the upload (logging + a track event) when it is over the cap, rather than sending a request that is guaranteed to 413. The per-segment publish and the friend-link flow are unaffected either way.

## Out of Scope

- **No change to the per-segment upload.** `exportSegmentsToR2`'s existing keys, poster upload, and `{ count, succeeded }` contract are unchanged; the complete-video upload is a separate, additive step.
- **No change to the Cloudflare Function.** The existing `videos/${shareCode}-*.mp4` namespace, JWT/share-code auth, and 20 MB cap already cover the new key. No new endpoint, no new extension, no migration.
- **No R2 lifecycle config.** The 48h TTL is dashboard-managed and prefix-based; a new object under `videos/` inherits it automatically.
- **No change to the share/download flow.** `shareVideo` and `generateVideoFilename` (`success-lesson-logic.js:37-48`) keep producing the local share filename; the R2 key is independent.
- **No change to the recap generation.** `processVideo`, the render plan, `recapSources`/`recapOverlay`, and the tailing phase are untouched.
- **No native change.** `video-processor.native.jsx`'s `exportSegmentsToR2` is a no-op stub and native is not shipped.
- **No retry/queue/background-sync** for a failed or oversized complete upload; it is fire-and-forget and best-effort.
- **No new UI copy or translations.**

## Implementation approach

### 1. Pure key builder (`src/modules/video/video-url.js`)

Add a pure helper next to the existing UGC key helpers:

```js
// Key for the concatenated end-of-lesson recap. Same `videos/` namespace as the
// per-segment clips, so it inherits the 48h lifecycle. Never contains
// "concatenated"; the suffix is `complete`.
export function getCompleteVideoKey({ shareCode, courseId, lessonId }) {
    if (!shareCode || !courseId || !lessonId) return null;
    return `videos/${shareCode}-${courseId}-${lessonId}-complete.mp4`;
}
```

Returns `null` when any part is missing, so callers can skip cleanly. The `-complete.mp4` suffix cannot collide with a segment key (`-response-NN.mp4`) or a poster key (`.jpg`).

### 2. Best-effort upload (`src/modules/video/video-processor.web.js`)

Add an exported function beside `exportSegmentsToR2`:

```js
export const MAX_R2_UPLOAD_BYTES = 20 * 1024 * 1024; // mirrors functions/api/upload-segment.js

// Uploads the concatenated recap to R2 under the same videos/ namespace as the
// per-segment clips (48h TTL). Best-effort: never throws, and skips the request
// when the transcoded blob exceeds the Function's 20 MB cap.
export async function uploadCompleteVideoToR2(blob, lessonId) {
    if (!blob) return { uploaded: false, reason: 'no-blob' };
    if (!appStore.getState().isLoggedIn) return { uploaded: false, reason: 'not-logged-in' };
    const { userData, courseId } = appStore.getState();
    const shareCode = userData?.shareCode;
    const key = getCompleteVideoKey({ shareCode, courseId, lessonId });
    if (!key) return { uploaded: false, reason: 'missing-key-parts' };

    try {
        // The recap may be WebM (iOS/older browsers); R2 only accepts .mp4.
        let mp4 = await transcodeToMp4(blob);
        if (!await verifyMp4(mp4)) throw new Error('verify-failed');
        if (mp4.size > MAX_R2_UPLOAD_BYTES) {
            console.warn('[CompleteVideo] over 20 MB cap, skipping upload:', mp4.size);
            trackEvent('publish_complete_video_skipped', { lessonId, bytes: mp4.size });
            return { uploaded: false, reason: 'too-large' };
        }
        const jwt = (await getAccessToken()) || '';
        const { url } = await uploadSegmentToR2({ blob: mp4, key, jwt, shareCode, contentType: 'video/mp4' });
        trackEvent('publish_complete_video_success', { lessonId, url });
        return { uploaded: true, url };
    } catch (e) {
        // Cloudinary fallback mirrors exportSegmentsToR2's transcode path.
        if (e?.message === 'webcodecs-unavailable' || e?.message === 'verify-failed') {
            try {
                const mp4 = await uploadWebmToCloudinary(blob);
                if (mp4.size > MAX_R2_UPLOAD_BYTES) {
                    trackEvent('publish_complete_video_skipped', { lessonId, bytes: mp4.size });
                    return { uploaded: false, reason: 'too-large' };
                }
                const jwt = (await getAccessToken()) || '';
                const { url } = await uploadSegmentToR2({ blob: mp4, key, jwt, shareCode, contentType: 'video/mp4' });
                trackEvent('publish_complete_video_success', { lessonId, url });
                return { uploaded: true, url };
            } catch (ce) {
                console.error('[CompleteVideo] Cloudinary fallback failed (non-fatal):', ce);
            }
        } else {
            console.error('[CompleteVideo] upload failed (non-fatal):', e);
        }
        trackEvent('publish_complete_video_failed', { lessonId });
        return { uploaded: false, reason: 'error' };
    }
}
```

- **Never throws** — mirrors `applyPosterAsProfilePictureIfMissing` (story 019): a complete-video failure must never fail the publish or the recap.
- **Size check before the request** — avoids a guaranteed 413 and keeps the Function's cap as the single source of truth (the constant is duplicated with a comment pointing at the Function).
- **Transcode + Cloudinary fallback** — identical to the per-segment path (`video-processor.web.js:1324-1347`), because the recap blob can be WebM.
- **Login/shareCode gating** — same guards as `exportSegmentsToR2`; guests never reach it.

### 3. Wire into the success flow (`src/components/widgets/SuccessButtons.jsx`)

`runProcessing` already has the finished `result.blob` (`SuccessButtons.jsx:77-82`). Inside the existing `if (publishSegments)` block, after `exportSegmentsToR2` and before/alongside the friend-link mutation, call the new upload **without awaiting it** so a slow complete upload cannot delay the friend-link write or the UI:

```js
const { processVideo, shareVideo, exportSegmentsToR2, uploadCompleteVideoToR2 } =
    await import('../../modules/video/video-processor.js');
...
if (publishSegments) {
    try {
        const exportResult = await exportSegmentsToR2(lessonId);
        // Best-effort: upload the concatenated recap too (same videos/ namespace,
        // 48h TTL). Fire-and-forget so it never delays the friend link.
        uploadCompleteVideoToR2(result.blob, lessonId)
            .catch((e) => console.error('[Success] complete-video upload failed (non-fatal):', e));
        ...friend link...
    } catch (e) { ... }
}
```

- The complete upload is gated by the same `publishSegments` flag as the segment publish, so guests (who never publish) never upload it.
- It runs for every lesson that publishes segments, including `a`/`b` and `w`/`wf`/`wa`/`wfa` — no lesson-specific branch.
- `result.blob` is the same blob already stored as `successVideoBlob`; no re-render.

### 4. Source-guard ordering

`video-processor-web-guard.test.js:26-27` slices from `renderStepToBlob` to `exportSegmentsToR2`, and `poster-avatar-wiring.test.js:24-25` assumes `exportSegmentsToR2` is the last function. Add `uploadCompleteVideoToR2` **after** `exportSegmentsToR2` (end of file) so both existing slices stay valid; update `poster-avatar-wiring.test.js` only if its "last function" assumption breaks (it slices to end-of-file, so appending is safe).

## Tasks

### Task 1 - Pure key builder (`src/modules/video/video-url.test.js`, extend existing)

- `getCompleteVideoKey({ shareCode: 'ab12', courseId: 'model', lessonId: 'w' })`
  - → `'videos/ab12-model-w-complete.mp4'`
- `getCompleteVideoKey({ shareCode: 'ab12', courseId: 'friend', lessonId: 'a' })` and `({ shareCode: 'ab12', courseId: 'friend', lessonId: 'b' })`
  - → `'videos/ab12-friend-a-complete.mp4'` / `'videos/ab12-friend-b-complete.mp4'` (both friend lessons covered)
- `getCompleteVideoKey({ shareCode: 'ab12', courseId: 'model', lessonId: 'w' })` result
  - → does not contain `concatenated` (case-insensitive)
  - → starts with `videos/ab12-` and ends with `.mp4`
- `getCompleteVideoKey({ shareCode: null, courseId: 'model', lessonId: 'w' })`, `({ shareCode: 'ab12', courseId: null, lessonId: 'w' })`, `({ shareCode: 'ab12', courseId: 'model', lessonId: null })`, `({})`, `()`
  - → `null` for each
- `getCompleteVideoKey({ shareCode: 'ab12', courseId: 'model', lessonId: 'w' })` compared with `getUgcThumbKey` of a segment key
  - → the complete key never equals a `-response-NN.mp4` segment key or its `.jpg` poster key

### Task 2 - Best-effort upload (`src/modules/video/complete-video-upload.test.js`, new, mocked collaborators)

Mock `./transcode.js` (`transcodeToMp4`, `verifyMp4`, `uploadWebmToCloudinary`), `./r2-upload.js` (`uploadSegmentToR2`), `../api/supabase.js` (`getAccessToken`), `../store/store.js` (`appStore.getState`), `../utils/posthog.js` (`trackEvent`). Import `uploadCompleteVideoToR2` and `MAX_R2_UPLOAD_BYTES` from `video-processor.web.js`.

- `uploadCompleteVideoToR2(null, 'w')`
  - → `{ uploaded: false, reason: 'no-blob' }`, no transcode/upload
- logged out (`isLoggedIn: false`) + valid blob
  - → `{ uploaded: false, reason: 'not-logged-in' }`, no upload
- logged in but `userData.shareCode` missing, or `courseId` missing
  - → `{ uploaded: false, reason: 'missing-key-parts' }`, no upload
- happy path: logged in, `shareCode: 'ab12'`, `courseId: 'model'`, `lessonId: 'w'`, `transcodeToMp4` resolves an mp4 under the cap, `verifyMp4` true, `uploadSegmentToR2` resolves `{ url }`
  - → `{ uploaded: true, url }`
  - → `uploadSegmentToR2` called once with `key: 'videos/ab12-model-w-complete.mp4'`, `contentType: 'video/mp4'`, the mp4 blob, and the jwt/shareCode
  - → `trackEvent('publish_complete_video_success', ...)` called
- blob over `MAX_R2_UPLOAD_BYTES` after transcode
  - → `{ uploaded: false, reason: 'too-large' }`
  - → `uploadSegmentToR2` not called
  - → `trackEvent('publish_complete_video_skipped', ...)` called
- `transcodeToMp4` rejects with `webcodecs-unavailable`, `uploadWebmToCloudinary` resolves an under-cap mp4
  - → `{ uploaded: true, url }` (Cloudinary fallback path)
  - → `uploadSegmentToR2` called with the complete key
- `transcodeToMp4` rejects with `webcodecs-unavailable` and `uploadWebmToCloudinary` also rejects
  - → `{ uploaded: false, reason: 'error' }` (never throws)
  - → `trackEvent('publish_complete_video_failed', ...)` called
- `uploadSegmentToR2` rejects
  - → `{ uploaded: false, reason: 'error' }` (never throws)

### Task 3 - Success-flow wiring (`src/modules/video/complete-video-wiring.test.js`, new source guard)

The full `runProcessing` path needs MediaRecorder/canvas/WebCodecs and cannot run headlessly (`agents.md` §4/§6), so the call site is guarded as text (comments stripped), like `poster-avatar-wiring.test.js`.

- `src/components/widgets/SuccessButtons.jsx` source, comments stripped
  - → the dynamic import destructures `uploadCompleteVideoToR2` from `../../modules/video/video-processor.js`
  - → contains `uploadCompleteVideoToR2(result.blob, lessonId)`
  - → the call is inside the `if (publishSegments)` block (substring from `if (publishSegments)` to the end of `runProcessing`)
  - → the call is not awaited (fire-and-forget): the call expression is followed by `.catch(` and is not preceded by `await `
- `src/modules/video/video-processor.web.js` source
  - → exports `uploadCompleteVideoToR2` and `MAX_R2_UPLOAD_BYTES`
  - → `uploadCompleteVideoToR2` is defined after `export async function exportSegmentsToR2` (preserves the `renderStepToBlob`→`exportSegmentsToR2` slice in `video-processor-web-guard.test.js`)
  - → contains `getCompleteVideoKey(` and `contentType: 'video/mp4'`
- `npm test -- --run` includes and passes this guard

### Task 4 - Function accepts the complete key (`functions/api/upload-segment.test.js`, extend existing)

- `onRequestPost` with `key: 'videos/ab12-model-w-complete.mp4'`, valid token, matching profile share_code
  - → `200`, `env.UFF_R2.put` called with that key and `{ httpMetadata: { contentType: 'video/mp4', cacheControl: 'public, max-age=3600' } }`
- `onRequestPost` with `key: 'videos/other-model-w-complete.mp4'` (wrong namespace)
  - → `403`, no `put`
- `onRequestPost` with `key: 'videos/ab12-model-w-complete.webm'` (wrong extension)
  - → `403`, no `put`

## Technical Context

- **No new dependencies.** Reuses `mediabunny` 1.50.8 (transcode), `@supabase/supabase-js` 2.112.4, `zustand` 5.0.13. Unit tests: vitest 4.1.6 + jsdom 29.1.1 (`vitest.config.js` runs colocated `*.test.js`, excludes `tests/**`/`*.spec.js`). Gate: `npm test -- --run`.
- **Recap blob shape:** `processVideo` resolves `{ blob, ext }` where `ext` is `'mp4'` or `'webm'` (`video-processor.web.js:227-248`); `blob.type` is the negotiated MediaRecorder mime. R2 requires `.mp4`, so `transcodeToMp4` + `verifyMp4` are mandatory (`transcode.web.js:148-152,51-62`).
- **Transcode fallback:** `transcodeToMp4` throws `webcodecs-unavailable` when the browser cannot encode H.264/AAC; callers fall back to `uploadWebmToCloudinary` (`transcode.web.js:168-187`). The per-segment loop does exactly this (`video-processor.web.js:1330-1341`).
- **Function contract:** `POST /api/upload-segment` with `Authorization: Bearer <jwt>`, `x-share-code`, `x-r2-key`, `Content-Type`; key must start `videos/${shareCode}-` and end `.mp4`/`.jpg`/`.jpeg`; 20 MB cap; returns `{ ok, url }` (`functions/api/upload-segment.js:19-105`, `r2-upload.web.js:25-52`).
- **Store fields at publish time:** `userData.shareCode` (`video-processor.web.js:1259`), `courseId` (`:1352`), `lessonId` passed from `successLessonId` (`SuccessButtons.jsx:53`), `isLoggedIn` (`:1254`).
- **Existing source guards to preserve:** `video-processor-web-guard.test.js:26-27` slices `renderStepToBlob`→`exportSegmentsToR2`; `poster-avatar-wiring.test.js:24-25` slices `exportSegmentsToR2`→EOF. Appending the new function after `exportSegmentsToR2` keeps both valid.
- **Friend lessons:** `a`/`b` in `src/config/friend.json`; `w`/`wf`/`wa`/`wfa` in `src/config/model.json`; `ASK_LESSON_ID='a'`/`ANSWER_LESSON_ID='b'` (`friend-lesson-link-logic.js:9-13`). The upload path has no ask/answer branch — it runs for any lesson that publishes segments.
- **R2 TTL:** prefix-based, dashboard-managed (`wrangler.toml:5-10`, `README.md:102`); no repo config change needed.

## Notes

- **Confirmed product behaviour (user request):** upload the concatenated recap to R2 in the same `videos/` folder (48h TTL), for both lesson A and lesson B; the key must not contain "concatenated" and should use the share code + lesson name + a `complete` suffix.
- **Decision (assumption, evidenced):** the key is `videos/${shareCode}-${courseId}-${lessonId}-complete.mp4`. The user's **name** is not used — names are non-unique and unsafe for object keys, and the share code is the namespace the Function authorizes against. `courseId` is included to match the existing per-segment convention and avoid cross-course collisions.
- **Decision (assumption, evidenced):** the upload is best-effort and size-gated at 20 MB (the Function's cap). A full recap can exceed it; skipping avoids a guaranteed 413 and keeps the publish non-fatal. If the product later needs larger complete videos, the Function cap must be raised (a separate change).
- **Decision:** the complete upload is fire-and-forget and gated by `publishSegments`, so it never delays the friend-link write and guests never upload it.
- **Failures are non-fatal.** `uploadCompleteVideoToR2` catches and returns; the per-segment publish, friend link, and recap UI are unchanged. Keep existing logs and add `[CompleteVideo]` success/skip/failure logs (`agents.md` §2).
- **Documentation (non-automatable).** During implementation, add a line to `docs/product.md` (Features: the concatenated recap is also published to R2 under `videos/` with the 48h TTL) and to the `agents.md` "Posters are R2-only" / R2 section noting the complete-video key convention.
- **Manual verification:** finish a lesson as a logged-in user, let the video generate, then confirm `videos/<shareCode>-<courseId>-<lessonId>-complete.mp4` exists on R2 and plays; repeat for lesson `a` and lesson `b`; confirm a guest publish uploads nothing.
