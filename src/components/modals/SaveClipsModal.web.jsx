// SaveClipsModal — shown when a guest presses the create-video button on the
// success screen. The guest must sign up (or log in) to get a share code before
// the video is created, so the modal gates generation: it opens on the button
// press, and generation resumes once the modal closes (signup/login success or
// "Not now").
//
// Both the signup and login forms are rendered inline (SaveClipsSignupForm /
// SaveClipsLoginForm) — no navigation away from the success screen.
//
// The lessonId is captured by the caller (SuccessButtons) into
// `pendingPublishLessonId` at modal-open time, so it survives the login
// navigation (Zustand state persists across route changes in the session).
import React, { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';
import { trackEvent } from '../../modules/utils/posthog.js';
import Strings from '../../data/strings.js';
import SaveClipsSignupForm from './SaveClipsSignupForm.jsx';
import SaveClipsLoginForm from './SaveClipsLoginForm.jsx';

export default function SaveClipsModal() {
    const isOpen = useStore(appStore, (state) => state.saveClipsModalOpen);
    const pendingPublishLessonId = useStore(appStore, (state) => state.pendingPublishLessonId);
    const userData = useStore(appStore, (state) => state.userData);
    const guestNativeLang = useStore(appStore, (state) => state.guestNativeLanguage);
    const dialogRef = useRef(null);
    const [mode, setMode] = useState('signup');

    // Reset to the signup form whenever the modal (re)opens.
    useEffect(() => {
        if (isOpen) setMode('signup');
    }, [isOpen]);
    const lang = (guestNativeLang || userData?.native_language || 'en').split('-')[0].toLowerCase();

    // Open/close the native <dialog> in sync with `saveClipsModalOpen`.
    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (isOpen) {
            if (!dialog.open) {
                try { dialog.showModal(); }
                catch (e) { console.warn('[SaveClipsModal] showModal failed:', e); }
                trackEvent('publish_clips_modal_shown', { lessonId: pendingPublishLessonId });
            }
        } else {
            if (dialog.open) {
                try { dialog.close(); } catch (e) { /* ignore */ }
            }
        }
    }, [isOpen, pendingPublishLessonId]);

    const handleNotNow = () => {
        trackEvent('publish_clips_declined', { lessonId: pendingPublishLessonId });
        appStore.getState().setPendingPublishLessonId(null);
        appStore.getState().setSaveClipsModalOpen(false);
    };

    // Native dialog close (Escape / backdrop) — treat as "not now" if
    // the modal is still considered open. Idempotent via the store getter.
    const handleDialogClose = () => {
        if (appStore.getState().saveClipsModalOpen) {
            handleNotNow();
        }
    };

    const handleLoginLink = () => {
        trackEvent('publish_clips_modal_action', { action: 'login' });
        setMode('login');
    };

    const handleSignupLink = () => {
        trackEvent('publish_clips_modal_action', { action: 'signup' });
        setMode('signup');
    };

    return (
        <dialog ref={dialogRef} id="saveClipsModal" onClose={handleDialogClose}>
            <div className="modal-dialog modal-dialog-centered">
                <div className="modal-content bg-dark text-white border-light shadow-lg">
                    <div className="modal-header border-secondary">
                        <h5 className="modal-title" id="saveClipsModalLabel">
                            <i className="bi bi-cloud-upload text-warning me-2"></i>
                            <span id="saveClipsModalTitleText">
                                {Strings.get('save_clips_title', lang)}
                            </span>
                        </h5>
                    </div>
                    <div className="modal-body">
                        <p className="text-light" id="saveClipsModalBodyText">
                            {Strings.get('save_clips_body', lang)}
                        </p>
                        {mode === 'login' ? (
                            <SaveClipsLoginForm
                                onLoginSuccess={() => {
                                    appStore.getState().setPendingPublishLessonId(null);
                                    appStore.getState().setSaveClipsModalOpen(false);
                                }}
                                onSignupLink={handleSignupLink}
                            />
                        ) : (
                            <SaveClipsSignupForm
                                onSignupSuccess={() => {
                                    appStore.getState().setPendingPublishLessonId(null);
                                    appStore.getState().setSaveClipsModalOpen(false);
                                }}
                                onLoginLink={handleLoginLink}
                            />
                        )}
                        <button
                            type="button"
                            className="btn btn-outline-light w-100 mt-3"
                            id="saveClipsNotNowBtn"
                            onClick={handleNotNow}
                        >
                            <span id="saveClipsNotNowBtnText">Not now</span>
                        </button>
                    </div>
                </div>
            </div>
        </dialog>
    );
}
