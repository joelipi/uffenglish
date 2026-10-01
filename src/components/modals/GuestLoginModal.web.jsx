/**
 * GuestLoginModal — modal dialog for guest login prompt.
 * Uses a native <dialog> with showModal() for proper centering, ::backdrop,
 * and Escape-to-close behavior.
 *
 * Two-step flow:
 *   1. 'select-language' — dropdown (browser language pre-selected unless it
 *      is English) + primary "Continue in [Language]" button + "No
 *      translations (not recommended)" + "my language is not on this list".
 *      UI re-translates as the dropdown changes.
 *   2. 'login-choice'     — Log In / Sign Up / Continue as Guest,
 *      localized using the language chosen in step 1.
 */

import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';
import Strings from '../../data/strings.js';
import { GUEST_LANGUAGES } from '../../data/languages.js';
import {
    buildGuestLanguageOptions,
    resolveInitialGuestSelection,
} from '../../modules/user/guest-modal-logic.js';
import { trackEvent } from '../../modules/utils/posthog.js';

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

    // Pre-select the detected language when the modal first opens. An English
    // browser stays unselected so the learner must choose a translation language.
    useEffect(() => {
        if (guestModalStep === 'select-language') {
            const initial = resolveInitialGuestSelection({ detectedLang: guestDetectedLang });
            setSelectedLang(initial);
            console.log('[GuestLoginModal] Initial language selection:', initial || '(none)');
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
    const languageOptions = useMemo(
        () => buildGuestLanguageOptions({ detectedLang: guestDetectedLang, languages: GUEST_LANGUAGES }),
        [guestDetectedLang],
    );

    // ── Handlers ──

    /** Only update local state — user must press the Continue button to confirm. */
    const handleDropdownChange = useCallback((e) => {
        setSelectedLang(e.target.value);
    }, []);

    /** Confirm the selected language and advance to step 2. */
    const handleContinueWithSelected = useCallback(() => {
        const lang = selectedLang || guestDetectedLang || 'EN';
        appStore.getState().confirmGuestLanguage(lang);
        trackEvent('guest_modal_action', { action: 'language_selected', language: lang });
        console.log('[GuestLoginModal] Guest confirmed native language:', lang);
    }, [selectedLang, guestDetectedLang]);

    const handleEnglishOnly = useCallback(() => {
        appStore.getState().confirmGuestLanguage('EN');
        trackEvent('guest_modal_action', { action: 'language_selected', language: 'EN' });
        console.log('[GuestLoginModal] Guest chose English only');
    }, []);

    const handleNotListed = useCallback(() => {
        appStore.getState().confirmGuestLanguage('OTHER');
        trackEvent('guest_modal_action', { action: 'language_not_listed' });
        console.log('[GuestLoginModal] Guest chose "not on this list"');
    }, []);

    const handleDialogClose = useCallback(() => {
        trackEvent('guest_modal_action', { action: 'continue_as_guest' });
        appStore.getState().setGuestModalOpen(false);
        console.log('[GuestLoginModal] Dialog closed (continue as guest)');
    }, []);

    // ── Render ──

    const chosenName = selectedLang ? nativeName(selectedLang) : '';
    const titleText = Strings.get('guest_language_title', step1Lang) || 'Confirm Your Native Language';
    const titleLines = titleText.split('\n');

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
                                        {titleLines.map((line, i) => (
                                            <React.Fragment key={i}>
                                                {i > 0 && <br />}
                                                {line}
                                            </React.Fragment>
                                        ))}
                                    </span>
                                </h5>
                            </div>
                            <div className="modal-body">
                                <div className="mb-3">
                                    <select
                                        className="form-select form-select-xl bg-dark text-white border-secondary w-100"
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
                                            {Strings.get('guest_language_english_only', step1Lang) || "No translations (not recommended)"}
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn-outline-secondary btn-sm"
                                        id="guestNotListedBtn"
                                        onClick={handleNotListed}
                                    >
                                        <span id="guestNotListedBtnText">
                                            {Strings.get('guest_language_not_listed', step1Lang) || "My language is not on this list (continue without translations)"}
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
