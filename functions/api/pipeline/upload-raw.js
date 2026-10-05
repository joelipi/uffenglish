// functions/api/pipeline/upload-raw.js
// Pages Function: receives one raw phone take and writes it to the private R2
// bucket (binding PIPELINE_R2) for the Modal renderer (story 040, Task 2; story
// 041 moved raw/ out of the public `uff` bucket). Mirrors
// functions/api/upload-segment.js (httpMetadata, MAX_R2_UPLOAD_BYTES cap) but
// authenticates with the shared operator key and takes the bare slug from
// `x-filename`. Raw takes live under `raw/` in the private bucket, so
// r2.ultrafastfluency.com cannot serve them. The key is deterministic so a
// re-take is an idempotent overwrite, and the response never returns a public
// URL.

import { MAX_R2_UPLOAD_BYTES } from '../../../src/modules/video/r2-upload-limits.js';
import { rawTakeKey } from '../../../src/modules/video/pipeline-keys.js';
import { requireOperatorKey } from './auth.js';

const MAX_BYTES = MAX_R2_UPLOAD_BYTES;

export async function onRequestPost({ request, env }) {
    const denied = requireOperatorKey(request, env);
    if (denied) return denied;

    const filename = request.headers.get('x-filename');
    const key = rawTakeKey(filename);
    if (!key) {
        return new Response('Bad Request: invalid or missing x-filename', { status: 400 });
    }

    const lenHeader = request.headers.get('content-length');
    if (lenHeader && Number(lenHeader) > MAX_BYTES) {
        return new Response('Payload Too Large', { status: 413 });
    }
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > MAX_BYTES) {
        return new Response('Payload Too Large', { status: 413 });
    }

    const contentType = request.headers.get('Content-Type') || 'video/mp4';
    await env.PIPELINE_R2.put(key, bytes, {
        httpMetadata: {
            contentType,
            cacheControl: 'no-store',
        },
    });

    // Story 041: `raw/<slug>.mp4` lives in the private bucket bound as
    // PIPELINE_R2 (no custom domain / r2.dev), so r2.ultrafastfluency.com cannot
    // serve an unpublished take. The operator key still gates the *write*.
    return new Response(
        JSON.stringify({ ok: true, key }),
        { status: 200, headers: { 'content-type': 'application/json' } }
    );
}
