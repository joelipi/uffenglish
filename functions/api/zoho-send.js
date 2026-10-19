// functions/api/zoho-send.js
// Shared Zoho CPaaS (formerly ZeptoMail) send for the transactional Pages
// Functions (welcome-email.js, auth-email-hook.js). Like functions/api/pipeline/auth.js,
// this is a module with no `onRequest` handler — it is imported, not routed.
//
// Provider: Zoho CPaaS email API (https://cpaas.zoho.com/v1.1/email). Auth uses
// the `Zoho-enczapikey` scheme rather than Bearer.

export const ZOHO_ENDPOINT = 'https://cpaas.zoho.com/v1.1/email';

/**
 * Resolve the API key from the Pages env, supporting a few common names so a
 * dashboard configured for either the new (Zoho CPaaS) or legacy (ZeptoMail)
 * naming keeps working.
 */
export function resolveApiKey(env) {
    if (!env) return undefined;
    return (
        env.ZOHO_CPAAS_API_KEY ||
        env.ZOHO_CPaaS_API_KEY ||
        env.ZOHO_API_KEY ||
        env.ZOHO_TOKEN ||
        env.ZOHO_CPaaS_TOKEN ||
        env.ZEPTOMAIL_API_KEY ||
        env.ZEPTOMAIL_TOKEN ||
        env.ZOHO_EMAIL_API_KEY ||
        env.CPAAS_API_KEY
    );
}

/** Parse a "Name <addr>", bare address, or { address, name } / { email, name } into Zoho's { address, name? }. */
export function parseFrom(value) {
    if (value == null) return { address: '' };
    if (typeof value === 'object' && !Array.isArray(value)) {
        const address = value.address || value.email;
        const name = value.name;
        return name ? { address: address || '', name } : { address: address || '' };
    }
    const str = String(value).trim();
    const m = str.match(/^(.*?)\s*<([^>]+)>\s*$/);
    if (m) {
        const name = m[1].trim();
        const address = m[2].trim();
        return name ? { address, name } : { address };
    }
    return { address: str };
}

/** Normalize a recipient list (strings or objects) into Zoho's to[] shape. */
export function toZohoRecipients(list) {
    const arr = Array.isArray(list) ? list : [list];
    return arr.map((item) => {
        if (item == null) return { email_address: { address: '' } };
        if (typeof item === 'string') {
            const m = item.match(/^(.*?)\s*<([^>]+)>\s*$/);
            if (m) {
                const name = m[1].trim();
                const address = m[2].trim();
                return name
                    ? { email_address: { address, name } }
                    : { email_address: { address } };
            }
            return { email_address: { address: item } };
        }
        if (item && item.email_address) return item;
        if (item && (item.address || item.email)) {
            const addr = item.address || item.email;
            return item.name
                ? { email_address: { address: addr, name: item.name } }
                : { email_address: { address: addr } };
        }
        return { email_address: { address: String(item) } };
    });
}

/**
 * Send one transactional email through Zoho CPaaS.
 * Never throws: returns { ok, status } (status 0 on a network failure).
 */
export async function sendViaZoho({ apiKey, from, to, subject, html, text, fetchImpl }) {
    const doFetch = fetchImpl || fetch;
    try {
        const body = {
            from: parseFrom(from),
            to: toZohoRecipients(to),
            subject,
        };
        if (html != null && html !== '') body.htmlbody = html;
        if (text != null && text !== '') body.textbody = text;
        const res = await doFetch(ZOHO_ENDPOINT, {
            method: 'POST',
            headers: {
                Authorization: `Zoho-enczapikey ${apiKey}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify(body),
        });
        return { ok: res.ok, status: res.status };
    } catch (e) {
        return { ok: false, status: 0, error: e?.message };
    }
}
