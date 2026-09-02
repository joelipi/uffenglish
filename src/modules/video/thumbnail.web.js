// thumbnail.web.js — Web-only thumbnail generator for raw webcam blobs.
// Mirrors thumbnail.native.js (FFmpegKit) via same export shape.

/**
 * Generate a JPEG thumbnail + LQIP data-uri from a video Blob.
 * Captures frame at `atSeconds` (default 0.2s) to avoid black first frame.
 * Falls back to 0s if seek fails. Never throws — returns null on failure.
 *
 * @param {Blob} blob - source video blob (webm or mp4)
 * @param {object} opts
 * @param {number} opts.atSeconds - seek target (0.2)
 * @param {number} opts.width - thumbnail width (320)
 * @param {number} opts.quality - jpeg quality 0-1 (0.7)
 * @param {number} opts.lqipWidth - lqip width (32)
 * @returns {Promise<{jpgBlob: Blob, lqip: string} | null>}
 */
export async function generateThumbFromBlob(blob, { atSeconds = 0.2, width = 320, quality = 0.7, lqipWidth = 32 } = {}) {
    if (!blob || !(blob instanceof Blob) || blob.size === 0) return null;

    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.crossOrigin = 'anonymous';
    video.src = url;

    try {
        await new Promise((resolve, reject) => {
            const onLoaded = () => { video.removeEventListener('loadedmetadata', onLoaded); video.removeEventListener('error', onError); resolve(); };
            const onError = () => { video.removeEventListener('loadedmetadata', onLoaded); video.removeEventListener('error', onError); reject(new Error('video load error')); };
            video.addEventListener('loadedmetadata', onLoaded);
            video.addEventListener('error', onError);
            // Fallback if loadedmetadata never fires
            setTimeout(() => reject(new Error('metadata timeout')), 4000);
        });

        const duration = isFinite(video.duration) ? video.duration : 10;
        const target = Math.min(atSeconds, Math.max(0, duration - 0.05));

        if (target > 0.05) {
            await new Promise((resolve) => {
                let done = false;
                const onSeeked = () => { if (done) return; done = true; video.removeEventListener('seeked', onSeeked); resolve(); };
                video.addEventListener('seeked', onSeeked);
                video.currentTime = target;
                setTimeout(() => { if (done) return; done = true; video.removeEventListener('seeked', onSeeked); resolve(); }, 1200);
            });
        }

        if (!video.videoWidth || !video.videoHeight) return null;

        const jpgBlob = await canvasToBlob(video, width, quality);
        if (!jpgBlob) return null;

        const lqip = await canvasToDataUri(video, lqipWidth);

        return { jpgBlob, lqip };
    } catch (e) {
        console.warn('[Thumbnail] generateThumbFromBlob failed:', e?.message || e);
        return null;
    } finally {
        URL.revokeObjectURL(url);
        video.src = '';
        video.load();
    }
}

function canvasToBlob(video, targetWidth, quality) {
    return new Promise((resolve) => {
        const canvas = document.createElement('canvas');
        const scale = targetWidth / video.videoWidth;
        canvas.width = targetWidth;
        canvas.height = Math.round(video.videoHeight * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
    });
}

function canvasToDataUri(video, targetWidth) {
    return new Promise((resolve) => {
        const canvas = document.createElement('canvas');
        const scale = targetWidth / video.videoWidth;
        canvas.width = targetWidth;
        canvas.height = Math.round(video.videoHeight * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(null); return; }
        // Slight blur via low width already gives LQIP effect
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        try {
            resolve(canvas.toDataURL('image/jpeg', 0.5));
        } catch (e) {
            resolve(null);
        }
    });
}
