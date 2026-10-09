// functions/api/standard-webhook.js
// Verify a standardwebhooks (Svix-style) signature with WebCrypto — the scheme
// Supabase's Send Email Hook uses. Implemented here (no dependency) because it
// is the only place in the repo that needs it; the spec is tiny and stable.
//
// Signature = base64(HMAC-SHA256(base64decode(secret), `${id}.${timestamp}.${body}`)),
// sent as one or more space-separated `v1,<base64>` values in `webhook-signature`.

const DEFAULT_TOLERANCE_SEC = 300;

function base64ToBytes(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

function bytesToBase64(bytes) {
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
}

/** Strip the "v1," and "whsec_" prefixes Supabase puts on the hook secret. */
export function parseWebhookSecret(secret) {
    let value = String(secret || '');
    if (value.startsWith('v1,')) value = value.slice(3);
    if (value.startsWith('whsec_')) value = value.slice(6);
    return value;
}

function timingSafeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

/**
 * True when the signature is valid and the timestamp is fresh. Never throws.
 */
export async function verifyStandardWebhook({
    secret,
    id,
    timestamp,
    signature,
    body,
    toleranceSec = DEFAULT_TOLERANCE_SEC,
    now = Math.floor(Date.now() / 1000),
} = {}) {
    if (!secret || !id || !timestamp || !signature || typeof body !== 'string') return false;

    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(now - ts) > toleranceSec) return false;

    let keyBytes;
    try {
        keyBytes = base64ToBytes(parseWebhookSecret(secret));
    } catch {
        return false;
    }
    if (keyBytes.length === 0) return false;

    try {
        const key = await crypto.subtle.importKey(
            'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
        );
        const mac = await crypto.subtle.sign(
            'HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)
        );
        const expected = bytesToBase64(new Uint8Array(mac));

        return String(signature)
            .split(' ')
            .map((part) => part.trim())
            .filter(Boolean)
            .some((part) => {
                const comma = part.indexOf(',');
                if (comma < 0) return false;
                return part.slice(0, comma) === 'v1' && timingSafeEqual(part.slice(comma + 1), expected);
            });
    } catch {
        return false;
    }
}
