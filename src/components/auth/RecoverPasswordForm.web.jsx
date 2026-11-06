import React from 'react';
import { useRecoverPasswordForm } from './RecoverPasswordForm.jsx';
import Strings from '../../data/strings.js';

// `lang` is optional: the /recover-password route renders this with no prop and
// keeps the browser language, while the inline save-clips modal passes the
// guest-first language it already resolved for the rest of the dialog.
export default function RecoverPasswordForm({ onBackToLogin, lang }) {
    const {
        email,
        setEmail,
        error,
        success,
        loading,
        handleSubmit,
    } = useRecoverPasswordForm({ onBackToLogin });

    const uiLang = lang || (navigator.language || 'en').split('-')[0].toLowerCase();

    return (
        <>
            <h2 className="text-center mb-4" style={{ color: 'yellow' }}>
                {Strings.get('auth_recover_title', uiLang)}
            </h2>
            {error && <div className="alert alert-danger" role="alert">{error}</div>}
            {success && <div className="alert alert-success" role="alert">{Strings.get('auth_recovery_sent', uiLang)}</div>}

            <p className="text-center text-light mb-4">{Strings.get('auth_recover_instruction', uiLang)}</p>

            <form onSubmit={handleSubmit}>
                <div className="mb-3">
                    <label htmlFor="email" className="form-label">{Strings.get('auth_email_label', uiLang)}</label>
                    <input
                        type="email"
                        className="form-control"
                        id="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                    />
                </div>
                <button type="submit" className="btn btn-primary w-100" disabled={loading}>
                    {loading ? Strings.get('auth_sending', uiLang) : Strings.get('auth_send_recovery', uiLang)}
                </button>
            </form>

            <div className="text-center mt-3">
                <p><a id="recoverBackToLoginLink" className="auth-link" href="#" onClick={(e) => { e.preventDefault(); onBackToLogin?.(); }}>{Strings.get('auth_back_to_login', uiLang)}</a></p>
            </div>
        </>
    );
}
