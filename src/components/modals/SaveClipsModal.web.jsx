// SaveClipsModal — prompts guest users to log in so their webcam segments
// can be published to the R2 practice-prompt library. Single-step (no
// language selection — that's handled by GuestLoginModal). On successful
// login, the post-login effect clears the pending state; the user then
// clicks processBtn again (now logged-in) which runs the recap AND the
// segment publish together (§6.1 / §9.3 of the plan).
//
// The lessonId is captured by the caller (SuccessButtons) into
// `pendingPublishLessonId` at modal-open time, so it survives the login
// navigation (Zustand state persists across route changes in the session).
import React, { useEffect, useRef } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';
import { trackEvent } from '../../modules/utils/posthog.js';

export default function SaveClipsModal() {
    const isOpen = useStore(appStore, (state) => state.saveClipsModalOpen);
    const pendingPublishLessonId = useStore(appStore, (state) => state.pendingPublishLessonId);
    const userData = useStore(appStore, (state) => state.userData);
    const dialogRef = useRef(null);
    const location = useLocation();
    const currentUrl = location.pathname + location.search;

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
    // to a real Appwrite profile (auth_method === 'appwrite'), while
    // pendingPublishLessonId is still set. Clear the pending state and close
    // the modal — the user clicks processBtn again (now logged-in) which
    // runs the recap AND the segment publish together.
    // CRITICAL: must check auth_method === 'appwrite' — the guest synthetic
    // userData object ({ $id: 'guest', auth_method: 'guest' }) is truthy and
    // would otherwise clear the state on mount.
    useEffect(() => {
        if (userData?.auth_method === 'appwrite' && pendingPublishLessonId) {
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

    return (
        <dialog ref={dialogRef} id="saveClipsModal" onClose={handleDialogClose}>
            <div className="modal-dialog modal-dialog-centered">
                <div className="modal-content bg-dark text-white border-light shadow-lg">
                    <div className="modal-header border-secondary">
                        <h5 className="modal-title" id="saveClipsModalLabel">
                            <i className="bi bi-cloud-upload text-warning me-2"></i>
                            <span id="saveClipsModalTitleText">
                                Log in to add your clips
                            </span>
                        </h5>
                    </div>
                    <div className="modal-body">
                        <p className="text-light" id="saveClipsModalBodyText">
                            Log in to add your clips so your friends can make videos responding to you.
                        </p>
                        <div className="d-grid gap-2 mt-4">
                            <Link
                                to={`/login?redirect=${encodeURIComponent(currentUrl)}`}
                                id="saveClipsLoginBtn"
                                className="btn btn-primary"
                                onClick={() => {
                                    appStore.getState().setPendingPublishLessonId(null);
                                    appStore.getState().setSaveClipsModalOpen(false);
                                    trackEvent('publish_clips_modal_action', { action: 'login' });
                                }}
                            >
                                <i className="bi bi-box-arrow-in-right me-1"></i>
                                <span id="saveClipsLoginBtnText">Log In</span>
                            </Link>
                            <Link
                                to={`/signup?redirect=${encodeURIComponent(currentUrl)}`}
                                id="saveClipsSignupBtn"
                                className="btn btn-secondary"
                                onClick={() => {
                                    appStore.getState().setPendingPublishLessonId(null);
                                    appStore.getState().setSaveClipsModalOpen(false);
                                    trackEvent('publish_clips_modal_action', { action: 'signup' });
                                }}
                            >
                                <i className="bi bi-person-plus-fill me-1"></i>
                                <span id="saveClipsSignupBtnText">Sign Up</span>
                            </Link>
                            <button
                                type="button"
                                className="btn btn-outline-light mt-2"
                                id="saveClipsNotNowBtn"
                                onClick={handleNotNow}
                            >
                                <span id="saveClipsNotNowBtnText">Not now</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </dialog>
    );
}
