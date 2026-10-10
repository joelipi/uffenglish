// video-share.web.js
// Web-only module — uses navigator.share / navigator.canShare + XMLHttpRequest to Cloudinary.
// React Native replaces this with video-share.native.js.
import Strings from '../../data/strings.js';
import { appStore } from '../store/store.js';
import { buildShareUrl } from './video-processor-logic.js';
import { toFriendLessonHref } from '../user/friend-lesson-link-logic.js';
import { transcodeToMp4, verifyMp4, uploadWebmToCloudinary } from './transcode.js';
export const CLOUDINARY_CLOUD_NAME = 'dnolem9if';
export const CLOUDINARY_UPLOAD_PRESET = 'default';

/**
 * The message attached when sharing a recap video: a localized call to action
 * with the learner's personal share link (host + share code). Falls back to the
 * bare host when the session has no share code.
 *
 * The URL is scheme-qualified (https://) so it is clickable in the shared
 * message — buildShareUrl is deliberately scheme-less because the recap CTA
 * displays it for manual typing.
 */
export function buildShareMessage() {
    const { userData, guestNativeLanguage } = appStore.getState();
    const lang = guestNativeLanguage || userData?.native_language || 'en';
    const url = toFriendLessonHref(buildShareUrl(userData?.shareCode));
    return Strings.get('share_message', lang, { url });
}

export async function shareVideo(blob, filename, fileExtension) {
    try {
        if (!blob) {
            console.warn('[VideoShare] No blob provided');
            return;
        }
        console.log('[VideoShare] starting share:', { ext: fileExtension, bytes: blob.size, name: filename });

        const { blob: mp4Blob, name: mp4Name } = await ensureMp4Blob(blob, filename, fileExtension);

        const mp4File = new File([mp4Blob], mp4Name, { type: 'video/mp4' });
        if (navigator.canShare && navigator.canShare({ files: [mp4File] })) {
            try {
                await navigator.share({
                    title: Strings.get('share_title'),
                    text: buildShareMessage(),
                    files: [mp4File]
                });
                console.log('[VideoShare] share completed');
            } catch (e) {
                // Dismissing the sheet is normal user behavior — not an
                // error and never fatal. Anything else still throws below.
                if (e?.name === 'AbortError') {
                    console.log('[VideoShare] share dismissed by user');
                    return;
                }
                throw e;
            }
        } else {
            console.warn('[VideoShare] navigator.share not available.');
        }
    } catch (e) {
        console.error('[VideoShare] Error:', e.message);
        throw e;
    }
}

/**
 * Ensures an mp4 payload (and its filename) for local delivery — shared by
 * the native sheet and the desktop download. Already-mp4 blobs pass
 * through untouched; anything else is transcoded in-browser via WebCodecs
 * with the Cloudinary server-side fallback. Local-only: never uploaded.
 *
 * @returns {{ blob: Blob, name: string }}
 */
export async function ensureMp4Blob(blob, filename, fileExtension) {
    let mp4Blob = blob;
    let mp4Name = filename;

    if (fileExtension === 'mp4') {
        // Already mp4 — deliver directly, no transcode needed.
        if (!mp4Name) mp4Name = 'uffenglish.mp4';
    } else {
        // Webm (or other non-mp4): transcode in-browser via WebCodecs.
        // If WebCodecs can't encode H.264/AAC, fall back to Cloudinary
        // server-side re-encode.
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

    return { blob: mp4Blob, name: mp4Name };
}

/**
 * Saves the recap to the device's downloads via an object URL and a
 * transient anchor. Used on desktop OSes where the native share sheet is
 * unreliable (spec AbortError covers both "user canceled" and "no share
 * targets", so a silent rejection can mean the sheet never appeared).
 * There is no React equivalent for file download; the node is removed
 * synchronously after the click (precedent: the recorder save-to-device
 * fallback link). Firefox only honors downloads from attached nodes.
 */
export function downloadVideoBlob(blob, filename) {
    if (!blob) {
        console.warn('[VideoShare] No blob provided for download');
        return null;
    }
    const name = filename || 'uffenglish.mp4';
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoke on a later tick so the download has claimed the URL first.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    console.log('[VideoShare] download started:', { name, bytes: blob.size });
    return name;
}

/**
 * Delivers the recap via the per-platform target: the native sheet on
 * mobile, a file download on desktop OSes. Returns how it was delivered.
 */
export async function deliverVideo({ blob, filename, fileExtension, target }) {
    if (target === 'download') {
        const { blob: mp4Blob, name } = await ensureMp4Blob(blob, filename, fileExtension);
        return { delivered: 'download', name: downloadVideoBlob(mp4Blob, name) };
    }
    await shareVideo(blob, filename, fileExtension);
    return { delivered: 'shared', name: filename };
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
