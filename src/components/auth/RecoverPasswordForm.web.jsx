import React from 'react';
import { useRecoverPasswordForm } from './RecoverPasswordForm.jsx';
import Strings from '../../data/strings.js';

export default function RecoverPasswordForm({ onBackToLogin }) {
    const {
        email,
        setEmail,
        error,
        success,
        loading,
        handleSubmit,
    } = useRecoverPasswordForm({ onBackToLogin });

    const lang = (navigator.language || 'en').split('-')[0].toLowerCase();

    return (
        <>
            <h2 className="text-center mb-4" style={{ fontFamily: "'Orbitron', sans-serif", color: 'yellow' }}>
                {Strings.get('auth_recover_title', lang)}
            </h2>
            {error && <div className="alert alert-danger" role="alert">{error}</div>}
            {success && <div className="alert alert-success" role="alert">{Strings.get('auth_recovery_sent', lang)}</div>}

            <p className="text-center text-light mb-4">{Strings.get('auth_recover_instruction', lang)}</p>

            <form onSubmit={handleSubmit}>
                <div className="mb-3">
                    <label htmlFor="email" className="form-label">{Strings.get('auth_email_label', lang)}</label>
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
                    {loading ? Strings.get('auth_sending', lang) : Strings.get('auth_send_recovery', lang)}
                </button>
            </form>

            <div className="text-center mt-3">
                <p><a href="#" onClick={(e) => { e.preventDefault(); onBackToLogin?.(); }}>{Strings.get('auth_back_to_login', lang)}</a></p>
            </div>
        </>
    );
}
