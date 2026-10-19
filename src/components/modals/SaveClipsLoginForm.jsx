// SaveClipsLoginForm — compact login form rendered inside SaveClipsModal.
// Reuses useLoginForm (Supabase sign-in + cache updates) but stays inline so
// the guest never navigates away from the success screen: generation resumes
// once the modal closes, without a route change that could re-trigger it.
import React from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';
import { useLoginForm } from '../auth/LoginForm.jsx';
import Strings from '../../data/strings.js';

export default function SaveClipsLoginForm({ onLoginSuccess, onSignupLink }) {
    const userData = useStore(appStore, (state) => state.userData);
    const guestNativeLang = useStore(appStore, (state) => state.guestNativeLanguage);
    const storedNativeLang = guestNativeLang || userData?.native_language || 'en';
    const lang = (storedNativeLang || 'en').split('-')[0].toLowerCase();

    const {
        email,
        setEmail,
        password,
        setPassword,
        error,
        loading,
        handleSubmit,
    } = useLoginForm({ onLoginSuccess });

    return (
        <>
            {error && <div className="alert alert-danger" role="alert">{error}</div>}

            <form onSubmit={handleSubmit}>
                <div className="mb-3">
                    <label htmlFor="save-clips-login-email" className="form-label">
                        {Strings.get('auth_email_label', lang)}
                    </label>
                    <input
                        type="email"
                        className="form-control"
                        id="save-clips-login-email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                    />
                </div>
                <div className="mb-3">
                    <label htmlFor="save-clips-login-password" className="form-label">
                        {Strings.get('auth_password_label', lang)}
                    </label>
                    <input
                        type="password"
                        className="form-control"
                        id="save-clips-login-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                    />
                </div>

                <button type="submit" className="btn btn-primary w-100" disabled={loading}>
                    {loading ? Strings.get('auth_logging_in', lang) : Strings.get('auth_log_in', lang)}
                </button>
            </form>

            <div className="text-center mt-3">
                <p className="mb-0">
                    {Strings.get('auth_no_account', lang)}{' '}
                    <a
                        href="#"
                        id="saveClipsSignupLink"
                        className="auth-link"
                        onClick={(e) => { e.preventDefault(); onSignupLink?.(); }}
                    >
                        {Strings.get('auth_sign_up_link', lang)}
                    </a>
                </p>
            </div>
        </>
    );
}
