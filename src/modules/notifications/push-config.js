// src/modules/notifications/push-config.js
// VAPID identity for Web Push.
//
// The PUBLIC application-server key is public by design — it ships in the client
// bundle and is sent to the browser push service with every subscribe call — so
// it is committed here as a default, exactly like the Supabase publishable key in
// src/modules/api/supabase-constants.js. The matching PRIVATE key is a Cloudflare
// Pages secret (`VAPID_PRIVATE_KEY`) and is never in the repo.
//
// Generate a pair with `npx web-push generate-vapid-keys`: the printed
// "Public Key" goes here, the "Private Key" goes into the Pages secret. Rotating
// means replacing BOTH together — a mismatched pair makes every send fail, and
// every existing subscription must be re-created by the client.
//
// No import.meta.env here: this module is imported by the Pages Function bundle
// as well as the SPA, so the override is read by each caller (VITE_ at build time
// for the SPA, a Pages var for the Function).

export const DEFAULT_VAPID_PUBLIC_KEY =
    'BPACBWNJq2D9dZPrwyBVwEO0A3D3KfVCCSHaOjx_k1jy1SYedCBxMiebBvwieyjH4VYZx2-fr8sxRDvLPIC7aVM';

// VAPID `sub` claim: a contact URI the push service can use if the sender
// misbehaves. Apple rejects a malformed subject, so it must be a mailto:/https: URI.
export const DEFAULT_VAPID_SUBJECT = 'mailto:welcome@ultrafastfluency.com';

/** An env/build value wins only when it is a non-empty string. */
export function resolveVapidValue(envValue, fallback) {
    return typeof envValue === 'string' && envValue.trim() ? envValue.trim() : fallback;
}

/** True when a key is present and plausibly a base64url uncompressed P-256 point. */
export function isUsableVapidPublicKey(value) {
    // Shape check only (no Buffer/atob): the length/charset of a 65-byte
    // base64url point. Actually decoding happens in the caller's environment
    // (urlBase64ToUint8Array in the browser, base64url in the Function).
    return typeof value === 'string' && /^[A-Za-z0-9_-]{80,120}$/.test(value.trim());
}
