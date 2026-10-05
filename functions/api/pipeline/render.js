// functions/api/pipeline/render.js
// Pages Function: starts a Modal render for a set of CSV filenames (story 040,
// Task 3). The operator key is checked server-side; the Modal proxy token never
// leaves the Worker. `orchestrator.spawn` on the Modal side returns immediately,
// so this Function returns only the new `jobId`; status is carried by the R2
// marker the recorder polls via /api/pipeline/status.

import { isValidPipelineSlug } from '../../../src/modules/video/pipeline-keys.js';
import { requireOperatorKey } from './auth.js';

export async function onRequestPost({ request, env }) {
    const denied = requireOperatorKey(request, env);
    if (denied) return denied;

    let payload;
    try {
        payload = await request.json();
    } catch {
        return new Response('Bad Request: invalid JSON', { status: 400 });
    }
    const files = payload && payload.files;
    if (!Array.isArray(files) || files.length === 0 || !files.every(isValidPipelineSlug)) {
        return new Response('Bad Request: files must be a non-empty array of valid slugs', { status: 400 });
    }

    const renderUrl = env.MODAL_RENDER_URL;
    const tokenId = env.MODAL_PROXY_TOKEN_ID;
    const tokenSecret = env.MODAL_PROXY_TOKEN_SECRET;
    if (!renderUrl || !tokenId || !tokenSecret) {
        return new Response('Server misconfigured: Modal env unset', { status: 500 });
    }

    const jobId = crypto.randomUUID();
    let upstream;
    try {
        upstream = await fetch(renderUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Modal-Key': tokenId,
                'Modal-Secret': tokenSecret,
            },
            body: JSON.stringify({ jobId, files }),
        });
    } catch {
        return new Response('Bad Gateway: Modal unreachable', { status: 502 });
    }
    if (!upstream.ok) {
        return new Response('Bad Gateway: Modal rejected the render', { status: 502 });
    }

    return new Response(JSON.stringify({ jobId }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    });
}
