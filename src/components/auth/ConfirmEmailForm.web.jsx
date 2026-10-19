import React from 'react';
import { useConfirmEmailForm, useConfirmEmailRedirect } from './ConfirmEmailForm.jsx';
import Strings from '../../data/strings.js';

const ALERTS = {
    pending: { className: 'alert-info', key: 'auth_confirm_email_pending' },
    invalid: { className: 'alert-danger', key: 'auth_confirm_email_invalid' },
};

export default function ConfirmEmailForm({ token, onContinue }) {
    const { status } = useConfirmEmailForm({ token });
    const { countdown, continueOnce } = useConfirmEmailRedirect(status, onContinue);
    const lang = (navigator.language || 'en').split('-')[0].toLowerCase();

    const isConfirmed = status === 'confirmed';
    const alert = ALERTS[status] || ALERTS.pending;

    return (
        <>
            <h2 className="text-center mb-4" style={{ color: 'yellow' }}>
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