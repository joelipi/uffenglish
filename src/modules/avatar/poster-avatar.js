// modules/avatar/poster-avatar.js
// Uses a finished lesson's poster still (the first answer's raw webcam
// thumbnail) as the learner's profile picture when they do not already have one.
//
// The poster is uploaded to R2 under the `videos/` prefix, which has a 48h
// lifecycle TTL, so the R2 URL is not durable. The same in-memory blob is copied
// into the persistent Supabase `avatars` bucket instead.
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

    try {
        const url = await uploadAvatarToStorage(thumbBlob, userId);

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

        // Keep the React Query cache and the Zustand store in sync, mirroring
        // useAvatarUpload.onSuccess so the chat/recap pipelines use the new URL.
        const currentData = queryClient.getQueryData(['user', 'profile']);
        if (currentData) {
            queryClient.setQueryData(['user', 'profile'], {
                ...currentData,
                profilePictureUrl: url,
            });
        }
        const currentUserData = appStore.getState().userData;
        if (currentUserData) {
            appStore.getState().setCourseData({
                userData: { ...currentUserData, profilePictureUrl: url },
            });
        }

        console.log('[PosterAvatar] profile picture set from lesson poster:', url);
        return { updated: true, url };
    } catch (e) {
        console.error('[PosterAvatar] failed (non-fatal):', e);
        return { updated: false, reason: 'error' };
    }
}
