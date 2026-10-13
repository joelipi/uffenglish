// functions/api/push/send.js
// Cloudflare Pages Function — the Web Push sender (story 063).
//
// Called by the `trg_user_notifications_push` trigger over pg_net (a Supabase
// Database Webhook) right after a `user_notifications` row is created or
// refreshed. The recipient's app is normally CLOSED at that moment, which is the
// whole point: this is the only place a push can originate.
//
// Auth: `x-push-webhook-secret` must equal the PUSH_WEBHOOK_SECRET Pages secret,
// compared with a length-independent XOR (functions/api/pipeline/auth.js). The
// caller is Postgres — it has no user session, so a JWT check is not applicable.
//
// Fail-open: every unexpected condition returns 200 with `sent: 0` and a reason,
// so a push problem can never fail the friend's export or retry-loop. The only
// error statuses are 401 (wrong webhook secret) and 500 (PUSH_WEBHOOK_SECRET
// unset — our misconfiguration, deliberately loud).

import { buildPushPayload } from '@block65/webcrypto-web-push';
import { DEFAULT_SUPABASE_URL } from '../../../src/modules/api/supabase-constants.js';
import {
    DEFAULT_VAPID_PUBLIC_KEY,
    DEFAULT_VAPID_SUBJECT,
    resolveVapidValue,
} from '../../../src/modules/notifications/push-config.js';
import {
    buildPushNotification,
    pushCopyInputFromRecord,
} from '../../../src/modules/notifications/push-copy.js';
import { timingSafeEqual } from '../pipeline/auth.js';

// A single device/user never legitimately has more than a handful of
// subscriptions; the cap bounds the work one webhook call can do.
export const MAX_SUBSCRIPTIONS_PER_SEND = 20;
// How long the push service may hold the message for an offline device.
export const PUSH_TTL_SECONDS = 600;
// Push services report a permanently gone subscription with these.
export const GONE_STATUSES = [404, 410];

/**
 * A subscription endpoint is stored by the subscribing client, so it is
 * attacker-controlled input: any authenticated user may register an arbitrary
 * URL on their own row. Only https endpoints are ever fetched, so a row cannot
 * turn this Function into an outbound request to a `file:`/`http:`/internal URL.
 * (Impact today is already self-directed — the lookup is scoped by recipient and
 * the request carries only VAPID headers — but the guard keeps it that way.)
 */
export function isAllowedPushEndpoint(endpoint) {
    if (typeof endpoint !== 'string' || !endpoint) return false;
    try {
        return new URL(endpoint).protocol === 'https:';
    } catch {
        return false;
    }
}

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

function serviceHeaders(serviceKey) {
    return {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'content-type': 'application/json',
    };
}

/** Bearer-less shared-secret check for the database webhook. */
export function requireWebhookSecret(request, env) {
    const expected = env && env.PUSH_WEBHOOK_SECRET;
    if (!expected) {
        // Misconfiguration is ours, not the caller's: 500 so it is visible in
        // logs, and pg_net records the failure without touching the DB write.
        return new Response('Server misconfigured: PUSH_WEBHOOK_SECRET unset', { status: 500 });
    }
    const provided = request.headers.get('x-push-webhook-secret');
    if (!provided || !timingSafeEqual(provided, expected)) {
        return new Response('Unauthorized', { status: 401 });
    }
    return null;
}

/**
 * The push message for a copy. The `topic` (RFC 8030 `Topic` header) is what
 * makes the message **collapsible** on FCM, which is how the platform's
 * "burst of 20, then 1 per 3 minutes" throttle applies instead of the
 * per-device 5,000/hour ceiling — see docs/push-notifications.md. It is omitted
 * when the row has no collapse key, leaving the message non-collapsible.
 */
export function buildMessageFor(copy) {
    const options = { ttl: PUSH_TTL_SECONDS, urgency: 'high' };
    if (copy && copy.tag) options.topic = copy.tag;
    return { data: copy, options };
}

/** The notification row a webhook payload carries, or null. */
export function parseNotificationRecord(payload) {
    if (!payload || typeof payload !== 'object') return null;
    const record = payload.record;
    if (!record || typeof record !== 'object') return null;
    if (typeof record.recipient_id !== 'string' || !record.recipient_id) return null;
    return record;
}

/** All of one recipient's device subscriptions (service role bypasses RLS). */
export async function fetchSubscriptions({ supabaseUrl, serviceKey, userId }) {
    const url = `${supabaseUrl}/rest/v1/push_subscriptions?user_id=eq.${encodeURIComponent(userId)}`
        + `&select=id,endpoint,p256dh,auth&limit=${MAX_SUBSCRIPTIONS_PER_SEND}`;
    try {
        const res = await fetch(url, { headers: serviceHeaders(serviceKey) });
        if (!res.ok) return [];
        const rows = await res.json();
        return Array.isArray(rows) ? rows : [];
    } catch (err) {
        console.error('[push-send] subscription lookup failed:', err && err.message);
        return [];
    }
}

/** The recipient's stored UI language, for localized copy. */
export async function fetchRecipientLanguage({ supabaseUrl, serviceKey, userId }) {
    const url = `${supabaseUrl}/rest/v1/user_profiles?id=eq.${encodeURIComponent(userId)}`
        + '&select=native_language&limit=1';
    try {
        const res = await fetch(url, { headers: serviceHeaders(serviceKey) });
        if (!res.ok) return null;
        const rows = await res.json();
        return Array.isArray(rows) && rows[0] ? rows[0].native_language : null;
    } catch {
        return null;
    }
}

/** Drop a subscription the push service reports as gone. */
export async function deleteSubscription({ supabaseUrl, serviceKey, id }) {
    try {
        await fetch(`${supabaseUrl}/rest/v1/push_subscriptions?id=eq.${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: serviceHeaders(serviceKey),
        });
    } catch (err) {
        console.error('[push-send] prune failed:', err && err.message);
    }
}

/**
 * Send one push. Returns one of 'sent' | 'gone' | 'failed'.
 * Never throws: a single bad endpoint must not stop the other devices.
 */
export async function sendToSubscription({ subscription, message, vapid }) {
    if (!isAllowedPushEndpoint(subscription && subscription.endpoint)) {
        console.error(`[push-send] refusing a non-https endpoint (row ${subscription && subscription.id})`);
        return 'failed';
    }
    try {
        const payload = await buildPushPayload(message, subscription, vapid);
        const res = await fetch(subscription.endpoint, {
            method: payload.method,
            headers: payload.headers,
            body: payload.body,
        });
        if (res.status >= 200 && res.status < 300) return 'sent';
        if (GONE_STATUSES.includes(res.status)) return 'gone';
        console.error(`[push-send] endpoint rejected the message (${res.status})`);
        return 'failed';
    } catch (err) {
        console.error('[push-send] send failed:', err && err.message);
        return 'failed';
    }
}

export async function onRequestPost({ request, env }) {
    const denied = requireWebhookSecret(request, env);
    if (denied) return denied;

    let payload;
    try {
        payload = await request.json();
    } catch {
        return jsonResponse({ sent: 0, reason: 'bad-json' });
    }

    const record = parseNotificationRecord(payload);
    if (!record) return jsonResponse({ sent: 0, reason: 'no-recipient' });

    const supabaseUrl = env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) {
        console.warn('[push-send] SUPABASE_SERVICE_ROLE_KEY unset — skipping send');
        return jsonResponse({ sent: 0, reason: 'store-not-configured' });
    }

    const privateKey = resolveVapidValue(env.VAPID_PRIVATE_KEY, null);
    const publicKey = resolveVapidValue(env.VAPID_PUBLIC_KEY, DEFAULT_VAPID_PUBLIC_KEY);
    if (!privateKey) {
        console.warn('[push-send] VAPID_PRIVATE_KEY unset — skipping send');
        return jsonResponse({ sent: 0, reason: 'push-not-configured' });
    }

    const subscriptions = await fetchSubscriptions({
        supabaseUrl,
        serviceKey,
        userId: record.recipient_id,
    });
    if (subscriptions.length === 0) {
        return jsonResponse({ sent: 0, pruned: 0, failed: 0, reason: 'no-subscriptions' });
    }

    const language = await fetchRecipientLanguage({
        supabaseUrl,
        serviceKey,
        userId: record.recipient_id,
    });
    const copy = buildPushNotification(pushCopyInputFromRecord(record, language));
    if (!copy) {
        return jsonResponse({ sent: 0, pruned: 0, failed: 0, reason: 'unsupported-type' });
    }

    const message = buildMessageFor(copy);
    const vapid = { subject: resolveVapidValue(env.VAPID_SUBJECT, DEFAULT_VAPID_SUBJECT), publicKey, privateKey };

    let sent = 0;
    let pruned = 0;
    let failed = 0;
    for (const row of subscriptions) {
        const subscription = {
            endpoint: row.endpoint,
            expirationTime: null,
            keys: { p256dh: row.p256dh, auth: row.auth },
        };
        const outcome = await sendToSubscription({ subscription, message, vapid });
        if (outcome === 'sent') {
            sent += 1;
        } else if (outcome === 'gone') {
            pruned += 1;
            await deleteSubscription({ supabaseUrl, serviceKey, id: row.id });
        } else {
            failed += 1;
        }
    }

    console.log(`[push-send] sent=${sent} pruned=${pruned} failed=${failed}`);
    return jsonResponse({ sent, pruned, failed });
}
