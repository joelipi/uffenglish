import React, { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';
import Strings from '../../data/strings.js';

export default function GuestLoginModal() {
    const isGuestModalOpen = useStore(appStore, (state) => state.isGuestModalOpen);
    const userData = useStore(appStore, (state) => state.userData);
    const setGuestModalOpen = appStore.getState().setGuestModalOpen;
    const dialogRef = useRef(null);

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

    const handleClose = () => {
        setGuestModalOpen(false);
        console.log('[GuestLoginModal] User chose to continue as guest');
    };

    const lang = userData?.native_language || 'en';
    const currentUrl = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '';

    return (
        <dialog ref={dialogRef} id="guestLoginModal" onClose={handleClose}>
            <div className="modal-dialog modal-dialog-centered">
                <div className="modal-content bg-dark text-white border-light shadow-lg">
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
                            <a
                                href={`login.html?redirect=${encodeURIComponent(currentUrl)}`}
                                id="guestLoginBtn"
                                className="btn btn-primary"
                            >
                                <i className="bi bi-box-arrow-in-right me-1"></i>
                                <span id="guestLoginBtnText">
                                    {Strings.get('guest_modal_login', lang) || "Log In"}
                                </span>
                            </a>
                            <a
                                href={`signup.html?redirect=${encodeURIComponent(currentUrl)}`}
                                id="guestSignupBtn"
                                className="btn btn-secondary"
                            >
                                <i className="bi bi-person-plus-fill me-1"></i>
                                <span id="guestSignupBtnText">
                                    {Strings.get('guest_modal_signup', lang) || "Sign Up"}
                                </span>
                            </a>
                            <button
                                type="button"
                                className="btn btn-outline-light mt-2"
                                id="guestContinueBtn"
                                onClick={handleClose}
                            >
                                <span id="guestContinueBtnText">
                                    {Strings.get('guest_modal_continue', lang) || "Continue as Guest"}
                                </span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </dialog>
    );
}
