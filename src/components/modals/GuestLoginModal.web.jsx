/**
 * GuestLoginModal — modal dialog for guest login prompt.
 * Uses a native <dialog> with show() (NOT showModal) so native <select>
 * dropdowns work reliably across browsers — showModal's focus trap
 * interferes with select click-to-open on Chrome/Windows.
 *
 * Two-step flow:
 *   1. 'select-language' — user picks their native language from a dropdown
 *      (browser/device language pre-selected), or chooses "English only" /
 *      "not on this list".
 *   2. 'login-choice'     — Log In / Sign Up / Continue as Guest buttons,
 *      localized using the language the guest just picked.
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

export default function GuestLoginModal() {
    const isGuestModalOpen = useStore(appStore, (state) => state.isGuestModalOpen);
    const guestModalStep = useStore(appStore, (state) => state.guestModalStep);
    const guestNativeLanguage = useStore(appStore, (state) => state.guestNativeLanguage);
    const guestDetectedLang = useStore(appStore, (state) => state.guestDetectedLang);
    const dialogRef = useRef(null);

    // ── Controlled select value so detected language is truly pre-selected ──
    //    defaultValue is read-once at mount — it misses the async detectedLang.
    const [selectedLang, setSelectedLang] = useState('');

    // Sync the controlled value when the detected language arrives.
    useEffect(() => {
        if (guestDetectedLang && guestModalStep === 'select-language') {
            setSelectedLang(guestDetectedLang);
            console.log('[GuestLoginModal] Pre-selected detected language:', guestDetectedLang);
        }
    }, [guestDetectedLang, guestModalStep]);

    // ── Show / hide the native <dialog> ──
    //    Using show() / close() instead of showModal() / close() avoids the
    //    top-layer focus trap that breaks native <select> on Chrome/Windows.
    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;

        if (isGuestModalOpen) {
            if (!dialog.open) {
                try {
                    dialog.show();
                } catch (e) {
                    console.warn('[GuestLoginModal] failed to show():', e);
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

    // ── Escape key closes the dialog (showModal does this natively; show does not) ──
    useEffect(() => {
        if (!isGuestModalOpen) return;
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                handleDialogClose();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isGuestModalOpen]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Derive the display language from the guest's choice ──
    const location = useLocation();
    // "OTHER" / missing / unrecognised all fall back to English.
    const lang = (
        guestNativeLanguage && guestNativeLanguage !== 'OTHER'
            ? guestNativeLanguage
            : guestDetectedLang || 'EN'
    ).toLowerCase();
    const currentUrl = location.pathname + location.search;

    // ── Build the dropdown list, putting the detected language first ──
    const languageOptions = useMemo(() => {
        const detected = guestDetectedLang;
        if (!detected) return GUEST_LANGUAGES;
        const alreadyInList = GUEST_LANGUAGES.some(l => l.value === detected);
        if (alreadyInList) {
            const rest = GUEST_LANGUAGES.filter(l => l.value !== detected);
            const match = GUEST_LANGUAGES.find(l => l.value === detected);
            return [match, ...rest];
        }
        // Prepend the detected language (e.g. a lesser-known locale).
        let label = detected;
        try {
            if (typeof Intl !== 'undefined' && Intl.DisplayNames) {
                label = new Intl.DisplayNames([detected], { type: 'language' }).of(detected) || detected;
            }
        } catch { /* ignore */ }
        return [{ value: detected, label }, ...GUEST_LANGUAGES];
    }, [guestDetectedLang]);

    // ── Handlers ──

    /**
     * Atomically set both guestNativeLanguage AND guestModalStep in ONE
     * Zustand set() so React never sees a frame where the step is
     * 'login-choice' but the language is still null.
     */
    const advanceToLoginChoice = useCallback((chosenLang) => {
        appStore.getState().setGuestLanguageAndAdvance(chosenLang);
        trackEvent('guest_modal_action', { action: 'language_selected', language: chosenLang });
        console.log('[GuestLoginModal] Guest selected native language:', chosenLang);
    }, []);

    const handleEnglishOnly = useCallback(() => {
        advanceToLoginChoice('EN');
    }, [advanceToLoginChoice]);

    const handleNotListed = useCallback(() => {
        // Advance with 'OTHER' — the lang computation above falls back to EN.
        appStore.getState().setGuestLanguageAndAdvance('OTHER');
        trackEvent('guest_modal_action', { action: 'language_not_listed' });
        console.log('[GuestLoginModal] Guest chose "not on this list"');
    }, []);

    const handleDropdownChange = useCallback((e) => {
        const val = e.target.value;
        if (!val) return; // placeholder — shouldn't happen with controlled value
        advanceToLoginChoice(val);
    }, [advanceToLoginChoice]);

    const handleDialogClose = useCallback(() => {
        trackEvent('guest_modal_action', { action: 'continue_as_guest' });
        appStore.getState().setGuestModalOpen(false);
        console.log('[GuestLoginModal] User chose to continue as guest (dialog close)');
    }, []);

    // ── Render ──

    return (
        <>
            {/* Manual backdrop — needed because we use show() not showModal() */}
            {isGuestModalOpen && (
                <div
                    className="modal-backdrop fade show"
                    style={{ zIndex: 1054, cursor: 'pointer' }}
                    aria-hidden="true"
                    onClick={handleDialogClose}
                />
            )}

            <dialog
                ref={dialogRef}
                id="guestLoginModal"
                onClose={handleDialogClose}
                style={{
                    zIndex: 1055,
                    border: 'none',
                    borderRadius: '0.5rem',
                    padding: 0,
                    background: 'transparent',
                }}
            >
                <div className="modal-dialog modal-dialog-centered">
                    <div className="modal-content bg-dark text-white border-light shadow-lg">

                        {guestModalStep === 'select-language' ? (
                            <>
                                <div className="modal-header border-secondary">
                                    <h5 className="modal-title" id="guestLoginModalLabel">
                                        <i className="bi bi-translate text-warning me-2"></i>
                                        <span id="guestLoginModalTitleText">
                                            {Strings.get('guest_language_title', lang) || "What language do you speak?"}
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
                                                {Strings.get('guest_language_select', lang) || "Select your language..."}
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
                                            className="btn btn-outline-light"
                                            id="guestEnglishOnlyBtn"
                                            onClick={handleEnglishOnly}
                                        >
                                            <span id="guestEnglishOnlyBtnText">
                                                {Strings.get('guest_language_english_only', lang) || "Continue in English only"}
                                            </span>
                                        </button>
                                        <button
                                            type="button"
                                            className="btn btn-outline-secondary btn-sm"
                                            id="guestNotListedBtn"
                                            onClick={handleNotListed}
                                        >
                                            <span id="guestNotListedBtnText">
                                                {Strings.get('guest_language_not_listed', lang) || "My language is not on this list"}
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
                                            {Strings.get('guest_modal_title', lang) || "Welcome!"}
                                        </span>
                                    </h5>
                                </div>
                                <div className="modal-body">
                                    <p className="text-light" id="guestLoginModalBodyText">
                                        {Strings.get('guest_modal_body', lang) || "You are currently not logged in. Log in or sign up to save your progress and access all features. Or, continue as a guest to try out the app."}
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
                                                {Strings.get('guest_modal_login', lang) || "Log In"}
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
                                                {Strings.get('guest_modal_signup', lang) || "Sign Up"}
                                            </span>
                                        </Link>
                                        <button
                                            type="button"
                                            className="btn btn-outline-light mt-2"
                                            id="guestContinueBtn"
                                            onClick={handleDialogClose}
                                        >
                                            <span id="guestContinueBtnText">
                                                {Strings.get('guest_modal_continue', lang) || "Continue as Guest"}
                                            </span>
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </dialog>
        </>
    );
}
