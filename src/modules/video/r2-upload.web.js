// r2-upload.web.js
// Web-only R2 upload client for per-segment webcam video uploads.
//
// Sends an mp4 Blob to the Cloudflare Pages Function at /api/upload-segment,
// which verifies the Appwrite JWT, looks up the user's shareCode, checks the
// key prefix, and writes to the R2 bucket bound as UFF_R2.
//
// The Function is the source of truth for auth scoping; this client is a thin
// transport layer.
const UPLOAD_PATH = '/api/upload-segment';

/**
 * Upload a per-segment mp4 Blob to R2 via the Pages Function.
 *
 * @param {object} params
 * @param {Blob} params.blob       The mp4 video bytes (Content-Type video/mp4).
 * @param {string} params.key      R2 object key, e.g. "videos/{shareCode}-{lessonId}-response-01.mp4".
 * @param {string} params.jwt      Appwrite JWT from account.createJWT().
 * @param {string} params.shareCode The user's shareCode (sent in a header for
 *                                   cheap server-side sanity checking; the
 *                                   Function re-verifies by looking up the
 *                                   profile row from the JWT's $id).
 * @returns {Promise<{url: string}>} The public URL of the uploaded object.
 * @throws On non-2xx response, with a message that includes the status code.
 */
export async function uploadSegmentToR2({ blob, key, jwt, shareCode }) {
    if (!blob) throw new Error('[R2Upload] blob is required');
    if (!key) throw new Error('[R2Upload] key is required');
    if (!jwt) throw new Error('[R2Upload] jwt is required');
    if (!shareCode) throw new Error('[R2Upload] shareCode is required');

    const resp = await fetch(UPLOAD_PATH, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${jwt}`,
            'x-share-code': shareCode,
            'x-r2-key': key,
            'Content-Type': 'video/mp4',
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
