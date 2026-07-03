// modules/avatar/use-avatar-upload.js
// TanStack Query mutation for uploading a cropped avatar.
// Auth path: Appwrite Storage -> profilePictureUrl row update.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { uploadAvatarToStorage, deleteAvatarFromStorage } from './avatar.service.js';
import { syncUserMetaDataMutation } from '../api/api.js';
import { appStore } from '../store/store.js';

/**
 * Hook that uploads a cropped avatar blob to Appwrite Storage and writes the
 * resulting public URL into the user's `profilePictureUrl` field.
 * Before uploading, deletes the previous avatar file from Storage if one exists.
 *
 * @returns {UseMutationResult<string, Error, { blob: Blob, userId: string }>}
 */
export function useAvatarUpload() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ blob, userId }) => {
            console.log('[useAvatarUpload] Starting upload mutation for user:', userId);

            if (!blob || !(blob instanceof Blob)) {
                console.error('[useAvatarUpload] Invalid blob:', blob);
                throw new Error('Avatar upload requires a Blob');
            }
            if (!userId) {
                console.error('[useAvatarUpload] Missing userId');
                throw new Error('Avatar upload requires an authenticated userId');
            }

            const currentProfilePictureUrl = appStore.getState().userData?.profilePictureUrl;
            console.log('[useAvatarUpload] Current profile picture URL:', currentProfilePictureUrl);
            if (currentProfilePictureUrl) {
                console.log('[useAvatarUpload] Found existing avatar URL, deleting old file...');
                try {
                    await deleteAvatarFromStorage(currentProfilePictureUrl);
                    console.log('[useAvatarUpload] Old avatar deleted successfully');
                } catch (deleteErr) {
                    console.warn('[useAvatarUpload] Failed to delete old avatar (continuing):', deleteErr);
                }
            }

            console.log('[useAvatarUpload] Uploading new avatar to storage...');
            const avatarUrl = await uploadAvatarToStorage(blob, userId);
            console.log('[useAvatarUpload] Upload complete, new URL:', avatarUrl);
            
            console.log('[useAvatarUpload] Syncing metadata to database...');
            await syncUserMetaDataMutation({ profilePictureUrl: avatarUrl }, userId);
            console.log('[useAvatarUpload] Metadata sync complete');

            console.log('[useAvatarUpload] Avatar upload + profile sync complete:', avatarUrl);
            return avatarUrl;
        },
        onSuccess: (avatarUrl) => {
            // Update TanStack Query cache immediately
            const currentData = queryClient.getQueryData(['user', 'profile']);
            if (currentData) {
                queryClient.setQueryData(['user', 'profile'], {
                    ...currentData,
                    profilePictureUrl: avatarUrl
                });
            }

            // Sync the zustand store so chat message pipeline uses the new URL
            const currentUserData = appStore.getState().userData;
            if (currentUserData) {
                appStore.getState().setCourseData({
                    userData: { ...currentUserData, profilePictureUrl: avatarUrl }
                });
            }

            console.log('[useAvatarUpload] Mutation succeeded:', avatarUrl);
        },
        onError: (error) => {
            console.error('[useAvatarUpload] Mutation failed:', error);
        }
    });
}
