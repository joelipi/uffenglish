// modules/avatar/poster-avatar.js
// Uses a finished lesson's poster still (the first answer's raw webcam
// thumbnail) as the learner's profile picture when they do not already have one.
//
// The poster is uploaded to R2 under the `videos/` prefix, which has a 48h
// lifecycle TTL, so the R2 URL is not durable. The same in-memory blob is copied
// into the persistent Supabase `avatars` bucket instead.
import defaultProfilePic from '../../assets/img/userprofile.png';
import { supabase } from '../api/supabase.js';
import { uploadAvatarToStorage, deleteAvatarFromStorage } from './avatar.service.js';
import { syncAvatarUrlToClientStores } from './avatar-client-store.js';

// "No profile picture" == falsy, or exactly the bundled placeholder that every
// profile read substitutes for a NULL profile_picture_url (api.js:146).
// Any other non-empty string is a real picture and must never be replaced.
// NOTE: an expiring R2 `videos/` URL is deliberately treated as "has a picture"
// (a legacy non-null-but-broken cleanup is out of scope, story 019).
export function isMissingProfilePicture(url) {
    return !url || url === defaultProfilePic;
}

// First publishable webcam step that has a poster blob; null when none does.
// `publishable` is already filtered to webcam, non-text-mode steps with a video
// blob (video-processor.web.js:1278-1280) and preserves plan order.
export function pickAvatarThumb(publishable) {
    if (!Array.isArray(publishable)) return null;
    return publishable.find((s) => s?.thumbBlob)?.thumbBlob || null;
}

// Copies `thumbBlob` into the avatars bucket and claims the profile's picture
// slot only if it is still empty. Never throws: a poster→avatar failure must
// never fail the lesson publish.
export async function applyPosterAsProfilePictureIfMissing({ thumbBlob, userId, currentUrl } = {}) {
    if (!thumbBlob || !userId) {
        console.log('[PosterAvatar] skipped — missing thumbBlob or userId');
        return { updated: false, reason: 'missing-input' };
    }
    if (!isMissingProfilePicture(currentUrl)) {
        console.log('[PosterAvatar] skipped — user already has a profile picture');
        return { updated: false, reason: 'has-picture' };
    }

    let url = null;
    try {
        url = await uploadAvatarToStorage(thumbBlob, userId);

        // Atomic guard: only fill the slot if the DB row still has no picture,
        // so an avatar set on another device is never clobbered by a stale client.
        const { data, error } = await supabase
            .from('user_profiles')
            .update({ profile_picture_url: url })
            .eq('id', userId)
            .is('profile_picture_url', null)
            .select('id');
        if (error) throw error;

        if (!data || data.length === 0) {
            // Somebody set a picture between our read and this claim. Remove the
            // orphan upload; deleteAvatarFromStorage swallows its own errors.
            await deleteAvatarFromStorage(url);
            console.log('[PosterAvatar] skipped — profile already has a picture in DB');
            return { updated: false, reason: 'has-picture-db' };
        }

        syncAvatarUrlToClientStores(url);

        console.log('[PosterAvatar] profile picture set from lesson poster:', url);
        return { updated: true, url };
    } catch (e) {
        // The DB claim failed, so the upload is an orphan — remove it (the R2
        // upload path is deterministic per segment, so nothing else owns it).
        if (url) {
            await deleteAvatarFromStorage(url);
        }
        console.error('[PosterAvatar] failed (non-fatal):', e);
        return { updated: false, reason: 'error' };
    }
}

// Publish-flow entry point: assigns the first published webcam poster as the
// profile picture when the user has none. Returns early (without uploading) when
// the publish produced no segment (`succeeded <= 0`) or no poster blob exists,
// so the gating is unit-testable without the browser-only export path.
export async function maybeAssignPosterAvatar({ publishable, succeeded, userData } = {}) {
    if (!succeeded || succeeded <= 0) {
        console.log('[PosterAvatar] skipped — no published segment');
        return { updated: false, reason: 'not-published' };
    }
    const thumbBlob = pickAvatarThumb(publishable);
    if (!thumbBlob) {
        console.log('[PosterAvatar] skipped — no poster blob on any published step');
        return { updated: false, reason: 'no-poster' };
    }
    return applyPosterAsProfilePictureIfMissing({
        thumbBlob,
        userId: userData?.$id,
        currentUrl: userData?.profilePictureUrl,
    });
}
