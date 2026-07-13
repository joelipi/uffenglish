// functions/api/upload-segment.js
// Cloudflare Pages Function — receives a per-segment mp4 Blob from the SPA
// and writes it to the R2 bucket, gated by Appwrite JWT auth and a
// shareCode-scoped key prefix check.

export async function onRequestPost({ request, env }) {
    try {
        const auth = request.headers.get('Authorization') || '';
        const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : null;
        if (!jwt) return new Response('Unauthorized', { status: 401 });

        // 1) Verify JWT -> $id
        const acctRes = await fetch(`${env.APPWRITE_ENDPOINT}/account`, {
            headers: {
                'Authorization': `Bearer ${jwt}`,
                'X-Appwrite-Project': env.APPWRITE_PROJECT,
            },
        });
        if (!acctRes.ok) return new Response('Unauthorized', { status: 401 });
        const { $id: uid } = await acctRes.json().catch(() => ({}));
        if (!uid) return new Response('Unauthorized', { status: 401 });

        // 2) Map $id -> shareCode via profile row (read("any")).
        //    APPWRITE_ENDPOINT already ends with /v1 (per wrangler.toml), so do
        //    NOT prepend /v1 on the database path.
        const profRes = await fetch(
            `${env.APPWRITE_ENDPOINT}/databases/${env.APPWRITE_DATABASE}/tables/${env.APPWRITE_USER_PROFILES_TABLE}/rows/${uid}`,
            { headers: { 'X-Appwrite-Project': env.APPWRITE_PROJECT } }
        );
        if (!profRes.ok) return new Response('Forbidden', { status: 403 });
        const prof = await profRes.json().catch(() => ({}));
        const shareCode = prof?.shareCode;
        if (!shareCode) return new Response('Forbidden', { status: 403 });

        // 3) Scope the key: must start with `videos/{shareCode}-` and end in .mp4.
        const key = request.headers.get('x-r2-key') || '';
        if (!key.startsWith(`videos/${shareCode}-`) || !key.endsWith('.mp4')) {
            return new Response('Forbidden', { status: 403 });
        }

        // 4) Write to R2.
        const bytes = await request.arrayBuffer();
        await env.UFF_R2.put(key, bytes, { contentType: 'video/mp4' });

        return new Response(
            JSON.stringify({ ok: true, url: `https://r2.ultrafastfluency.com/${key}` }),
            { status: 200, headers: { 'content-type': 'application/json' } }
        );
    } catch (err) {
        console.error('[UploadSegment] Unhandled error:', err);
        return new Response(err.message, { status: 500 });
    }
}
