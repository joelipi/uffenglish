import Strings from '../data/strings.js';
const CLOUDINARY_CLOUD_NAME = 'dnolem9if';
const CLOUDINARY_UPLOAD_PRESET = 'default';

export async function shareVideo(blob, filename, fileExtension) {
    try {
        if (!blob) {
            console.warn('[VideoShare] No blob provided');
            return;
        }

        if (fileExtension === 'mp4') {
            console.log('[VideoShare] Sharing native MP4 directly.');
            const mp4File = new File([blob], filename, { type: 'video/mp4' });
            if (navigator.canShare && navigator.canShare({ files: [mp4File] })) {
                await navigator.share({
                    title: Strings.get('share_title'),
                    text: Strings.get('share_text'),
                    files: [mp4File]
                });
            } else {
                console.warn('[VideoShare] navigator.share not available.');
            }
        } else {
            console.warn('[VideoShare] Native MP4 not supported. Falling back to Cloudinary for transcoding...');
            if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UPLOAD_PRESET) {
                console.warn('[VideoShare] Cloudinary not configured.');
                return;
            }

            const mp4Name = (filename || 'uffenglish.webm').replace(/\.webm$/i, '.mp4');
            const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/video/upload`;
            const response = await uploadWithXHR(uploadUrl, blob, CLOUDINARY_UPLOAD_PRESET, filename || 'uffenglish.webm');

            if (!response.ok) {
                throw new Error(response.error || 'Upload failed');
            }

            const mp4Url = toMp4DeliveryUrl(response.data.secure_url);
            const deleteToken = response.data.delete_token;

            const fileResp = await fetch(mp4Url);
            if (!fileResp.ok) throw new Error(`Unable to fetch MP4: ${fileResp.status}`);

            console.log('[VideoShare] Successfully transcoded via Cloudinary.');

            const mp4Blob = await fileResp.blob();
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

            if (deleteToken) {
                deleteFromCloudinary(deleteToken);
            }
        }
    } catch (e) {
        console.error('[VideoShare] Error:', e.message);
        throw e;
    }
}

function deleteFromCloudinary(deleteToken) {
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

function uploadWithXHR(url, fileOrBlob, preset, filename) {
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

function toMp4DeliveryUrl(secureUrl) {
    try {
        const url = new URL(secureUrl);
        url.pathname = url.pathname.replace('/upload/', '/upload/f_mp4/');
        url.pathname = url.pathname.replace(/\.(webm|mkv|mov|avi)$/i, '.mp4');
        return url.toString();
    } catch {
        return secureUrl.replace('/upload/', '/upload/f_mp4/').replace(/\.(webm|mkv|mov|avi)$/i, '.mp4');
    }
}
