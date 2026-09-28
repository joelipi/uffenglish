// functions/api/upload-segment.js
// Cloudflare Pages Function — receives a per-segment mp4 Blob from the SPA
// and writes it to the R2 bucket. Pilot hardening: requires a valid
// Supabase JWT (Authorization: Bearer <access_token>) and verifies the
// caller owns the shareCode namespace before writing.
// R2 lifecycle (48h TTL for videos/ prefix) is configured in the dashboard
// — not via wrangler.toml.

// Publishable Supabase project defaults — shared with the SPA client via
// src/modules/api/supabase-constants.js. The anon key is public by design (it
// ships in the client bundle), so these fallbacks let the Function verify JWTs
// even when SUPABASE_URL/SUPABASE_ANON_KEY are not set in the Pages environment
// (dashboard vars are optional, not required).
import { DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_ANON_KEY } from '../../src/modules/api/supabase-constants.js';
import { MAX_R2_UPLOAD_BYTES } from '../../src/modules/video/r2-upload-limits.js';
export { DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_ANON_KEY };

const MAX_BYTES = MAX_R2_UPLOAD_BYTES; // 50 MB per object

export async function onRequestPost({ request, env }) {
    const shareCode = request.headers.get('x-share-code');
    const key = request.headers.get('x-r2-key');
    if (!shareCode || !key) {
        return new Response('Bad Request: missing x-share-code or x-r2-key', { status: 400 });
    }
    const isVideo = key.endsWith('.mp4');
    const isThumb = key.endsWith('.jpg') || key.endsWith('.jpeg');
    if (!key.startsWith(`videos/${shareCode}-`) || !(isVideo || isThumb)) {
        return new Response('Forbidden: key does not match shareCode namespace', { status: 403 });
    }

    // ---- Auth: require valid Supabase JWT ----
    const auth = request.headers.get('Authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token) {
        return new Response('Unauthorized: missing Authorization Bearer JWT', { status: 401 });
    }
    const supabaseUrl = env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
    const supabaseAnonKey = env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;
    try {
        const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
            headers: {
                apikey: supabaseAnonKey,
                Authorization: `Bearer ${token}`,
            },
        });
        if (!userRes.ok) {
            return new Response('Unauthorized: invalid token', { status: 401 });
        }
        const user = await userRes.json();
        if (!user?.id) return new Response('Unauthorized: invalid token payload', { status: 401 });

        // Verify the caller owns this shareCode (prevents token reuse across users).
        // PostgREST query against user_profiles (RLS allows owner read).
        const profileRes = await fetch(
            `${supabaseUrl}/rest/v1/user_profiles?select=share_code&id=eq.${user.id}`,
            {
                headers: {
                    apikey: supabaseAnonKey,
                    Authorization: `Bearer ${token}`,
                    Accept: 'application/json',
                },
            }
        );
        if (profileRes.ok) {
            const rows = await profileRes.json();
            const ownedShareCode = rows?.[0]?.share_code;
            // If profile has a share_code and caller is trying to write under a
            // different code, reject. If no share_code yet (new user), allow —
            // the client will have just created it.
            if (ownedShareCode && ownedShareCode.toLowerCase() !== shareCode.toLowerCase()) {
                return new Response('Forbidden: shareCode does not belong to authenticated user', { status: 403 });
            }
        }
    } catch (e) {
        return new Response('Unauthorized: token verification failed', { status: 401 });
    }

    // ---- Size cap ----
    const lenHeader = request.headers.get('content-length');
    if (lenHeader && Number(lenHeader) > MAX_BYTES) {
        return new Response('Payload Too Large', { status: 413 });
    }
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > MAX_BYTES) {
        return new Response('Payload Too Large', { status: 413 });
    }
    const reqCt = request.headers.get('Content-Type');
    const contentType = reqCt || (isThumb ? 'image/jpeg' : 'video/mp4');
    // Cache-Control lets the browser keep a durable local copy of the clip.
    // Without it (and with the R2 edge cache DYNAMIC) the end-of-lesson recap
    // re-downloads each friend clip when it stitches the video. 1h spans the
    // lesson → recap window while staying inside the 48h UGC lifecycle. Note:
    // keys are deterministic per segment, so a re-publish within the hour may
    // serve the previous take from cache until it expires.
    await env.UFF_R2.put(key, bytes, {
        httpMetadata: {
            contentType,
            cacheControl: 'public, max-age=3600',
        },
    });

    return new Response(
        JSON.stringify({ ok: true, url: `https://r2.ultrafastfluency.com/${key}` }),
        { status: 200, headers: { 'content-type': 'application/json' } }
    );
}
