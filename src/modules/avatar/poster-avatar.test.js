// src/modules/avatar/poster-avatar.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./avatar.service.js', () => ({
    uploadAvatarToStorage: vi.fn(),
    deleteAvatarFromStorage: vi.fn(),
}));
vi.mock('../api/supabase.js', () => ({
    supabase: { from: vi.fn() },
}));
vi.mock('../api/api.js', () => ({
    queryClient: { getQueryData: vi.fn(), setQueryData: vi.fn() },
}));
vi.mock('../store/store.js', () => ({
    appStore: { getState: vi.fn() },
}));

import { uploadAvatarToStorage, deleteAvatarFromStorage } from './avatar.service.js';
import { supabase } from '../api/supabase.js';
import { queryClient } from '../api/api.js';
import { appStore } from '../store/store.js';
import defaultProfilePic from '../../assets/img/userprofile.png';
import {
    isMissingProfilePicture,
    pickAvatarThumb,
    applyPosterAsProfilePictureIfMissing,
} from './poster-avatar.js';

const BLOB = new Blob(['poster'], { type: 'image/jpeg' });
const OTHER_BLOB = new Blob(['other'], { type: 'image/jpeg' });
const UPLOADED_URL = 'https://example.supabase.co/storage/v1/object/public/avatars/u1/avatar-1.jpg';
const CUSTOM_URL = 'https://example.supabase.co/storage/v1/object/public/avatars/u1/avatar-9.jpg';

// Minimal stand-in for the PostgREST chain
// supabase.from(table).update(values).eq(col, val).is(col, null).select(cols).
function mockUpdateChain(result) {
    const chain = {};
    chain.update = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.is = vi.fn(() => chain);
    chain.select = vi.fn(() => Promise.resolve(result));
    supabase.from.mockReturnValue(chain);
    return chain;
}

beforeEach(() => {
    vi.resetAllMocks();
    uploadAvatarToStorage.mockResolvedValue(UPLOADED_URL);
    deleteAvatarFromStorage.mockResolvedValue(undefined);
    queryClient.getQueryData.mockReturnValue(undefined);
    appStore.getState.mockReturnValue({ userData: null, setCourseData: vi.fn() });
});

describe('isMissingProfilePicture', () => {
    it('is true for null, undefined and the empty string', () => {
        expect(isMissingProfilePicture(null)).toBe(true);
        expect(isMissingProfilePicture(undefined)).toBe(true);
        expect(isMissingProfilePicture('')).toBe(true);
    });

    it('is true for the bundled placeholder', () => {
        expect(isMissingProfilePicture(defaultProfilePic)).toBe(true);
    });

    it('is false for a real custom picture URL', () => {
        expect(isMissingProfilePicture(CUSTOM_URL)).toBe(false);
        expect(isMissingProfilePicture('https://r2.ultrafastfluency.com/videos/x.jpg')).toBe(false);
    });
});

describe('pickAvatarThumb', () => {
    it('returns the first step blob that has one, preserving plan order', () => {
        const steps = [
            { type: 'webcam', thumbBlob: null },
            { type: 'webcam', thumbBlob: BLOB },
            { type: 'webcam', thumbBlob: OTHER_BLOB },
        ];
        expect(pickAvatarThumb(steps)).toBe(BLOB);
    });

    it('returns null when no step has a thumb or the input is not an array', () => {
        expect(pickAvatarThumb([{ type: 'webcam', thumbBlob: null }, { type: 'tailing' }])).toBe(null);
        expect(pickAvatarThumb([])).toBe(null);
        expect(pickAvatarThumb(null)).toBe(null);
        expect(pickAvatarThumb(undefined)).toBe(null);
    });
});

describe('applyPosterAsProfilePictureIfMissing', () => {
    it('skips (without uploading) when the blob or user id is missing', async () => {
        const a = await applyPosterAsProfilePictureIfMissing({ thumbBlob: null, userId: 'u1', currentUrl: defaultProfilePic });
        const b = await applyPosterAsProfilePictureIfMissing({ thumbBlob: BLOB, userId: null });
        expect(a).toEqual({ updated: false, reason: 'missing-input' });
        expect(b).toEqual({ updated: false, reason: 'missing-input' });
        expect(uploadAvatarToStorage).not.toHaveBeenCalled();
        expect(supabase.from).not.toHaveBeenCalled();
    });

    it('skips (without uploading) when the user already has a custom picture', async () => {
        const setCourseData = vi.fn();
        appStore.getState.mockReturnValue({ userData: { $id: 'u1' }, setCourseData });

        const result = await applyPosterAsProfilePictureIfMissing({ thumbBlob: BLOB, userId: 'u1', currentUrl: CUSTOM_URL });

        expect(result).toEqual({ updated: false, reason: 'has-picture' });
        expect(uploadAvatarToStorage).not.toHaveBeenCalled();
        expect(supabase.from).not.toHaveBeenCalled();
        expect(setCourseData).not.toHaveBeenCalled();
    });

    it('uploads the poster and claims the empty slot for a new signup (placeholder current URL)', async () => {
        const chain = mockUpdateChain({ data: [{ id: 'u1' }], error: null });
        const setCourseData = vi.fn();
        appStore.getState.mockReturnValue({ userData: { $id: 'u1', native_language: 'en' }, setCourseData });
        queryClient.getQueryData.mockReturnValue({ $id: 'u1' });

        const result = await applyPosterAsProfilePictureIfMissing({ thumbBlob: BLOB, userId: 'u1', currentUrl: defaultProfilePic });

        expect(result).toEqual({ updated: true, url: UPLOADED_URL });
        expect(uploadAvatarToStorage).toHaveBeenCalledTimes(1);
        expect(uploadAvatarToStorage).toHaveBeenCalledWith(BLOB, 'u1');
        expect(supabase.from).toHaveBeenCalledWith('user_profiles');
        expect(chain.update).toHaveBeenCalledWith({ profile_picture_url: UPLOADED_URL });
        expect(chain.eq).toHaveBeenCalledWith('id', 'u1');
        expect(chain.is).toHaveBeenCalledWith('profile_picture_url', null);
        expect(queryClient.setQueryData).toHaveBeenCalledWith(
            ['user', 'profile'],
            expect.objectContaining({ profilePictureUrl: UPLOADED_URL }),
        );
        expect(setCourseData).toHaveBeenCalledWith({
            userData: expect.objectContaining({ profilePictureUrl: UPLOADED_URL, $id: 'u1', native_language: 'en' }),
        });
        expect(deleteAvatarFromStorage).not.toHaveBeenCalled();
    });

    it('uploads the poster for an existing user whose row has no picture (undefined current URL)', async () => {
        mockUpdateChain({ data: [{ id: 'u1' }], error: null });
        appStore.getState.mockReturnValue({ userData: { $id: 'u1' }, setCourseData: vi.fn() });

        const result = await applyPosterAsProfilePictureIfMissing({ thumbBlob: BLOB, userId: 'u1', currentUrl: undefined });

        expect(result).toEqual({ updated: true, url: UPLOADED_URL });
        expect(uploadAvatarToStorage).toHaveBeenCalledWith(BLOB, 'u1');
    });

    it('discards the orphan upload when the DB slot was claimed since the client read', async () => {
        mockUpdateChain({ data: [], error: null });
        const setCourseData = vi.fn();
        appStore.getState.mockReturnValue({ userData: { $id: 'u1' }, setCourseData });

        const result = await applyPosterAsProfilePictureIfMissing({ thumbBlob: BLOB, userId: 'u1', currentUrl: defaultProfilePic });

        expect(result).toEqual({ updated: false, reason: 'has-picture-db' });
        expect(deleteAvatarFromStorage).toHaveBeenCalledTimes(1);
        expect(deleteAvatarFromStorage).toHaveBeenCalledWith(UPLOADED_URL);
        expect(queryClient.setQueryData).not.toHaveBeenCalled();
        expect(setCourseData).not.toHaveBeenCalled();
    });

    it('returns a non-fatal error result when the upload fails', async () => {
        uploadAvatarToStorage.mockRejectedValue(new Error('storage down'));
        const setCourseData = vi.fn();
        appStore.getState.mockReturnValue({ userData: { $id: 'u1' }, setCourseData });

        const result = await applyPosterAsProfilePictureIfMissing({ thumbBlob: BLOB, userId: 'u1', currentUrl: defaultProfilePic });

        expect(result).toEqual({ updated: false, reason: 'error' });
        expect(supabase.from).not.toHaveBeenCalled();
        expect(setCourseData).not.toHaveBeenCalled();
    });

    it('returns a non-fatal error result when the DB update fails', async () => {
        mockUpdateChain({ data: null, error: new Error('rls') });
        const setCourseData = vi.fn();
        appStore.getState.mockReturnValue({ userData: { $id: 'u1' }, setCourseData });

        const result = await applyPosterAsProfilePictureIfMissing({ thumbBlob: BLOB, userId: 'u1', currentUrl: defaultProfilePic });

        expect(result).toEqual({ updated: false, reason: 'error' });
        expect(deleteAvatarFromStorage).not.toHaveBeenCalled();
        expect(setCourseData).not.toHaveBeenCalled();
    });
});
