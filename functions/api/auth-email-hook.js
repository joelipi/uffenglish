// functions/api/auth-email-hook.js
// Supabase Send Email Hook → Resend. When enabled in the Supabase dashboard
// (Auth → Hooks → Send Email), GoTrue POSTs a signed webhook here for EVERY auth
// email (password reset, email change, magic link, ...) instead of sending it
// itself. This routes all transactional mail through Resend and localizes it
// with the shared strings table.
//
// The request is verified with the hook secret (`SEND_EMAIL_HOOK_SECRET`, a
// Pages secret). Unlike the welcome-email endpoint this is NOT fail-open: a
// misconfigured hook must return an error, because a silent 200 would leave the
// user with no reset link at all.

import { DEFAULT_SUPABASE_URL } from '../../src/modules/api/supabase-constants.js';
import { verifyStandardWebhook } from './standard-webhook.js';
import { sendViaResend } from './resend-send.js';
import { buildAuthEmail } from '../../src/modules/user/auth-email-content.js';
import { resolveEmailLanguage } from '../../src/modules/user/email-language.js';

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

/** Profile language fallback for accounts without it in user_metadata. */
export async function fetchProfileLanguage({ supabaseUrl, serviceKey, userId, fetchImpl = fetch }) {
    if (!serviceKey || !userId) return null;
    try {
        const res = await fetchImpl(
            `${supabaseUrl}/rest/v1/user_profiles?select=native_language&id=eq.${encodeURIComponent(userId)}`,
            {
                headers: {
                    apikey: serviceKey,
                    Authorization: `Bearer ${serviceKey}`,
                    Accept: 'application/json',
                },
            }
        );
        if (!res.ok) return null;
        const rows = await res.json();
        return rows?.[0]?.native_language || null;
    } catch {
        return null;
    }
}

export async function onRequestPost({ request, env }) {
    const body = await request.text();

    const valid = await verifyStandardWebhook({
        secret: env.SEND_EMAIL_HOOK_SECRET,
        id: request.headers.get('webhook-id'),
        timestamp: request.headers.get('webhook-timestamp'),
        signature: request.headers.get('webhook-signature'),
        body,
    });
    if (!valid) {
        return jsonResponse({ error: 'invalid signature' }, 401);
    }

    let payload;
    try {
        payload = JSON.parse(body);
    } catch {
        return jsonResponse({ error: 'invalid json' }, 400);
    }
    const { user, email_data: emailData } = payload || {};
    if (!user?.email || !emailData?.email_action_type) {
        return jsonResponse({ error: 'invalid payload' }, 400);
    }

    // Fail loud: without a provider key no email can be sent, and a 200 would
    // strand the user. (Configure RESEND_API_KEY before enabling the hook.)
    if (!env.RESEND_API_KEY) {
        console.error('[auth-email-hook] RESEND_API_KEY unset');
        return jsonResponse({ error: 'email provider not configured' }, 500);
    }

    const supabaseUrl = env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
    let nativeLanguage = user.user_metadata?.native_language;
    if (!nativeLanguage) {
        nativeLanguage = await fetchProfileLanguage({
            supabaseUrl,
            serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
            userId: user.id,
        });
    }
    const language = resolveEmailLanguage({ nativeLanguage });

    const { subject, html, text } = buildAuthEmail({
        action: emailData.email_action_type,
        language,
        tokenHash: emailData.token_hash,
        token: emailData.token,
        redirectTo: emailData.redirect_to,
        supabaseUrl,
    });

    const from = env.EMAIL_FROM || 'Ultrafast Fluency <onboarding@resend.dev>';
    const result = await sendViaResend({
        apiKey: env.RESEND_API_KEY,
        from,
        to: [user.email],
        subject,
        html,
        text,
    });
    if (!result.ok) {
        console.error(`[auth-email-hook] Resend responded ${result.status}`);
        return jsonResponse({ error: `provider-${result.status}` }, 502);
    }

    return jsonResponse({});
}
