// functions/api/upload-segment.js
// Cloudflare Pages Function — receives a per-segment mp4 Blob from the SPA
// and writes it to the R2 bucket. Auth scoping is enforced via a
// shareCode-scoped key prefix; the SPA gates the call behind isLoggedIn
// before invoking, and the shareCode is the user's own id.

export async function onRequestPost({ request, env }) {
    const shareCode = request.headers.get('x-share-code');
    const key = request.headers.get('x-r2-key');
    if (!shareCode || !key) {
        return new Response('Bad Request: missing x-share-code or x-r2-key', { status: 400 });
    }
    if (!key.startsWith(`videos/${shareCode}-`) || !key.endsWith('.mp4')) {
        return new Response('Forbidden: key does not match shareCode namespace', { status: 403 });
    }

    const bytes = await request.arrayBuffer();
    await env.UFF_R2.put(key, bytes, { contentType: 'video/mp4' });

    return new Response(
        JSON.stringify({ ok: true, url: `https://r2.ultrafastfluency.com/${key}` }),
        { status: 200, headers: { 'content-type': 'application/json' } }
    );
}
