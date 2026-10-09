// functions/api/resend-send.js
// Shared Resend send for the transactional Pages Functions
// (welcome-email.js, auth-email-hook.js). Like functions/api/pipeline/auth.js,
// this is a module with no `onRequest` handler — it is imported, not routed.

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/**
 * Send one transactional email through Resend.
 * Never throws: returns { ok, status } (status 0 on a network failure).
 */
export async function sendViaResend({ apiKey, from, to, subject, html, text, fetchImpl = fetch }) {
    try {
        const res = await fetchImpl(RESEND_ENDPOINT, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify({ from, to, subject, html, text }),
        });
        return { ok: res.ok, status: res.status };
    } catch (e) {
        return { ok: false, status: 0, error: e?.message };
    }
}
