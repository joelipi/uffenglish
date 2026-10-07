import React from 'react';
import { useConfirmEmailForm } from './ConfirmEmailForm.jsx';
import Strings from '../../data/strings.js';

const ALERTS = {
    pending: { className: 'alert-info', key: 'auth_confirm_email_pending' },
    confirmed: { className: 'alert-success', key: 'auth_confirm_email_success' },
    invalid: { className: 'alert-danger', key: 'auth_confirm_email_invalid' },
};

export default function ConfirmEmailForm({ token, onContinue }) {
    const { status } = useConfirmEmailForm({ token });
    const lang = (navigator.language || 'en').split('-')[0].toLowerCase();
    const alert = ALERTS[status] || ALERTS.pending;

    return (
        <>
            <h2 className="text-center mb-4" style={{ fontFamily: "'Orbitron', sans-serif", color: 'yellow' }}>
                {Strings.get('auth_confirm_email_title', lang)}
            </h2>
            <div className={`alert ${alert.className}`} role="alert">
                {Strings.get(alert.key, lang)}
            </div>
            {status !== 'pending' && (
                <button type="button" className="btn btn-primary w-100" onClick={() => onContinue?.()}>
                    {Strings.get('auth_confirm_email_continue', lang)}
                </button>
            )}
        </>
    );
}
