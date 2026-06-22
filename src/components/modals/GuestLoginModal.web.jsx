/**
 * GuestLoginModal — modal dialog for guest login prompt.
 * Uses a native <dialog> with showModal() for proper centering, ::backdrop,
 * and Escape-to-close behavior.
 *
 * Two-step flow:
 *   1. 'select-language' — dropdown (browser language pre-selected) +
 *      primary "Continue in [Language]" button + "English only" +
 *      "not on this list".  UI re-translates as the dropdown changes.
 *   2. 'login-choice'     — Log In / Sign Up / Continue as Guest,
 *      localized using the language chosen in step 1.
 */

import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';
import Strings from '../../data/strings.js';
import { trackEvent } from '../../modules/utils/logrocket.js';

// ── Curated language list for the guest modal ──
const GUEST_LANGUAGES = [
    { value: 'EN', label: 'English' },
    { value: 'ES', label: 'Español (Spanish)' },
    { value: 'PT', label: 'Português (Portuguese)' },
    { value: 'FR', label: 'Français (French)' },
    { value: 'DE', label: 'Deutsch (German)' },
    { value: 'IT', label: 'Italiano (Italian)' },
    { value: 'JA', label: '日本語 (Japanese)' },
    { value: 'KO', label: '한국어 (Korean)' },
    { value: 'ZH', label: '中文 (Chinese)' },
    { value: 'RU', label: 'Русский (Russian)' },
    { value: 'AR', label: 'العربية (Arabic)' },
    { value: 'HI', label: 'हिन्दी (Hindi)' },
    { value: 'VI', label: 'Tiếng Việt (Vietnamese)' },
    { value: 'TR', label: 'Türkçe (Turkish)' },
    { value: 'NL', label: 'Nederlands (Dutch)' },
    { value: 'PL', label: 'Polski (Polish)' },
    { value: 'SV', label: 'Svenska (Swedish)' },
    { value: 'TH', label: 'ไทย (Thai)' },
];

/** Map language code to the native name (first part of the label). */
function nativeName(code) {
    const entry = GUEST_LANGUAGES.find(l => l.value === code);
    if (entry) return entry.label.split(' (')[0];
    return code;
}

export default function GuestLoginModal() {
    const isGuestModalOpen = useStore(appStore, (state) => state.isGuestModalOpen);
    const guestModalStep = useStore(appStore, (state) => state.guestModalStep);
    const guestNativeLanguage = useStore(appStore, (state) => state.guestNativeLanguage);
    const guestDetectedLang = useStore(appStore, (state) => state.guestDetectedLang);
    const dialogRef = useRef(null);

    // ── Controlled select — dropdown only updates local state ──
    const [selectedLang, setSelectedLang] = useState('');

    // Pre-select the detected language when the modal first opens.
    useEffect(() => {
        if (guestDetectedLang && guestModalStep === 'select-language') {
            setSelectedLang(guestDetectedLang);
            console.log('[GuestLoginModal] Pre-selected detected language:', guestDetectedLang);
        }
    }, [guestDetectedLang, guestModalStep]);

    // ── showModal / close ──
    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;

        if (isGuestModalOpen) {
            if (!dialog.open) {
                try {
                    dialog.showModal();
                } catch (e) {
                    console.warn('[GuestLoginModal] failed to showModal:', e);
                }
            }
        } else {
            if (dialog.open) {
                try {
                    dialog.close();
                } catch (e) {}
            }
        }
    }, [isGuestModalOpen]);

    // ── Language used for UI strings on each step ──
    const location = useLocation();
    const currentUrl = location.pathname + location.search;

    // On step 1 the UI follows the dropdown selection.
    const step1Lang = (selectedLang || guestDetectedLang || 'EN').toLowerCase();
    // On step 2 the UI uses the confirmed choice (OTHER → fallback to detected/EN).
    const step2Lang = (
        guestNativeLanguage && guestNativeLanguage !== 'OTHER'
            ? guestNativeLanguage
            : guestDetectedLang || 'EN'
    ).toLowerCase();

    // ── Build the dropdown list, detected language first ──
    const languageOptions = useMemo(() => {
        const detected = guestDetectedLang;
        if (!detected) return GUEST_LANGUAGES;
        const alreadyInList = GUEST_LANGUAGES.some(l => l.value === detected);
        if (alreadyInList) {
            const rest = GUEST_LANGUAGES.filter(l => l.value !== detected);
            const match = GUEST_LANGUAGES.find(l => l.value === detected);
            return [match, ...rest];
        }
        let label = detected;
        try {
            if (typeof Intl !== 'undefined' && Intl.DisplayNames) {
                label = new Intl.DisplayNames([detected], { type: 'language' }).of(detected) || detected;
            }
        } catch { /* ignore */ }
        return [{ value: detected, label }, ...GUEST_LANGUAGES];
    }, [guestDetectedLang]);

    // ── Handlers ──

    /** Only update local state — user must press the Continue button to confirm. */
    const handleDropdownChange = useCallback((e) => {
        setSelectedLang(e.target.value);
    }, []);

    /** Confirm the selected language and advance to step 2. */
    const handleContinueWithSelected = useCallback(() => {
        const lang = selectedLang || guestDetectedLang || 'EN';
        appStore.getState().setGuestLanguageAndAdvance(lang);
        trackEvent('guest_modal_action', { action: 'language_selected', language: lang });
        console.log('[GuestLoginModal] Guest confirmed native language:', lang);
    }, [selectedLang, guestDetectedLang]);

    const handleEnglishOnly = useCallback(() => {
        appStore.getState().setGuestLanguageAndAdvance('EN');
        trackEvent('guest_modal_action', { action: 'language_selected', language: 'EN' });
        console.log('[GuestLoginModal] Guest chose English only');
    }, []);

    const handleNotListed = useCallback(() => {
        appStore.getState().setGuestLanguageAndAdvance('OTHER');
        trackEvent('guest_modal_action', { action: 'language_not_listed' });
        console.log('[GuestLoginModal] Guest chose "not on this list"');
    }, []);

    const handleDialogClose = useCallback(() => {
        trackEvent('guest_modal_action', { action: 'continue_as_guest' });
        appStore.getState().setGuestModalOpen(false);
        console.log('[GuestLoginModal] Dialog closed (continue as guest)');
    }, []);

    // ── Render ──

    const chosenName = nativeName(selectedLang || guestDetectedLang || 'EN');

    return (
        <dialog ref={dialogRef} id="guestLoginModal" onClose={handleDialogClose}>
            <div className="modal-dialog modal-dialog-centered">
                <div className="modal-content bg-dark text-white border-light shadow-lg">

                    {guestModalStep === 'select-language' ? (
                        <>
                            <div className="modal-header border-secondary">
                                <h5 className="modal-title" id="guestLoginModalLabel">
                                    <i className="bi bi-translate text-warning me-2"></i>
                                    <span id="guestLoginModalTitleText">
                                        {Strings.get('guest_language_title', step1Lang) || "What language do you speak?"}
                                    </span>
                                </h5>
                            </div>
                            <div className="modal-body">
                                <div className="mb-3">
                                    <select
                                        className="form-select form-select-lg bg-dark text-white border-secondary"
                                        id="guestLanguageSelect"
                                        value={selectedLang}
                                        onChange={handleDropdownChange}
                                    >
                                        <option value="" disabled>
                                            {Strings.get('guest_language_select', step1Lang) || "Select your language..."}
                                        </option>
                                        {languageOptions.map((opt) => (
                                            <option key={opt.value} value={opt.value}>
                                                {opt.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="d-grid gap-2 mt-3">
                                    <button
                                        type="button"
                                        className="btn btn-primary btn-lg"
                                        id="guestLanguageContinueBtn"
                                        onClick={handleContinueWithSelected}
                                        disabled={!selectedLang}
                                    >
                                        <i className="bi bi-arrow-right-circle me-2"></i>
                                        <span id="guestLanguageContinueBtnText">
                                            {chosenName}
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn-outline-light"
                                        id="guestEnglishOnlyBtn"
                                        onClick={handleEnglishOnly}
                                    >
                                        <span id="guestEnglishOnlyBtnText">
                                            {Strings.get('guest_language_english_only', 'en') || "Continue in English only"}
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn-outline-secondary btn-sm"
                                        id="guestNotListedBtn"
                                        onClick={handleNotListed}
                                    >
                                        <span id="guestNotListedBtnText">
                                            {Strings.get('guest_language_not_listed', step1Lang) || "My language is not on this list"}
                                        </span>
                                    </button>
                                </div>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="modal-header border-secondary">
                                <h5 className="modal-title" id="guestLoginModalLabel">
                                    <i className="bi bi-shield-lock-fill text-warning me-2"></i>
                                    <span id="guestLoginModalTitleText">
                                        {Strings.get('guest_modal_title', step2Lang) || "Welcome!"}
                                    </span>
                                </h5>
                            </div>
                            <div className="modal-body">
                                <p className="text-light" id="guestLoginModalBodyText">
                                    {Strings.get('guest_modal_body', step2Lang) || "You are currently not logged in."}
                                </p>
                                <div className="d-grid gap-2 mt-4">
                                    <Link
                                        to={`/login?redirect=${encodeURIComponent(currentUrl)}`}
                                        id="guestLoginBtn"
                                        className="btn btn-primary"
                                        onClick={() => trackEvent('guest_modal_action', { action: 'login' })}
                                    >
                                        <i className="bi bi-box-arrow-in-right me-1"></i>
                                        <span id="guestLoginBtnText">
                                            {Strings.get('guest_modal_login', step2Lang) || "Log In"}
                                        </span>
                                    </Link>
                                    <Link
                                        to={`/signup?redirect=${encodeURIComponent(currentUrl)}`}
                                        id="guestSignupBtn"
                                        className="btn btn-secondary"
                                        onClick={() => trackEvent('guest_modal_action', { action: 'signup' })}
                                    >
                                        <i className="bi bi-person-plus-fill me-1"></i>
                                        <span id="guestSignupBtnText">
                                            {Strings.get('guest_modal_signup', step2Lang) || "Sign Up"}
                                        </span>
                                    </Link>
                                    <button
                                        type="button"
                                        className="btn btn-outline-light mt-2"
                                        id="guestContinueBtn"
                                        onClick={handleDialogClose}
                                    >
                                        <span id="guestContinueBtnText">
                                            {Strings.get('guest_modal_continue', step2Lang) || "Continue as Guest"}
                                        </span>
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </dialog>
    );
}
