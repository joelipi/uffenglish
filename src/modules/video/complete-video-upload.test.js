// src/modules/video/complete-video-upload.test.js
// Unit tests for uploadCompleteVideoToR2 — the best-effort R2 upload of the
// concatenated recap. All collaborators are mocked; the browser MediaRecorder /
// canvas / WebCodecs path cannot run in vitest.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./transcode.js', () => ({
    transcodeToMp4: vi.fn(),
    verifyMp4: vi.fn(),
    uploadWebmToCloudinary: vi.fn(),
    probeClipDurationSec: vi.fn(),
}));
vi.mock('./r2-upload.js', () => ({ uploadSegmentToR2: vi.fn() }));
vi.mock('../api/supabase.js', () => ({
    supabase: {},
    getAccessToken: vi.fn(),
}));
vi.mock('../store/store.js', () => ({ appStore: { getState: vi.fn() } }));
vi.mock('../utils/posthog.js', () => ({ trackEvent: vi.fn() }));
// Keep the module import light: these are only used by other exports.
vi.mock('../storage/storage.js', () => ({ getAllSpeechRecordingsForLesson: vi.fn() }));
vi.mock('../avatar/poster-avatar.js', () => ({ maybeAssignPosterAvatar: vi.fn() }));

import { transcodeToMp4, verifyMp4, uploadWebmToCloudinary } from './transcode.js';
import { uploadSegmentToR2 } from './r2-upload.js';
import { getAccessToken } from '../api/supabase.js';
import { appStore } from '../store/store.js';
import { trackEvent } from '../utils/posthog.js';
import { uploadCompleteVideoToR2, MAX_R2_UPLOAD_BYTES } from './video-processor.web.js';

const BLOB = new Blob(['recap'], { type: 'video/webm' });
const MP4 = new Blob(['mp4'], { type: 'video/mp4' });
const UPLOADED_URL = 'https://r2.ultrafastfluency.com/videos/ab12-model-w-complete.mp4';

function loggedInState(overrides = {}) {
    return {
        isLoggedIn: true,
        userData: { shareCode: 'ab12' },
        courseId: 'model',
        ...overrides,
    };
}

beforeEach(() => {
    vi.resetAllMocks();
    appStore.getState.mockReturnValue(loggedInState());
    transcodeToMp4.mockResolvedValue(MP4);
    verifyMp4.mockResolvedValue(true);
    uploadWebmToCloudinary.mockResolvedValue(MP4);
    uploadSegmentToR2.mockResolvedValue({ url: UPLOADED_URL });
    getAccessToken.mockResolvedValue('jwt-token');
});

describe('uploadCompleteVideoToR2', () => {
    it('skips without transcoding when there is no blob', async () => {
        const result = await uploadCompleteVideoToR2(null, 'w');
        expect(result).toEqual({ uploaded: false, reason: 'no-blob' });
        expect(transcodeToMp4).not.toHaveBeenCalled();
        expect(uploadSegmentToR2).not.toHaveBeenCalled();
    });

    it('skips when the user is not logged in', async () => {
        appStore.getState.mockReturnValue(loggedInState({ isLoggedIn: false }));
        const result = await uploadCompleteVideoToR2(BLOB, 'w');
        expect(result).toEqual({ uploaded: false, reason: 'not-logged-in' });
        expect(uploadSegmentToR2).not.toHaveBeenCalled();
    });

    it('skips when shareCode or courseId is missing', async () => {
        appStore.getState.mockReturnValue(loggedInState({ userData: {} }));
        const noShare = await uploadCompleteVideoToR2(BLOB, 'w');
        expect(noShare).toEqual({ uploaded: false, reason: 'missing-key-parts' });

        appStore.getState.mockReturnValue(loggedInState({ courseId: null }));
        const noCourse = await uploadCompleteVideoToR2(BLOB, 'w');
        expect(noCourse).toEqual({ uploaded: false, reason: 'missing-key-parts' });

        expect(uploadSegmentToR2).not.toHaveBeenCalled();
    });

    it('transcodes and uploads under the complete key on the happy path', async () => {
        const result = await uploadCompleteVideoToR2(BLOB, 'w');

        expect(result).toEqual({ uploaded: true, url: UPLOADED_URL });
        expect(transcodeToMp4).toHaveBeenCalledWith(BLOB);
        expect(uploadSegmentToR2).toHaveBeenCalledTimes(1);
        expect(uploadSegmentToR2).toHaveBeenCalledWith({
            blob: MP4,
            key: 'videos/ab12-model-w-complete.mp4',
            jwt: 'jwt-token',
            shareCode: 'ab12',
            contentType: 'video/mp4',
        });
        expect(trackEvent).toHaveBeenCalledWith('publish_complete_video_success', expect.objectContaining({ lessonId: 'w' }));
    });

    it('carries the co-participant code into a co-authored B key', async () => {
        appStore.getState.mockReturnValue(loggedInState({ courseId: 'friend' }));

        const result = await uploadCompleteVideoToR2(BLOB, 'b', 'cd34');

        expect(result).toEqual({ uploaded: true, url: UPLOADED_URL });
        expect(uploadSegmentToR2).toHaveBeenCalledTimes(1);
        expect(uploadSegmentToR2).toHaveBeenCalledWith(expect.objectContaining({
            key: 'videos/ab12-cd34-friend-b-complete.mp4',
        }));
    });

    it('defaults otherShareCode to null and keeps the single-code key (2-arg unchanged)', async () => {
        await uploadCompleteVideoToR2(BLOB, 'w');

        expect(uploadSegmentToR2).toHaveBeenCalledWith(expect.objectContaining({
            key: 'videos/ab12-model-w-complete.mp4',
        }));
    });

    it('skips the upload when the transcoded blob exceeds the 50 MB cap', async () => {
        const big = new Blob([new Uint8Array(MAX_R2_UPLOAD_BYTES + 1)], { type: 'video/mp4' });
        transcodeToMp4.mockResolvedValue(big);

        const result = await uploadCompleteVideoToR2(BLOB, 'w');

        expect(result).toEqual({ uploaded: false, reason: 'too-large' });
        expect(uploadSegmentToR2).not.toHaveBeenCalled();
        expect(trackEvent).toHaveBeenCalledWith('publish_complete_video_skipped', expect.objectContaining({ lessonId: 'w' }));
    });

    it('uploads a blob exactly at the 50 MB cap (boundary is inclusive)', async () => {
        const atCap = new Blob([new Uint8Array(MAX_R2_UPLOAD_BYTES)], { type: 'video/mp4' });
        transcodeToMp4.mockResolvedValue(atCap);

        const result = await uploadCompleteVideoToR2(BLOB, 'w');

        expect(result).toEqual({ uploaded: true, url: UPLOADED_URL });
        expect(uploadSegmentToR2).toHaveBeenCalledWith(expect.objectContaining({ blob: atCap }));
    });

    it('falls back to Cloudinary when WebCodecs is unavailable', async () => {
        transcodeToMp4.mockRejectedValue(new Error('webcodecs-unavailable'));

        const result = await uploadCompleteVideoToR2(BLOB, 'w');

        expect(result).toEqual({ uploaded: true, url: UPLOADED_URL });
        expect(uploadWebmToCloudinary).toHaveBeenCalledWith(BLOB);
        expect(uploadSegmentToR2).toHaveBeenCalledWith(expect.objectContaining({ key: 'videos/ab12-model-w-complete.mp4' }));
    });

    it('falls back to Cloudinary when the WebCodecs result fails the mp4 check', async () => {
        verifyMp4.mockResolvedValue(false);

        const result = await uploadCompleteVideoToR2(BLOB, 'w');

        expect(result).toEqual({ uploaded: true, url: UPLOADED_URL });
        expect(uploadWebmToCloudinary).toHaveBeenCalledWith(BLOB);
    });

    it('returns a non-fatal error when both transcode paths fail', async () => {
        transcodeToMp4.mockRejectedValue(new Error('webcodecs-unavailable'));
        uploadWebmToCloudinary.mockRejectedValue(new Error('cloudinary down'));

        const result = await uploadCompleteVideoToR2(BLOB, 'w');

        expect(result).toEqual({ uploaded: false, reason: 'error' });
        expect(uploadSegmentToR2).not.toHaveBeenCalled();
        expect(trackEvent).toHaveBeenCalledWith('publish_complete_video_failed', expect.objectContaining({ lessonId: 'w' }));
    });

    it('returns a non-fatal error when the R2 upload rejects', async () => {
        uploadSegmentToR2.mockRejectedValue(new Error('HTTP 500'));

        const result = await uploadCompleteVideoToR2(BLOB, 'w');

        expect(result).toEqual({ uploaded: false, reason: 'error' });
        expect(trackEvent).toHaveBeenCalledWith('publish_complete_video_failed', expect.objectContaining({ lessonId: 'w' }));
    });
});
