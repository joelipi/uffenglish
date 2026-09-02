// r2-upload.web.js
// Web-only R2 upload client for per-segment webcam video uploads.
//
// Sends an mp4 Blob to the Cloudflare Pages Function at /api/upload-segment,
// which checks the key prefix against the shareCode namespace and writes to
// the R2 bucket bound as UFF_R2.
//
// The SPA gates the call behind isLoggedIn; the Function is the source of
// truth for key-scoped auth. This client is a thin transport layer.
const UPLOAD_PATH = '/api/upload-segment';

/**
 * Upload a per-segment mp4 Blob to R2 via the Pages Function.
 *
 * @param {object} params
 * @param {Blob} params.blob       The mp4 video bytes (Content-Type video/mp4).
 * @param {string} params.key      R2 object key, e.g. "videos/{shareCode}-{lessonId}-response-01.mp4".
 * @param {string} params.jwt      Appwrite JWT from account.createJWT() (sent
 *                                   for compatibility; the Function ignores it).
 * @param {string} params.shareCode The user's shareCode (sent in a header so
 *                                   the Function can scope the key namespace).
 * @returns {Promise<{url: string}>} The public URL of the uploaded object.
 * @throws On non-2xx response, with a message that includes the status code.
 */
export async function uploadSegmentToR2({ blob, key, jwt, shareCode, contentType }) {
    if (!blob) throw new Error('[R2Upload] blob is required');
    if (!key) throw new Error('[R2Upload] key is required');
    if (!jwt) throw new Error('[R2Upload] jwt is required');
    if (!shareCode) throw new Error('[R2Upload] shareCode is required');

    const ct = contentType || (key.endsWith('.jpg') || key.endsWith('.jpeg') ? 'image/jpeg' : 'video/mp4');
    const resp = await fetch(UPLOAD_PATH, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${jwt}`,
            'x-share-code': shareCode,
            'x-r2-key': key,
            'Content-Type': ct,
        },
        body: blob,
    });

    if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`[R2Upload] upload failed: HTTP ${resp.status} ${text}`);
    }

    const json = await resp.json().catch(() => ({}));
    const url = json.url || `https://r2.ultrafastfluency.com/${key}`;
    console.log(`[R2Upload] uploaded ${key} → ${url}`);
    return { url };
}
