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
    resolvePushPromptState,
    describeSubscribeResult,
    isUsableVapidKey,
} from '../../modules/notifications/push-logic.js';
import {
    readPushSupport,
    readExistingSubscription,
    readIsStandalone,
    listenForAppInstalled,
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
    fontFamily: 'var(--font-body)',
};

export default function PushNotificationsOptIn({
    lang = 'en',
    variant = 'prompt',
    userId,
    style,
    onBeforeOpen,
}) {
    const [state, setState] = useState('hidden');
    const [installed, setInstalled] = useState(false);
    const [busy, setBusy] = useState(false);
    const [outcome, setOutcome] = useState(null);

    // An installed app: either we are running as one, or the browser just told us
    // this tab's site was installed (Chromium's `appinstalled`). iOS never fires
    // that event, so the display-mode check is what covers it.
    useEffect(() => {
        if (variant !== 'prompt') return undefined;
        setInstalled(readIsStandalone());
        return listenForAppInstalled(() => {
            console.log('[push] appinstalled — offering notifications');
            setInstalled(true);
        });
    }, [variant]);

    /**
     * Read the live browser state and reduce it to one prompt state. Used on
     * mount and again after every subscribe attempt, so a permission that just
     * flipped to `denied` cannot leave an enabled button behind.
     */
    const refreshOffer = useCallback(async () => {
        const { supported, permission } = readPushSupport();

        // Reconcile this device first (the browser may have rotated the
        // subscription while the app was closed).
        if (userId) await syncExistingSubscription({ supabaseClient: supabase, userId });
        const existing = await readExistingSubscription();

        return resolvePushPromptState({
            supported,
            isLoggedIn: !!userId,
            hasVapidKey: isUsableVapidKey(resolveClientVapidPublicKey()),
            permission,
            isSubscribed: !!existing,
        });
    }, [userId]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const next = await refreshOffer();
            if (!cancelled) setState(next);
        })();
        return () => { cancelled = true; };
    }, [refreshOffer]);

    // A subscription the browser rotated in the background: re-register it.
    useEffect(() => {
        if (!userId) return undefined;
        return listenForPushSubscriptionChange(() => {
            syncExistingSubscription({ supabaseClient: supabase, userId })
                .catch((err) => console.error('[push] re-sync failed:', err));
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
        } else {
            console.warn('[push] notifications not enabled:', result && result.reason);
        }
        // Always re-derive from the live state: a denial just recorded by the OS
        // must switch the offer to `blocked` (hint + disabled button) instead of
        // leaving a button that cannot do anything.
        setState(await refreshOffer());
    }, [refreshOffer, onBeforeOpen]);

    // One definition for both variants: a denial is either the live permission
    // (state) or the result the attempt just returned — the second covers the
    // moment before the browser has reflected the new permission.
    const blocked = state === 'blocked' || outcome === 'denied';

    if (state === 'hidden') return null;

    if (variant === 'menu-item') {
        return (
            <>
                <button
                    type="button"
                    data-testid="push-enable"
                    onClick={handleEnable}
                    disabled={busy || blocked}
                    style={style}
                >
                    <i className="bi bi-bell"></i> {Strings.get('push_optin_enable', lang)}
                </button>
                {blocked && (
                    <p
                        data-testid="push-outcome"
                        style={{ margin: '4px 12px 0', fontSize: '13px', opacity: 0.8 }}
                    >
                        {Strings.get('push_optin_denied_hint', lang)}
                    </p>
                )}
            </>
        );
    }

    // The card owns the initiative: only an installed app shows it, and it
    // returns every launch until notifications are enabled. There is no
    // "Not now" escape hatch — the card is the only thing standing between a
    // signed-in user and their notifications, and a dismissal the user can
    // always re-trigger is just a dismissal.
    if (!installed) return null;

    return (
        <div data-testid="push-prompt" style={{ ...PROMPT_STYLE, ...(style || {}) }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 600 }}>
                <i className="bi bi-bell-fill"></i> {Strings.get('push_optin_title', lang)}
            </div>
            <p style={{ margin: '8px 0 12px', opacity: 0.85, fontSize: '14px' }}>
                {Strings.get('push_optin_body', lang)}
            </p>
            {blocked && (
                <p data-testid="push-outcome" style={{ margin: '0 0 10px', fontSize: '13px', color: '#ffb4b4' }}>
                    {Strings.get('push_optin_denied_hint', lang)}
                </p>
            )}
            <div style={{ display: 'flex', gap: '8px' }}>
                <button
                    type="button"
                    data-testid="push-enable"
                    onClick={handleEnable}
                    disabled={busy || blocked}
                    style={{
                        flex: 1,
                        padding: '10px',
                        borderRadius: '8px',
                        border: 'none',
                        // The app's unified-button tokens: --uff-btn-bg is WHITE
                        // and --uff-btn-fg is near-black (app.css :root). A
                        // hardcoded light-on-light `color: 'white'` made this
                        // button unreadable, so both values come from the tokens.
                        background: 'var(--uff-btn-bg, #ffffff)',
                        color: 'var(--uff-btn-fg, #1a1a1a)',
                        fontWeight: 600,
                        cursor: 'pointer',
                    }}
                >
                    {Strings.get('push_optin_enable', lang)}
                </button>
            </div>
        </div>
    );
}
