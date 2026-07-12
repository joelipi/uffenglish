// video-share.web.js
// Web-only module — uses navigator.share / navigator.canShare + XMLHttpRequest to Cloudinary.
// React Native replaces this with video-share.native.js.
import Strings from '../../data/strings.js';
import { transcodeToMp4, verifyMp4, uploadWebmToCloudinary } from './transcode.js';
export const CLOUDINARY_CLOUD_NAME = 'dnolem9if';
export const CLOUDINARY_UPLOAD_PRESET = 'default';

export async function shareVideo(blob, filename, fileExtension) {
    try {
        if (!blob) {
            console.warn('[VideoShare] No blob provided');
            return;
        }

        let mp4Blob = blob;
        let mp4Name = filename;

        if (fileExtension === 'mp4') {
            // Already mp4 — share directly, no transcode needed.
            if (!mp4Name) mp4Name = 'uffenglish.mp4';
        } else {
            // Webm (or other non-mp4): transcode in-browser via WebCodecs.
            // If WebCodecs can't encode H.264/AAC, fall back to Cloudinary
            // server-side re-encode. The result is an mp4 for local sharing
            // only — this is NEVER uploaded to R2.
            try {
                const transcoded = await transcodeToMp4(blob);
                if (transcoded && await verifyMp4(transcoded)) {
                    mp4Blob = transcoded;
                    console.log('[VideoShare] Transcoded to mp4 via WebCodecs.');
                } else {
                    throw new Error('verify-failed');
                }
            } catch (e) {
                if (e?.message !== 'webcodecs-unavailable' && e?.message !== 'verify-failed') {
                    console.warn('[VideoShare] WebCodecs transcode error, falling back to Cloudinary:', e?.message);
                } else {
                    console.warn('[VideoShare] WebCodecs unavailable, falling back to Cloudinary.');
                }
                mp4Blob = await uploadWebmToCloudinary(blob);
                console.log('[VideoShare] Transcoded to mp4 via Cloudinary.');
            }
            if (!mp4Name) mp4Name = 'uffenglish.webm';
            mp4Name = mp4Name.replace(/\.webm$/i, '.mp4');
        }

        const mp4File = new File([mp4Blob], mp4Name, { type: 'video/mp4' });
        if (navigator.canShare && navigator.canShare({ files: [mp4File] })) {
            await navigator.share({
                title: Strings.get('share_title'),
                text: Strings.get('share_text'),
                files: [mp4File]
            });
        } else {
            console.warn('[VideoShare] navigator.share not available.');
        }
    } catch (e) {
        console.error('[VideoShare] Error:', e.message);
        throw e;
    }
}

export function deleteFromCloudinary(deleteToken) {
    try {
        const xhr = new XMLHttpRequest();
        const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/delete_by_token`;
        xhr.open('POST', url, true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(JSON.stringify({ token: deleteToken }));
    } catch (e) {
        console.warn('Failed to delete temporary video from Cloudinary:', e);
    }
}

export function uploadWithXHR(url, fileOrBlob, preset, filename) {
    return new Promise((resolve, reject) => {
        try {
            const xhr = new XMLHttpRequest();
            const formData = new FormData();
            formData.append('file', fileOrBlob, filename || 'video.webm');
            formData.append('upload_preset', preset);
            formData.append('resource_type', 'video');
            formData.append('return_delete_token', 'true');
            xhr.open('POST', url, true);
            xhr.onload = function () {
                if (xhr.status === 200) {
                    try { resolve({ ok: true, data: JSON.parse(xhr.responseText) }); }
                    catch { resolve({ ok: false, error: 'Invalid response format' }); }
                } else {
                    try {
                        const err = JSON.parse(xhr.responseText);
                        resolve({ ok: false, error: err.error?.message || `HTTP ${xhr.status}` });
                    } catch {
                        resolve({ ok: false, error: `HTTP ${xhr.status}: ${xhr.statusText}` });
                    }
                }
            };
            xhr.onerror = function () { reject(new Error('Network error')); };
            xhr.send(formData);
        } catch (e) { reject(e); }
    });
}

export function toMp4DeliveryUrl(secureUrl) {
    try {
        const url = new URL(secureUrl);
        url.pathname = url.pathname.replace('/upload/', '/upload/f_mp4/');
        url.pathname = url.pathname.replace(/\.(webm|mkv|mov|avi)$/i, '.mp4');
        return url.toString();
    } catch {
        return secureUrl.replace('/upload/', '/upload/f_mp4/').replace(/\.(webm|mkv|mov|avi)$/i, '.mp4');
    }
}
