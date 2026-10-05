// functions/api/pipeline/auth.js
// Shared operator-key auth for the cloud pipeline Functions (story 040).
// The recorder is a static page with no Supabase session, so it sends a single
// shared operator key in the `x-operator-key` header. Keeping the check here
// means upload-raw/render/status cannot drift on the 401/500 semantics.
//
// The key is compared with a length-independent accumulate-XOR so a response
// time does not leak how many leading characters matched. (This is a stopgap;
// Cloudflare Access / signed tokens are the documented next step.)

export function timingSafeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const encoder = new TextEncoder();
    const left = encoder.encode(a);
    const right = encoder.encode(b);
    let diff = left.length ^ right.length;
    const length = Math.max(left.length, right.length);
    for (let i = 0; i < length; i++) {
        diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
    }
    return diff === 0;
}

/**
 * Verify the `x-operator-key` header against `env.OPERATOR_KEY`.
 * @returns {Response|null} a denial Response, or `null` when authorized.
 */
export function requireOperatorKey(request, env) {
    const expected = env && env.OPERATOR_KEY;
    if (!expected) {
        return new Response('Server misconfigured: OPERATOR_KEY unset', { status: 500 });
    }
    const provided = request.headers.get('x-operator-key');
    if (!provided || !timingSafeEqual(provided, expected)) {
        return new Response('Unauthorized', { status: 401 });
    }
    return null;
}
