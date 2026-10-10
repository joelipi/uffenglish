// SaveClipsSignupForm — compact signup form rendered inside SaveClipsModal.
// Reuses useSignupForm (Supabase signup + profile row + share code + cache
// updates) but only asks for name, email, and password: the native language is
// already known from the guest flow, and the English level is not needed to
// create a share code.
import React from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';
import { useSignupForm } from '../auth/SignupForm.jsx';
import Strings from '../../data/strings.js';
import LegalLinks from '../legal/LegalLinks.jsx';

export default function SaveClipsSignupForm({ onSignupSuccess, onLoginLink }) {
    const userData = useStore(appStore, (state) => state.userData);
    const guestNativeLang = useStore(appStore, (state) => state.guestNativeLanguage);
    // Guest language is authoritative (AGENTS.md): the async profile bootstrap
    // can write the fetched guest profile's "EN" after the guest picked Bengali,
    // so resolving profile-first here left the form labels in English while the
    // modal title/body (guest-first in SaveClipsModal) were Bengali.
    const storedNativeLang = guestNativeLang || userData?.native_language || 'en';
    const lang = (storedNativeLang || 'en').split('-')[0].toLowerCase();

    const {
        firstName,
        setFirstName,
        lastName,
        setLastName,
        email,
        setEmail,
        password,
        setPassword,
        error,
        loading,
        handleSubmit,
    } = useSignupForm({ onSignupSuccess, nativeLanguage: storedNativeLang });

    return (
        <>
            {error && <div className="alert alert-danger" role="alert">{error}</div>}

            <form onSubmit={handleSubmit}>
                <div className="row mb-3">
                    <div className="col-6">
                        <label htmlFor="save-clips-first-name" className="form-label">
                            {Strings.get('profile_first_name', lang)}
                        </label>
                        <input
                            type="text"
                            className="form-control"
                            id="save-clips-first-name"
                            value={firstName}
                            onChange={(e) => setFirstName(e.target.value)}
                            required
                        />
                    </div>
                    <div className="col-6">
                        <label htmlFor="save-clips-last-name" className="form-label">
                            {Strings.get('profile_last_name', lang)}
                        </label>
                        <input
                            type="text"
                            className="form-control"
                            id="save-clips-last-name"
                            value={lastName}
                            onChange={(e) => setLastName(e.target.value)}
                            required
                        />
                    </div>
                </div>
                <div className="mb-3">
                    <label htmlFor="save-clips-email" className="form-label">
                        {Strings.get('auth_email_label', lang)}
                    </label>
                    <input
                        type="email"
                        className="form-control"
                        id="save-clips-email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                    />
                </div>
                <div className="mb-3">
                    <label htmlFor="save-clips-password" className="form-label">
                        {Strings.get('auth_password_min_chars', lang)}
                    </label>
                    <input
                        type="password"
                        className="form-control"
                        id="save-clips-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        minLength={8}
                    />
                </div>

                <button type="submit" className="btn btn-primary w-100" disabled={loading}>
                    {loading
                        ? Strings.get('auth_creating_account', lang)
                        : Strings.get('save_clips_signup_cta', lang)}
                </button>
            </form>

            <div className="text-center mt-3">
                <p className="mb-0">
                    {Strings.get('auth_already_account', lang)}{' '}
                    <a
                        href="#"
                        id="saveClipsLoginLink"
                        onClick={(e) => { e.preventDefault(); onLoginLink?.(); }}
                    >
                        {Strings.get('auth_log_in_link', lang)}
                    </a>
                </p>
            </div>

            <LegalLinks lang={lang} />
        </>
    );
}
