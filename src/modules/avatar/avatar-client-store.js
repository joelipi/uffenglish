// modules/avatar/avatar-client-store.js
// Shared client-side cache/store sync for a changed avatar URL. Both the
// manual avatar upload (use-avatar-upload.js) and the automatic
// poster→profile-picture assignment (poster-avatar.js) must keep the React
// Query profile cache and the Zustand store in step, so the chat/recap
// pipelines use the new URL without a refetch.
import { queryClient } from '../api/api.js';
import { appStore } from '../store/store.js';

export function syncAvatarUrlToClientStores(url) {
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
}
