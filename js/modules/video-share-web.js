import Strings from '../data/strings.js';
const CLOUDINARY_CLOUD_NAME = 'dnolem9if';
const CLOUDINARY_UPLOAD_PRESET = 'default';

export async function shareVideo(blob, filename, fileExtension) {
    try {
        if (!blob) { 
            alert(Strings.get('error_no_processed_video'));
            return; 
        }

        if (fileExtension === 'mp4') {
            const mp4File = new File([blob], filename, { type: 'video/mp4' });
            
            if (navigator.canShare && navigator.canShare({ files: [mp4File] })) {
                await navigator.share({
                    title: Strings.get('share_title'),
                    text: Strings.get('share_text'),
                    files: [mp4File]
                });
            } else {
                const url = URL.createObjectURL(blob);
                await downloadFile(url, filename);
            }
        } else {
            if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UPLOAD_PRESET) {
                alert(Strings.get('error_missing_cloudinary'));
                return;
            }
            
            const mp4Name = (filename || 'uffenglish.webm').replace(/\.webm$/i, '.mp4');
            const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/video/upload`;
            const response = await uploadWithXHR(uploadUrl, blob, CLOUDINARY_UPLOAD_PRESET, filename || 'uffenglish.webm');
            
            if (!response.ok) { 
                throw new Error(response.error || 'Upload failed'); 
            }
            
            const mp4Url = toMp4DeliveryUrl(response.data.secure_url);
            const fileResp = await fetch(mp4Url);
            
            if (!fileResp.ok) throw new Error(`Unable to fetch MP4: ${fileResp.status}`);
            
            const mp4Blob = await fileResp.blob();
            const mp4File = new File([mp4Blob], mp4Name, { type: 'video/mp4' });

            if (navigator.canShare && navigator.canShare({ files: [mp4File] })) {
                await navigator.share({
                    title: Strings.get('share_title'),
                    text: Strings.get('share_text'),
                    files: [mp4File]
                });
            } else {
                await downloadFile(mp4Url, mp4Name);
            }
        }
    } catch (e) {
        alert(Strings.get('error_share_mp4') + ' ' + e.message);
        throw e;
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
            xhr.open('POST', url, true);
            xhr.onload = function() {
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
            xhr.onerror = function() { reject(new Error('Network error')); };
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

async function downloadFile(url, filename) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
    const blob = await resp.blob();
    const dlUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = dlUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(dlUrl), 10000);
}
