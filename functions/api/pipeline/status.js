// functions/api/pipeline/status.js
// Pages Function: returns the Modal orchestrator's stage-level status marker
// from R2 for the recorder to poll (story 040, Task 3). The Functions are
// stateless, so the R2 object is the single source of truth.

import { statusKey } from '../../../src/modules/video/pipeline-keys.js';
import { requireOperatorKey } from './auth.js';

export async function onRequestGet({ request, env }) {
    const denied = requireOperatorKey(request, env);
    if (denied) return denied;

    const id = new URL(request.url).searchParams.get('id');
    const key = statusKey(id);
    if (!key) {
        return new Response('Bad Request: invalid id', { status: 400 });
    }

    const object = await env.UFF_R2.get(key);
    if (!object) {
        return new Response('Not Found', { status: 404 });
    }

    let parsed;
    try {
        parsed = JSON.parse(await object.text());
    } catch {
        return new Response('Bad Gateway: malformed status marker', { status: 502 });
    }

    return new Response(JSON.stringify(parsed), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    });
}
