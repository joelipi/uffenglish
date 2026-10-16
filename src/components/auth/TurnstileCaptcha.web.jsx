// components/auth/TurnstileCaptcha.web.jsx — the Turnstile widget itself.
//
// Renders the Cloudflare Turnstile challenge and hands the resulting token to
// the signup form. The <script> tag lives in index.html (async defer, per the
// Turnstile embed contract); this component waits for `window.turnstile` to
// appear and then renders the widget explicitly with `turnstile.render()`,
// which is the supported React integration (a bare `.cf-turnstile` div would
// race the async script).
//
// getToken() is the important part: Turnstile tokens are SINGLE-USE and expire
// after ~5 minutes, so the token captured at render time may be stale by the
// time a slow typist submits. getToken() returns the cached token when there is
// one and otherwise re-runs the challenge via `turnstile.execute()` and awaits
// the fresh callback.
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
    TURNSTILE_ACTION,
    getTurnstileSiteKey,
    isTurnstileEnabled,
} from '../../modules/auth/turnstile-logic.js';

const SCRIPT_WAIT_TIMEOUT_MS = 15000;
const SCRIPT_POLL_MS = 50;

const LOAD_ERROR = 'Human verification failed to load. Check your connection and try again.';
const VERIFY_ERROR = 'Human verification failed. Please try again.';

const TurnstileCaptcha = forwardRef(function TurnstileCaptcha({ onVerify, onError }, ref) {
    const containerRef = useRef(null);
    const widgetIdRef = useRef(null);
    const tokenRef = useRef(null);
    const waitersRef = useRef([]);
    const [error, setError] = useState('');

    const publishToken = (token) => {
        tokenRef.current = token;
        onVerify?.(token);
        const waiters = waitersRef.current;
        waitersRef.current = [];
        waiters.forEach((waiter) => waiter.resolve(token));
    };

    const failWaiters = (err) => {
        const waiters = waitersRef.current;
        waitersRef.current = [];
        waiters.forEach((waiter) => waiter.reject(err));
    };

    useImperativeHandle(ref, () => ({
        // A valid token, re-running the challenge when the cached one is gone.
        getToken() {
            if (tokenRef.current) return Promise.resolve(tokenRef.current);
            return new Promise((resolve, reject) => {
                waitersRef.current.push({ resolve, reject });
                try {
                    window.turnstile.execute(widgetIdRef.current);
                } catch (e) {
                    const waiter = waitersRef.current.shift();
                    waiter?.reject(e);
                }
            });
        },
        reset() {
            tokenRef.current = null;
            try {
                window.turnstile?.reset(widgetIdRef.current);
            } catch {
                // The widget is already gone (unmounted) — nothing to reset.
            }
        },
    }), []);

    useEffect(() => {
        if (!isTurnstileEnabled()) return undefined;
        let cancelled = false;
        let timer = null;

        const fail = (message) => {
            if (cancelled) return;
            setError(message);
            failWaiters(new Error(message));
            onError?.(message);
        };

        const renderWidget = (turnstile) => {
            if (cancelled || !containerRef.current) return;
            widgetIdRef.current = turnstile.render(containerRef.current, {
                sitekey: getTurnstileSiteKey(),
                action: TURNSTILE_ACTION,
                theme: 'dark',
                callback: publishToken,
                // A token that has expired must not be reused: drop it so the
                // next getToken() re-runs the challenge.
                'expired-callback': () => {
                    tokenRef.current = null;
                },
                'error-callback': () => fail(VERIFY_ERROR),
            });
        };

        const started = Date.now();
        // Polls for the async script. The interval is always cleared on unmount
        // — a leaked timer outlives the jsdom environment and throws
        // "window is not defined" after the test file finishes.
        const tick = () => {
            if (cancelled) return;
            if (window.turnstile?.render) {
                if (timer) clearInterval(timer);
                timer = null;
                renderWidget(window.turnstile);
            } else if (Date.now() - started > SCRIPT_WAIT_TIMEOUT_MS) {
                if (timer) clearInterval(timer);
                timer = null;
                fail(LOAD_ERROR);
            }
        };

        if (window.turnstile?.render) {
            renderWidget(window.turnstile);
        } else {
            timer = setInterval(tick, SCRIPT_POLL_MS);
        }

        return () => {
            cancelled = true;
            if (timer) clearInterval(timer);
            timer = null;
            tokenRef.current = null;
            waitersRef.current = [];
            widgetIdRef.current = null;
        };
    }, [onVerify, onError]);

    if (!isTurnstileEnabled()) return null;

    return (
        <div className="mb-3">
            <div ref={containerRef} data-testid="turnstile-container" />
            {error && <div className="alert alert-warning py-2 mb-0" role="alert">{error}</div>}
        </div>
    );
});

export default TurnstileCaptcha;
