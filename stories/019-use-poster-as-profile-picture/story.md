# Use a lesson poster as the profile picture when the user has none

## Context

A new user gets no profile picture: `useSignupForm` inserts the `user_profiles` row without `profile_picture_url` (`src/components/auth/SignupForm.jsx:46-57`), and every read substitutes the bundled placeholder (`profilePictureUrl: profileDoc?.profilePictureUrl || defaultProfilePic`, `src/modules/api/api.js:146`). An existing user who never uploaded one is in the same state (DB `profile_picture_url IS NULL`).

At the same time, finishing a lesson already produces a clean head-and-shoulders still of the learner: when each answer is recorded, `generateThumbFromBlob` captures a 0.2s frame of the raw webcam blob (`src/modules/speech/speech.web.js:220-228`, `src/modules/video/thumbnail.web.js:17`), it is stored on the recording as `thumbBlob` (`src/modules/storage/storage.web.js:59`), carried through the render plan (`src/modules/video/video-processor-logic.js:258`), and uploaded to R2 as the segment's sibling `.jpg` poster during `exportSegmentsToR2` (`src/modules/video/video-processor.web.js:1353-1359`).

So there is already a ready-made profile picture — the user just never gets it assigned. This story assigns that poster to the user's profile **only when they do not already have a picture**, covering both a brand-new signup (which reaches the publish flow through the inline `SaveClipsModal` signup) and an existing user without a picture.

**Storage decision (important).** R2 objects under the `videos/` prefix have a 48h lifecycle TTL (`wrangler.toml` note; `functions/api/upload-segment.js:5-7`), so storing the R2 poster URL as `profile_picture_url` would leave the user with a broken avatar after two days. The durable home for profile pictures is the public Supabase Storage bucket `avatars` (`supabase/migrations/001_init_user_profiles_and_avatars.sql:96-98`, written by `uploadAvatarToStorage`, `src/modules/avatar/avatar.service.js:82-100`). The same in-memory `thumbBlob` is therefore copied into the `avatars` bucket (no download needed) and that persistent URL becomes the picture.

## Out of Scope

- **No change to the signup form or its profile insert.** Signup keeps leaving `profile_picture_url` null; the poster flow is what assigns a picture. There is nothing to do at signup time itself because no image exists yet.
- **No overwrite of an existing custom picture.** A user who uploaded/cropped an avatar (`useAvatarUpload`, `src/modules/avatar/use-avatar-upload.js`) keeps it forever; this feature is a one-time fill of an empty slot.
- **No backfill for existing non-null-but-broken URLs** (e.g. legacy `appwrite.io` values). "No profile picture" means SQL `NULL` (or the client placeholder), not "a stored URL that fails to render". A future cleanup story can migrate legacy URLs.
- **No changes to poster generation or the R2 publish path.** `scripts/generate-thumbnails.mjs`, the R2 sibling-`.jpg` upload, and intro posters are untouched; this feature only reads the already-created `thumbBlob`.
- **No cropping/resizing UI or new image-processing.** The raw poster blob (320px wide, `image/jpeg`) is uploaded as-is; the profile UI already crops with CSS.
- **No new Cloudflare Function, no DB migration.** `profile_picture_url` already exists, is anon-readable, and owner-updatable (`001_init...sql:37,79-83`); `avatars` policies already allow owner writes (`001_init...sql:108-116`).
- **No native processor change.** `exportSegmentsToR2` exists only in the web processor (`src/modules/video/video-processor.web.js`); the native variant (`src/modules/video/video-processor.native.jsx`) does not publish posters to R2 and is not shipped.
- **No new UI copy or translations.**

## Implementation approach

### 1. New module `src/modules/avatar/poster-avatar.js`

Two exports: a pure predicate and a fire-and-forget async action.

```js
import defaultProfilePic from '../../assets/img/userprofile.png';
import { supabase } from '../api/supabase.js';
import { queryClient } from '../api/api.js';
import { appStore } from '../store/store.js';
import { uploadAvatarToStorage, deleteAvatarFromStorage } from './avatar.service.js';

// "No profile picture" == falsy, or exactly the bundled placeholder that every
// profile read substitutes for a NULL profile_picture_url (api.js:146).
// Any other non-empty string is a real picture and must never be replaced.
export function isMissingProfilePicture(url) {
    return !url || url === defaultProfilePic;
}

// First publishable webcam step that has a poster blob; null when none does.
// `publishable` is already filtered to webcam, non-text-mode steps with a video
// blob (video-processor.web.js:1278-1280), and preserves plan order.
export function pickAvatarThumb(publishable) {
    if (!Array.isArray(publishable)) return null;
    return publishable.find((s) => s?.thumbBlob)?.thumbBlob || null;
}
```

`applyPosterAsProfilePictureIfMissing({ thumbBlob, userId, currentUrl })` rules, in order:

1. `!thumbBlob || !userId` → `{ updated: false, reason: 'missing-input' }` (no upload).
2. `!isMissingProfilePicture(currentUrl)` → `{ updated: false, reason: 'has-picture' }` (no upload).
3. `uploadAvatarToStorage(thumbBlob, userId)` → persistent Supabase URL.
4. Atomic conditional claim so a picture set on another device is never clobbered:

```js
const { data, error } = await supabase
    .from('user_profiles')
    .update({ profile_picture_url: url })
    .eq('id', userId)
    .is('profile_picture_url', null)   // only fills a truly empty slot
    .select('id');
```

   - `error` → throw into the catch below.
   - `data.length === 0` (row already has a picture) → delete the just-uploaded file (`deleteAvatarFromStorage(url)`, non-fatal) and return `{ updated: false, reason: 'has-picture-db' }`.
5. Success → sync the client stores via the shared `syncAvatarUrlToClientStores(url)` helper (new `src/modules/avatar/avatar-client-store.js`), which patches the React Query `['user', 'profile']` cache and the Zustand `userData` (`appStore.getState().setCourseData({ userData: { ...currentUserData, profilePictureUrl: url } })`). The same helper is now used by `useAvatarUpload.onSuccess`, so the two avatar paths cannot drift. Then return `{ updated: true, url }`.
6. Any thrown error → if the upload already happened (`url` set) delete the orphan file (`deleteAvatarFromStorage(url)`, non-fatal), `console.error('[PosterAvatar] ...')`, and return `{ updated: false, reason: 'error' }`. **The action never throws**, so a poster→avatar failure can never fail the lesson publish.

Log on every branch (`agents.md` §2): a success log on update, `console.warn`/`console.log` on each skip.

### 2. Wire into the publish flow (`src/modules/video/video-processor.web.js`)

Import `{ maybeAssignPosterAvatar }` from `../avatar/poster-avatar.js`. In `exportSegmentsToR2`, after the per-segment loop and before `trackEvent('publish_clips_batch_done', ...)`:

```js
// Assign the lesson poster as the profile picture when the user has none.
// The same bytes as the R2 sibling .jpg, copied into the persistent avatars
// bucket (R2 videos/ has a 48h TTL). Fire-and-forget: a slow or failed
// avatar upload must never delay or fail the publish.
maybeAssignPosterAvatar({
    publishable,
    succeeded,
    userData: appStore.getState().userData,
}).catch((e) => console.error('[ExportSegments] poster→avatar failed (non-fatal):', e));
```

`maybeAssignPosterAvatar({ publishable, succeeded, userData })` is the testable publish-flow entry point (in `poster-avatar.js`). It returns early without uploading when `succeeded <= 0` (`reason: 'not-published'`) or when no published step has a poster blob (`reason: 'no-poster'`), otherwise delegates to `applyPosterAsProfilePictureIfMissing` with `userId: userData?.$id` and `currentUrl: userData?.profilePictureUrl`. Keeping the gating in this pure-ish function (rather than inline in the browser-only export path) is what makes it unit-testable.

- Gating on `succeeded > 0` means the picture is only assigned when the poster/video publish actually happened ("finishes a lesson and a poster image is uploaded").
- Guest publishes never reach here: `exportSegmentsToR2` returns early when not logged in (`video-processor.web.js:1253-1256`), and the inline signup has already run before generation resumes (`SuccessButtons.jsx:160-167`), so `userData.$id` is a real Supabase id.
- The original order is preserved: publish, then (non-blocking) assign the picture, then `trackEvent`/clear pending state. The call is fire-and-forget so a hung avatar upload cannot delay `publish_clips_batch_done` or the pending-publish clear.

### 3. Ensure the persistent URL renders in the recap

`loadProfileImage()` already loads `userData.profilePictureUrl` into the recap canvas and existing Supabase avatar URLs were already used there, so no change is needed; the next generated video picks up the new picture.

## Tasks

### Task 1 - Pure predicates (`src/modules/avatar/poster-avatar.test.js`, new)

- `isMissingProfilePicture(null)` / `(undefined)` / `('')`
  - → `true` for each
- `isMissingProfilePicture(defaultProfilePic)` (imported from `src/assets/img/userprofile.png`)
  - → `true`
- `isMissingProfilePicture('https://jbrbmbmupjfangqvaevx.supabase.co/storage/v1/object/public/avatars/u/avatar-1.jpg')` and `('https://r2.ultrafastfluency.com/videos/x.jpg')`
  - → `false` for each
- `pickAvatarThumb([{ type: 'webcam', thumbBlob: null }, { type: 'webcam', thumbBlob: BLOB_A }, { type: 'webcam', thumbBlob: BLOB_B }])`
  - → `BLOB_A` (first with a blob, plan order preserved)
- `pickAvatarThumb([{ type: 'webcam', thumbBlob: null }, { type: 'tailing' }])` / `([])` / `(null)` / `(undefined)`
  - → `null` for each

### Task 2 - Poster→avatar action (`src/modules/avatar/poster-avatar.test.js`, same file, mocked collaborators)

Collaborators mocked with `vi.mock`: `./avatar.service.js` (`uploadAvatarToStorage`, `deleteAvatarFromStorage`), `../api/supabase.js` (`supabase.from(...).update().eq().is().select()` chain), `../api/api.js` (`queryClient.getQueryData`/`setQueryData`), `../store/store.js` (`appStore.getState`).

- `{ thumbBlob: null, userId: 'u1', currentUrl: defaultProfilePic }` and `{ thumbBlob: BLOB, userId: null }`
  - → resolves `{ updated: false, reason: 'missing-input' }`
  - → `uploadAvatarToStorage` not called
- `{ thumbBlob: BLOB, userId: 'u1', currentUrl: 'https://…supabase.co/…/avatar-9.jpg' }`
  - → resolves `{ updated: false, reason: 'has-picture' }`
  - → `uploadAvatarToStorage` not called, no DB update
- `{ thumbBlob: BLOB, userId: 'u1', currentUrl: defaultProfilePic }` (new signup hydration) with upload succeeding and the conditional update returning one row
  - → resolves `{ updated: true, url: UPLOADED_URL }`
  - → `uploadAvatarToStorage` called once with `(BLOB, 'u1')`
  - → DB update targets `profile_picture_url: UPLOADED_URL` with `.eq('id','u1')` and `.is('profile_picture_url', null)`
  - → `queryClient.setQueryData` patches `['user','profile']` with `profilePictureUrl === UPLOADED_URL`
  - → `setCourseData` receives `userData.profilePictureUrl === UPLOADED_URL`
- `{ thumbBlob: BLOB, userId: 'u1', currentUrl: undefined }` (existing user, NULL row, no placeholder substitution) with the same happy-path mocks
  - → resolves `{ updated: true, url: UPLOADED_URL }` (covers the existing-user case)
- Happy path but the conditional update returns `data: []` (picture set elsewhere since the client read)
  - → resolves `{ updated: false, reason: 'has-picture-db' }`
  - → `deleteAvatarFromStorage(UPLOADED_URL)` called once
  - → `queryClient.setQueryData` and `setCourseData` not called
- `uploadAvatarToStorage` rejects, and separately the DB update resolves `{ error: new Error('rls') }`
  - → resolves `{ updated: false, reason: 'error' }` for each (never throws)
  - → no cache/store write

### Task 3 - Publish-flow wiring (`src/modules/video/poster-avatar-wiring.test.js`, new source guard)

The full `exportSegmentsToR2` path cannot run headlessly (MediaRecorder/canvas/WebCodecs — `agents.md` §4/§6), so the call-site is guarded the same way as the existing UGC poster wiring (`src/modules/video/poster-runtime-wiring.test.js:63-74`). The gating and assignment behavior is covered by Tasks 1-2; this guard only proves the browser-only export path actually invokes the entry point.

- `src/modules/video/video-processor.web.js` source read as text, comments stripped
  - → contains `from '../avatar/poster-avatar.js'`
  - → contains `maybeAssignPosterAvatar({` inside the `exportSegmentsToR2` body (the substring from `export async function exportSegmentsToR2` to end of file — it is the last function in the module)
  - → the call passes `publishable` and `succeeded`
- `maybeAssignPosterAvatar` behavior (`src/modules/avatar/poster-avatar.test.js`)
  - → `succeeded: 0` → `{ updated: false, reason: 'not-published' }`, no upload
  - → `succeeded: 1` with no step carrying a `thumbBlob` → `{ updated: false, reason: 'no-poster' }`, no upload
  - → `succeeded: 2` with a later step carrying a blob → `{ updated: true, url }`, upload called with that blob and the user id
  - → `succeeded: 1` with a custom `profilePictureUrl` → `{ updated: false, reason: 'has-picture' }`, no upload
- `npm test -- --run` includes and passes this guard

## Technical Context

- **No new dependencies.** Reuses `@supabase/supabase-js` 2.112.4 (`src/modules/api/supabase.js`), `@tanstack/react-query` 5.100.14, `zustand` 5.0.13. Unit tests: vitest 4.1.6 + jsdom 29.1.1 (`vitest.config.js` runs colocated `*.test.js`, excludes `tests/**`/`*.spec.js`). Gate: `npm test -- --run`.
- **Existing poster blob is the same image uploaded to R2.** `publishable` steps carry `thumbBlob` from the recording (`video-processor-logic.js:258`); the R2 sibling `.jpg` upload at `video-processor.web.js:1353-1359` uses exactly that blob, so no extra rendering/fetching is required.
- **Persistent avatar storage:** `uploadAvatarToStorage(blob, userId)` uploads to `avatars/<userId>/avatar-<ts>.jpg` and returns the public URL (`avatar.service.js:82-100`); `deleteAvatarFromStorage(url)` extracts the path from a Supabase URL and removes it (`avatar.service.js:121-141`) — used to clean up an orphan upload when the DB slot was already taken.
- **Column mapping:** use the snake_case column directly (`profile_picture_url`); `toDbColumns` is only needed for the camelCase alias used by `syncUserMetaDataMutation` (`api.js:11-51`). The conditional claim uses the raw Supabase client, matching `useAddFriendLinkMutation` (`api.js:324-346`).
- **Cache/store sync precedent:** `useAvatarUpload.onSuccess` patches `['user','profile']` and calls `setCourseData({ userData: { ...currentUserData, profilePictureUrl } })` (`use-avatar-upload.js:55-71`); `setCourseData` merges only the keys supplied (`store.js:330-335`). This logic is extracted to `syncAvatarUrlToClientStores` (`src/modules/avatar/avatar-client-store.js`) and shared by both avatar paths.
- **`defaultProfilePic` identity:** every profile read imports the same asset module (`api.js:6`, `auth-check.js:2`), so `url === defaultProfilePic` holds for the substituted placeholder in both dev and build.
- **R2 TTL:** `wrangler.toml` documents a 48h lifecycle for the `videos/` prefix (dashboard-managed), so R2 poster URLs are not durable; this is why the image is copied to Supabase Storage.
- **`$id` availability:** `exportSegmentsToR2` already reads `userData?.shareCode` (`video-processor.web.js:1258`) and requires a logged-in Supabase user; `$id` is set by bootstrap/signup (`SignupForm.jsx:77`).

## Notes

- **Confirmed product behaviour (user request):** on finishing a lesson that uploads a poster, if the user (brand-new signup or existing) has no profile picture, that poster becomes the profile picture.
- **Decision (assumption, evidenced):** the picture is stored in the Supabase `avatars` bucket rather than pointing at the R2 poster URL, because R2 `videos/` expires after 48h. Same image bytes; durable URL.
- **Decision (assumption, evidenced):** "has no profile picture" is SQL `NULL` / the bundled placeholder. A non-null custom avatar is never overwritten, enforced twice (client early-return and the `.is('profile_picture_url', null)` conditional claim) so a stale client cannot clobber an avatar set elsewhere.
- **Decision (assumption):** the first publishable webcam step's `thumbBlob` (earliest answer) is the poster used, via `pickAvatarThumb`. There is one poster per segment; only the first is needed to fill the empty avatar slot, and it is the same image as that segment's R2 poster.
- **Decision:** assignment happens only when `succeeded > 0` (the publish actually landed) and only for logged-in users, which excludes guests.
- **Failures are non-fatal.** `applyPosterAsProfilePictureIfMissing` catches and returns; the publish result is unchanged. Keep the existing `[ExportSegments]` logs and add `[PosterAvatar]` success/skip/failure logs (`agents.md` §2).
- **Documentation (non-automatable).** `docs/product.md` already lists the behavior in Features, with the legacy-URL edge in Known Limitations (updated in this planning commit). During implementation, add one line to the `agents.md` "Posters are R2-only, generated and uploaded on push" section: a published UGC poster is also copied into the Supabase `avatars` bucket as the profile picture when the user has none, because the R2 `videos/` object expires after 48h.
- **Manual verification:** as a guest, finish a lesson, sign up in the `SaveClipsModal`, let the video generate, then open the profile page and confirm the avatar is the learner's poster (not the placeholder) and survives a reload; as a user with an uploaded avatar, finish a lesson and confirm the uploaded avatar is unchanged.
