// SaveClipsModal — shown when a guest presses the create-video button on the
// success screen. The guest must sign up (or log in) to get a share code before
// the video is created, so the modal gates generation: it opens on the button
// press, and generation resumes once the modal closes (signup/login success or
// "Not now").
//
// The signup form is rendered inline (SaveClipsSignupForm) — no navigation to
// /signup. Log In still navigates to /login with a redirect back here.
//
// The lessonId is captured by the caller (SuccessButtons) into
// `pendingPublishLessonId` at modal-open time, so it survives the login
// navigation (Zustand state persists across route changes in the session).
import React, { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';
import { trackEvent } from '../../modules/utils/posthog.js';
import Strings from '../../data/strings.js';
import SaveClipsSignupForm from './SaveClipsSignupForm.jsx';

export default function SaveClipsModal() {
    const isOpen = useStore(appStore, (state) => state.saveClipsModalOpen);
    const pendingPublishLessonId = useStore(appStore, (state) => state.pendingPublishLessonId);
    const userData = useStore(appStore, (state) => state.userData);
    const guestNativeLang = useStore(appStore, (state) => state.guestNativeLanguage);
    const dialogRef = useRef(null);
    const location = useLocation();
    const navigate = useNavigate();
    const currentUrl = location.pathname + location.search;
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

    // Post-login effect: when the user completes login and lands back on
    // the success page, userData transitions from the synthetic guest object
    // to a real Supabase profile (auth_method === 'supabase'), while
    // pendingPublishLessonId is still set. Clear the pending state and close
    // the modal — the success screen then resumes video generation.
    // CRITICAL: must check auth_method === 'supabase' — the guest synthetic
    // userData object ({ $id: 'guest', auth_method: 'guest' }) is truthy and
    // would otherwise clear the state on mount.
    useEffect(() => {
        if (userData?.auth_method === 'supabase' && pendingPublishLessonId) {
            appStore.getState().setPendingPublishLessonId(null);
            appStore.getState().setSaveClipsModalOpen(false);
        }
    }, [userData, pendingPublishLessonId]);

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
        appStore.getState().setSaveClipsModalOpen(false);
        navigate(`/login?redirect=${encodeURIComponent(currentUrl)}`);
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
                        <SaveClipsSignupForm
                            onSignupSuccess={() => {
                                appStore.getState().setPendingPublishLessonId(null);
                                appStore.getState().setSaveClipsModalOpen(false);
                            }}
                            onLoginLink={handleLoginLink}
                        />
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
