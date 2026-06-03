import React from 'react';
import { useLoginForm } from './LoginForm.jsx';
import Strings from '../../data/strings.js';

export default function LoginForm({ onLoginSuccess, onSignupLink, onForgotPassword }) {
    const {
        email,
        setEmail,
        password,
        setPassword,
        error,
        loading,
        handleSubmit,
    } = useLoginForm({ onLoginSuccess });

    const lang = (navigator.language || 'en').split('-')[0].toLowerCase();

    return (
        <>
            <h2 className="text-center mb-4" style={{ fontFamily: "'Orbitron', sans-serif", color: 'yellow' }}>
                {Strings.get('auth_login_title', lang)}
            </h2>
            {error && <div className="alert alert-danger" role="alert">{error}</div>}

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
                <div className="mb-3">
                    <label htmlFor="password" className="form-label">{Strings.get('auth_password_label', lang)}</label>
                    <input
                        type="password"
                        className="form-control"
                        id="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                    />
                </div>
                <button type="submit" className="btn btn-primary" disabled={loading}>
                    {loading ? Strings.get('auth_logging_in', lang) : Strings.get('auth_log_in', lang)}
                </button>
            </form>

            <div className="text-center mt-3">
                <p>{Strings.get('auth_no_account', lang)} <a href="#" onClick={(e) => { e.preventDefault(); onSignupLink?.(); }}>{Strings.get('auth_sign_up_link', lang)}</a></p>
                <p><a href="#" onClick={(e) => { e.preventDefault(); onForgotPassword?.(); }}>{Strings.get('auth_forgot_password', lang)}</a></p>
            </div>
        </>
    );
}
