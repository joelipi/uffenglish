// components/notifications/PushNotificationsOptIn.web.jsx
// The Web Push opt-in. Two variants of the same wiring:
//
//   variant="prompt"     — the follow-up to the install flow. Shown once, right
//                          after the app first launches as an installed PWA.
//   variant="menu-item"  — a permanent entry in the /home menu, so a dismissed
//                          prompt is recoverable and desktop users (who never
//                          install) can still opt in.
//
// The browser reads live in the web-only modules and every decision lives in
// push-logic.js, so this component only derives inputs, renders, and reports the
// outcome. The permission request happens inside the click handler because iOS
// requires a user gesture (webkit.org/blog/13878).
import React, { useCallback, useEffect, useState } from 'react';
import Strings from '../../data/strings.js';
import { supabase } from '../../modules/api/supabase.js';
import {
    shouldOfferPushNotifications,
    describeSubscribeResult,
    isUsableVapidKey,
} from '../../modules/notifications/push-logic.js';
import {
    readPushSupport,
    readExistingSubscription,
    readPromptDismissed,
    markPromptDismissed,
    consumeJustInstalled,
    subscribeToPush,
    syncExistingSubscription,
    listenForPushSubscriptionChange,
    resolveClientVapidPublicKey,
} from '../../modules/notifications/push-subscription-webonly.js';

const PROMPT_STYLE = {
    margin: '12px 16px',
    padding: '14px',
    borderRadius: '10px',
    border: '1px solid #1a3a5a',
    background: '#12304d',
    color: 'white',
    fontFamily: "'Inter', 'Plus Jakarta Sans', sans-serif",
};

export default function PushNotificationsOptIn({
    lang = 'en',
    variant = 'prompt',
    userId,
    style,
    onBeforeOpen,
}) {
    const [offer, setOffer] = useState(false);
    const [busy, setBusy] = useState(false);
    const [outcome, setOutcome] = useState(null);

    useEffect(() => {
        let cancelled = false;

        (async () => {
            // The post-install prompt is a one-shot: consume the install
            // transition even when the opt-in turns out not to be offered, so it
            // cannot fire again later.
            const justInstalled = variant === 'prompt' ? consumeJustInstalled() : false;
            const { supported, permission } = readPushSupport();

            // Reconcile this device first (the browser may have rotated the
            // subscription while the app was closed).
            if (userId) await syncExistingSubscription({ supabaseClient: supabase, userId });
            const existing = await readExistingSubscription();

            const next = shouldOfferPushNotifications({
                supported,
                isLoggedIn: !!userId,
                hasVapidKey: isUsableVapidKey(resolveClientVapidPublicKey()),
                permission,
                isSubscribed: !!existing,
                // The dismissal belongs to the post-install PROMPT only. The
                // menu entry must stay available — it is the documented way for
                // a prompted user to opt in later (and for desktop users who
                // never install), so passing the flag for both variants would
                // make "Not now" permanent.
                dismissed: variant === 'prompt' ? readPromptDismissed() : false,
            });

            if (cancelled) return;
            // The prompt only takes the initiative right after an install; the
            // menu entry is always available.
            setOffer(variant === 'prompt' ? next && justInstalled : next);
        })();

        return () => { cancelled = true; };
    }, [userId, variant]);

    // A subscription the browser rotated in the background: re-register it.
    useEffect(() => {
        if (!userId) return undefined;
        return listenForPushSubscriptionChange(() => {
            syncExistingSubscription({ supabaseClient: supabase, userId });
        });
    }, [userId]);

    const handleEnable = useCallback(async () => {
        setBusy(true);
        if (typeof onBeforeOpen === 'function') onBeforeOpen();
        const result = await subscribeToPush({ supabaseClient: supabase, userId });
        setBusy(false);
        setOutcome(describeSubscribeResult(result));
        if (result && result.ok) {
            console.log('[push] notifications enabled for this device');
            setOffer(false);
        } else {
            console.warn('[push] notifications not enabled:', result && result.reason);
        }
    }, [userId, onBeforeOpen]);

    const handleDismiss = useCallback(() => {
        markPromptDismissed();
        setOffer(false);
    }, []);

    if (!offer) return null;

    if (variant === 'menu-item') {
        return (
            <button type="button" data-testid="push-enable" onClick={handleEnable} disabled={busy} style={style}>
                <i className="bi bi-bell"></i> {Strings.get('push_optin_enable', lang)}
            </button>
        );
    }

    return (
        <div data-testid="push-prompt" style={{ ...PROMPT_STYLE, ...(style || {}) }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 600 }}>
                <i className="bi bi-bell-fill"></i> {Strings.get('push_optin_title', lang)}
            </div>
            <p style={{ margin: '8px 0 12px', opacity: 0.85, fontSize: '14px' }}>
                {Strings.get('push_optin_body', lang)}
            </p>
            {outcome === 'denied' && (
                <p data-testid="push-outcome" style={{ margin: '0 0 10px', fontSize: '13px', color: '#ffb4b4' }}>
                    {Strings.get('push_optin_denied_hint', lang)}
                </p>
            )}
            <div style={{ display: 'flex', gap: '8px' }}>
                <button
                    type="button"
                    data-testid="push-enable"
                    onClick={handleEnable}
                    disabled={busy}
                    style={{
                        flex: 1,
                        padding: '10px',
                        borderRadius: '8px',
                        border: 'none',
                        background: 'var(--uff-btn-bg, linear-gradient(135deg, #3a8fd5 0%, #00c0d8 100%))',
                        color: 'white',
                        fontWeight: 600,
                        cursor: 'pointer',
                    }}
                >
                    {Strings.get('push_optin_enable', lang)}
                </button>
                <button
                    type="button"
                    data-testid="push-dismiss"
                    onClick={handleDismiss}
                    style={{
                        padding: '10px 14px',
                        borderRadius: '8px',
                        border: '1px solid #2a4a6a',
                        background: 'transparent',
                        color: 'white',
                        cursor: 'pointer',
                    }}
                >
                    {Strings.get('push_optin_dismiss', lang)}
                </button>
            </div>
        </div>
    );
}
