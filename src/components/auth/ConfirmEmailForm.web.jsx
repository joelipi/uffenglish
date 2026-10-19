import React, { useEffect, useRef, useState } from 'react';
import { useConfirmEmailForm } from './ConfirmEmailForm.jsx';
import Strings from '../../data/strings.js';
import {
    REDIRECT_SECONDS,
    initialCountdown,
    nextCountdown,
    shouldRedirect,
} from './confirm-email-redirect-logic.js';

const ALERTS = {
    pending: { className: 'alert-info', key: 'auth_confirm_email_pending' },
    confirmed: { className: 'alert-success', key: 'auth_confirm_email_success' },
    invalid: { className: 'alert-danger', key: 'auth_confirm_email_invalid' },
};

export default function ConfirmEmailForm({ token, onContinue }) {
    const { status } = useConfirmEmailForm({ token });
    const lang = (navigator.language || 'en').split('-')[0].toLowerCase();
    const alert = ALERTS[status] || ALERTS.pending;

    const [countdown, setCountdown] = useState(null);
    const redirectedRef = useRef(false);
    const onContinueRef = useRef(onContinue);
    onContinueRef.current = onContinue;

    const continueOnce = () => {
        if (redirectedRef.current) return;
        redirectedRef.current = true;
        onContinueRef.current?.();
    };

    useEffect(() => {
        if (status !== 'confirmed') {
            setCountdown(null);
            redirectedRef.current = false;
            return;
        }
        setCountdown(initialCountdown());
        const interval = setInterval(() => {
            setCountdown((prev) => {
                const next = nextCountdown(prev);
                if (shouldRedirect(next)) {
                    clearInterval(interval);
                    continueOnce();
                }
                return next;
            });
        }, 1000);
        return () => clearInterval(interval);
    }, [status]);

    const isConfirmed = status === 'confirmed';

    return (
        <>
            <h2 className="text-center mb-4" style={{ fontFamily: "'Orbitron', sans-serif", color: 'yellow' }}>
                {Strings.get(isConfirmed ? 'auth_confirm_email_success' : 'auth_confirm_email_title', lang)}
            </h2>
            {!isConfirmed && (
                <div className={`alert ${alert.className}`} role="alert">
                    {Strings.get(alert.key, lang)}
                </div>
            )}
            {isConfirmed && countdown !== null && (
                <p className="text-center" data-testid="confirm-email-countdown" aria-live="polite">
                    {countdown}
                </p>
            )}
            {status !== 'pending' && (
                <button type="button" className="btn btn-primary w-100" onClick={continueOnce}>
                    {Strings.get('auth_confirm_email_continue', lang)}
                </button>
            )}
        </>
    );
}