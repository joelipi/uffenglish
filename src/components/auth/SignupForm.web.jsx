import React from 'react';
import { useSignupForm } from './SignupForm.jsx';
import Strings from '../../data/strings.js';

const NATIVE_LANGUAGES = [
    { value: '', label: 'Select...', disabled: true },
    { value: 'EN', label: 'English' },
    { value: 'ES', label: 'Español (Spanish)' },
    { value: 'PT', label: 'Português (Portuguese)' },
    { value: 'FR', label: 'Français (French)' },
    { value: 'DE', label: 'Deutsch (German)' },
    { value: 'KO', label: '한국어 (Korean)' },
];

const ENGLISH_LEVELS = [
    { value: '', label: 'Select...', disabled: true },
    { value: 'A0', label: 'A0 (Absolute Beginner)' },
    { value: 'A1', label: 'A1 (Beginner)' },
    { value: 'A2', label: 'A2 (Elementary)' },
    { value: 'B1', label: 'B1 (Intermediate)' },
    { value: 'B2', label: 'B2 (Upper Intermediate)' },
    { value: 'C1', label: 'C1 (Advanced)' },
    { value: 'C2', label: 'C2 (Proficient)' },
    { value: 'Native', label: 'Native' },
];

export default function SignupForm({ onSignupSuccess, onLoginLink }) {
    const {
        firstName,
        setFirstName,
        lastName,
        setLastName,
        email,
        setEmail,
        password,
        setPassword,
        nativeLanguage,
        setNativeLanguage,
        userLevel,
        setUserLevel,
        error,
        loading,
        handleSubmit,
    } = useSignupForm({ onSignupSuccess });

    const lang = (navigator.language || 'en').split('-')[0].toLowerCase();

    return (
        <>
            <h2 className="text-center mb-4" style={{ fontFamily: "'Orbitron', sans-serif", color: 'yellow' }}>
                {Strings.get('auth_signup_title', lang)}
            </h2>
            {error && <div className="alert alert-danger" role="alert">{error}</div>}

            <form onSubmit={handleSubmit}>
                <div className="row mb-3">
                    <div className="col-md-6">
                        <label htmlFor="first-name" className="form-label">{Strings.get('profile_first_name', lang)}</label>
                        <input
                            type="text"
                            className="form-control"
                            id="first-name"
                            value={firstName}
                            onChange={(e) => setFirstName(e.target.value)}
                            required
                        />
                    </div>
                    <div className="col-md-6 mt-3 mt-md-0">
                        <label htmlFor="last-name" className="form-label">{Strings.get('profile_last_name', lang)}</label>
                        <input
                            type="text"
                            className="form-control"
                            id="last-name"
                            value={lastName}
                            onChange={(e) => setLastName(e.target.value)}
                            required
                        />
                    </div>
                </div>
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
                    <label htmlFor="password" className="form-label">{Strings.get('auth_password_min_chars', lang)}</label>
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

                <div className="row mb-3">
                    <div className="col-6">
                        <label htmlFor="nativeLanguage" className="form-label">{Strings.get('profile_native_language', lang)}</label>
                        <select
                            className="form-select"
                            id="nativeLanguage"
                            value={nativeLanguage}
                            onChange={(e) => setNativeLanguage(e.target.value)}
                            required
                        >
                            {NATIVE_LANGUAGES.map((lang) => (
                                <option key={lang.value} value={lang.value} disabled={lang.disabled}>
                                    {lang.label}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="col-6">
                        <label htmlFor="userLevel" className="form-label">{Strings.get('profile_user_level', lang)}</label>
                        <select
                            className="form-select"
                            id="userLevel"
                            value={userLevel}
                            onChange={(e) => setUserLevel(e.target.value)}
                            required
                        >
                            {ENGLISH_LEVELS.map((level) => (
                                <option key={level.value} value={level.value} disabled={level.disabled}>
                                    {level.label}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                <button type="submit" className="btn btn-primary" disabled={loading}>
                    {loading ? Strings.get('auth_creating_account', lang) : Strings.get('auth_signup_title', lang)}
                </button>
            </form>

            <div className="text-center mt-3">
                <p>{Strings.get('auth_already_account', lang)} <a href="#" onClick={(e) => { e.preventDefault(); onLoginLink?.(); }}>{Strings.get('auth_log_in_link', lang)}</a></p>
            </div>
        </>
    );
}
