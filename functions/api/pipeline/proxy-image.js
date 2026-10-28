// functions/api/pipeline/proxy-image.js
// Pages Function: fetch a replacement background/foreground image for the
// operator studio (stories/100).
//
// Why it exists: the studio composites the layer into a canvas it records, and
// a cross-origin `<img>` without CORS marks that canvas as tainted — at which
// point `canvas.captureStream()` throws and the take cannot be recorded at all.
// Most public image hosts send `Access-Control-Allow-Origin`, so the studio
// loads them directly; this Function is the fallback for the ones that do not.
// It returns the bytes same-origin, so the blob URL the studio creates can never
// taint the canvas.
//
// It is operator-key protected and refuses anything but a public `https:` image
// (isAllowedRemoteImageUrl), because a proxy that fetches whatever URL it is
// given is an SSRF hole: the studio runs against a personal R2 bucket and
// whatever host the operator pastes, and a leaked operator key must not become a
// way to read the Cloudflare metadata endpoint (`169.254.169.254`) or a service
// on the local network.

import { requireOperatorKey } from './auth.js';
import { isAllowedRemoteImageUrl } from '../../../src/modules/looks/background-substitution-logic.js';

/** Hard cap on the proxied body (mirrors the studio's own guard). */
export const MAX_PROXY_IMAGE_BYTES = 15 * 1024 * 1024;

function jsonError(message, status) {
    return new Response(message, { status });
}

export async function onRequestGet({ request, env }) {
    const denied = requireOperatorKey(request, env);
    if (denied) return denied;

    let target = null;
    try {
        target = new URL(request.url).searchParams.get('url');
    } catch (e) {
        return jsonError('Bad Request: unreadable request URL', 400);
    }
    if (!target || !isAllowedRemoteImageUrl(target)) {
        return jsonError('Bad Request: url must be a public https image URL', 400);
    }

    let upstream;
    try {
        upstream = await fetch(target, {
            redirect: 'follow',
            headers: { accept: 'image/*' },
        });
    } catch (e) {
        return jsonError('Bad Gateway: image unreachable', 502);
    }
    if (!upstream || !upstream.ok) {
        return jsonError('Bad Gateway: image fetch failed', 502);
    }

    // `redirect: 'follow'` means the response may come from a DIFFERENT host than
    // the one validated above, so the final URL is re-checked before a byte is
    // read: a public URL that 302s to `169.254.169.254` (or a loopback service)
    // would otherwise turn this proxy into an SSRF read primitive.
    const finalUrl = typeof upstream.url === 'string' && upstream.url ? upstream.url : target;
    if (!isAllowedRemoteImageUrl(finalUrl)) {
        return jsonError('Bad Gateway: refused a redirect to a non-public URL', 502);
    }

    const contentType = String(upstream.headers.get('content-type') || '');
    if (!contentType.toLowerCase().startsWith('image/')) {
        return jsonError('Unsupported Media Type: not an image', 415);
    }

    const declaredLength = Number(upstream.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_PROXY_IMAGE_BYTES) {
        return jsonError('Payload Too Large', 413);
    }

    let bytes;
    try {
        bytes = await upstream.arrayBuffer();
    } catch (e) {
        return jsonError('Bad Gateway: image body unreadable', 502);
    }
    if (!bytes || bytes.byteLength > MAX_PROXY_IMAGE_BYTES) {
        return jsonError('Payload Too Large', 413);
    }

    return new Response(bytes, {
        status: 200,
        headers: {
            'Content-Type': contentType,
            // The operator re-pastes the same layer across takes; a short private
            // cache keeps a full re-encode off the hot path without pinning a
            // stale background after the operator replaces it.
            'Cache-Control': 'private, max-age=300',
            'X-Content-Type-Options': 'nosniff',
        },
    });
}
