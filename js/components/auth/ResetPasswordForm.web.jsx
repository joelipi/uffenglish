import React from 'react';
import { useResetPasswordForm } from './ResetPasswordForm.jsx';
import Strings from '../../data/strings.js';

export default function ResetPasswordForm({ onResetSuccess }) {
    const {
        password,
        setPassword,
        passwordConfirm,
        setPasswordConfirm,
        error,
        success,
        loading,
        invalidLink,
        handleSubmit,
    } = useResetPasswordForm({ onResetSuccess });

    const lang = (navigator.language || 'en').split('-')[0].toLowerCase();

    if (invalidLink) {
        return (
            <>
                <h2 className="text-center mb-4" style={{ fontFamily: "'Orbitron', sans-serif", color: 'yellow' }}>
                    {Strings.get('auth_reset_title', lang)}
                </h2>
                <div className="alert alert-danger" role="alert">
                    {Strings.get('auth_invalid_reset_link', lang)}
                </div>
            </>
        );
    }

    return (
        <>
            <h2 className="text-center mb-4" style={{ fontFamily: "'Orbitron', sans-serif", color: 'yellow' }}>
                {Strings.get('auth_reset_title', lang)}
            </h2>
            {error && <div className="alert alert-danger" role="alert">{error}</div>}
            {success && (
                <div className="alert alert-success" role="alert">
                    {Strings.get('profile_password_updated', lang)} <a href="/login" className="alert-link">{Strings.get('auth_log_in_now', lang)}</a>.
                </div>
            )}

            {!success && (
                <form onSubmit={handleSubmit}>
                    <div className="mb-3">
                        <label htmlFor="password" className="form-label">{Strings.get('auth_reset_password_label', lang)}</label>
                        <input
                            type="password"
                            className="form-control"
                            id="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            minLength={8}
                        />
                    </div>
                    <div className="mb-3">
                        <label htmlFor="password-confirm" className="form-label">{Strings.get('auth_confirm_password_label', lang)}</label>
                        <input
                            type="password"
                            className="form-control"
                            id="password-confirm"
                            value={passwordConfirm}
                            onChange={(e) => setPasswordConfirm(e.target.value)}
                            required
                            minLength={8}
                        />
                    </div>
                    <button type="submit" className="btn btn-primary" disabled={loading}>
                        {loading ? Strings.get('auth_updating', lang) : Strings.get('profile_update_password', lang)}
                    </button>
                </form>
            )}
        </>
    );
}
