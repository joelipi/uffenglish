import React, { useEffect, useRef, useState } from 'react';
import { useConfirmEmailForm } from './ConfirmEmailForm.jsx';
import Strings from '../../data/strings.js';

const ALERTS = {
    pending: { className: 'alert-info', key: 'auth_confirm_email_pending' },
    confirmed: { className: 'alert-success', key: 'auth_confirm_email_success' },
    invalid: { className: 'alert-danger', key: 'auth_confirm_email_invalid' },
};

const REDIRECT_SECONDS = 3;

export default function ConfirmEmailForm({ token, onContinue }) {
    const { status } = useConfirmEmailForm({ token });
    const lang = (navigator.language || 'en').split('-')[0].toLowerCase();
    const alert = ALERTS[status] || ALERTS.pending;

    const [countdown, setCountdown] = useState(null);
    const redirectedRef = useRef(false);

    useEffect(() => {
        if (status !== 'confirmed') {
            setCountdown(null);
            return;
        }
        setCountdown(REDIRECT_SECONDS);
        const interval = setInterval(() => {
            setCountdown((prev) => {
                if (prev === null) return null;
                if (prev <= 1) {
                    clearInterval(interval);
                    if (!redirectedRef.current) {
                        redirectedRef.current = true;
                        onContinue?.();
                    }
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(interval);
    }, [status, onContinue]);

    const headingKey = status === 'confirmed' ? 'auth_confirm_email_success' : 'auth_confirm_email_title';

    return (
        <>
            <h2 className="text-center mb-4" style={{ fontFamily: "'Orbitron', sans-serif", color: 'yellow' }}>
                {Strings.get(headingKey, lang)}
            </h2>
            <div className={`alert ${alert.className}`} role="alert">
                {Strings.get(alert.key, lang)}
            </div>
            {status === 'confirmed' && countdown !== null && (
                <p className="text-center" data-testid="confirm-email-countdown">
                    {countdown}
                </p>
            )}
            {status !== 'pending' && (
                <button type="button" className="btn btn-primary w-100" onClick={() => {
                    if (!redirectedRef.current) {
                        redirectedRef.current = true;
                        onContinue?.();
                    }
                }}>
                    {Strings.get('auth_confirm_email_continue', lang)}
                </button>
            )}
        </>
    );
}