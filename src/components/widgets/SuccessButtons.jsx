import React, { useRef, useEffect, useCallback } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';
import { trackEvent } from '../../modules/utils/posthog.js';
import { useAddFriendLinkMutation, useRecordFriendResponseMutation } from '../../modules/api/api.js';
import { resolveFriendLessonLink } from '../../modules/user/friend-lesson-link-logic.js';
import { resolveFriendResponseNotification } from '../../modules/notifications/notification-logic.js';
import { getBilingual } from '../../data/strings.js';
import { useNativeLanguage } from '../../hooks/use-native-language.js';
import { isStaleChunkReloadPending } from '../../modules/utils/stale-chunk-reload.js';

// Bilingual label above a circular call-btn, matching the earlier steps.
function ChoiceLabel({ text }) {
  return (
    <div className="ivp-choice-label">
      <div className="ivp-choice-label-text">
        {text.localized ? (
          <React.Fragment>{text.english}<br /><span lang={text.lang}>{text.localized}</span></React.Fragment>
        ) : text.english}
      </div>
    </div>
  );
}

export function ContinueButton({ onLoadNextLesson }) {
  const button = useStore(appStore, state => state.successContinueButton);
  const lang = useNativeLanguage();
  const setLoading = useStore(appStore, state => state.setSuccessContinueLoading);

  if (!button.visible) return null;

  const handleClick = () => {
    setLoading(true);
    onLoadNextLesson();
  };

  return (
    <div className="ivp-choice-col" style={{ flex: '1 1 0', minWidth: 0 }}>
      <ChoiceLabel text={getBilingual('continue', lang)} />
      <button
        type="button"
        id="continueButtonSuccess"
        className="btn call-btn"
        onClick={handleClick}
        disabled={button.loading}
        aria-label="Continue"
      >
        <i className="bi bi-chevron-right" />
      </button>
    </div>
  );
}

export function VideoButton({ canvasRef }) {
  const button = useStore(appStore, state => state.successVideoButton);
  const lessonId = useStore(appStore, state => state.successLessonId);
  const fluencyData = useStore(appStore, state => state.successFluencyData);
  const appPhase = useStore(appStore, state => state.appPhase);
  const currentVideo = useStore(appStore, state => state.currentVideo);
  const userData = useStore(appStore, state => state.userData);
  const setVideoState = useStore(appStore, state => state.setSuccessVideoState);
  const setCanvasVisible = useStore(appStore, state => state.setSuccessCanvasVisible);
  const setRepeatVisible = useStore(appStore, state => state.setSuccessRepeatButtonVisible);
  const setSuccessVideoBlob = useStore(appStore, state => state.setSuccessVideoBlob);
  const setContinueVisible = useStore(appStore, state => state.setSuccessContinueVisible);
  const lang = useNativeLanguage();
  const shareHandlerRef = useRef(null);
  const friendLinkMutation = useAddFriendLinkMutation();
  const friendResponseMutation = useRecordFriendResponseMutation();
  const pendingVideoCreation = useStore(appStore, state => state.pendingVideoCreation);
  const saveClipsModalOpen = useStore(appStore, state => state.saveClipsModalOpen);

  // Shared processing logic — runs immediately on processBtn click.
  // For logged-in users, also publishes segments to R2.
  const runProcessing = useCallback(async ({ publishSegments }) => {
    try {
      appStore.getState().triggerPauseAllVideos();
      appStore.getState().setCurrentVideo(null);

      const { processVideo, shareVideo, exportSegmentsToR2, uploadCompleteVideoToR2 } = await import('../../modules/video/video-processor.js');
      const canvas = canvasRef?.current;
      const result = await processVideo(fluencyData, lessonId, canvas);

      if (result?.blob) {
        trackEvent('video_generation_success');
        setCanvasVisible(false);
        setSuccessVideoBlob(result.blob);
        setVideoState('ready');
        setRepeatVisible(true);
        setContinueVisible(true);

        shareHandlerRef.current = async () => {
          const { generateVideoFilename } = await import('../../modules/lesson/success-lesson-logic.js');
          const filename = `${generateVideoFilename(lessonId)}.${result.ext || 'webm'}`;
          await shareVideo(result.blob, filename, result.ext || 'webm');
        };

        if (publishSegments) {
          // Publishing to R2 (and recording the friend link) must never fail the
          // video-generation flow: the stitched video is already ready above.
          // Flag it so the success screen can warn the user not to close the tab
          // while the clips are still uploading.
          appStore.getState().setClipsPublishing(true);
          try {
            const exportResult = await exportSegmentsToR2(lessonId, result.segments, result.blob);
            // Best-effort: also publish the concatenated recap to R2 (same
            // videos/ namespace, 48h TTL). Fire-and-forget so a slow or failed
            // complete upload never delays the friend link or the UI.
            uploadCompleteVideoToR2(result.blob, lessonId)
              .catch((e) => console.error('[Success] complete-video upload failed (non-fatal):', e));
            const { configData, courseId, userData } = appStore.getState();
            const payload = resolveFriendLessonLink({
              configData,
              lessonId,
              courseId,
              courseName: configData?.courseName,
              shareCode: userData?.shareCode,
              succeeded: exportResult?.succeeded,
            });
            if (payload) {
              await friendLinkMutation.mutateAsync({
                userId: userData.$id,
                entry: { ...payload, addedAt: new Date().toISOString() },
              });
              trackEvent('friend_lesson_link_created', payload);
            }

            // Notify the asker whose share link this friend opened. Uses the
            // share code captured from the URL (?shareCode=) in App.jsx.
            const responsePayload = resolveFriendResponseNotification({
              configData,
              lessonId,
              courseId,
              recipientShareCode: appStore.getState().friendCode,
              actorShareCode: userData?.shareCode,
              succeeded: exportResult?.succeeded,
            });
            if (responsePayload) {
              await friendResponseMutation.mutateAsync(responsePayload);
              trackEvent('friend_response_notified', { courseId, lessonId });
            }
          } catch (e) {
            console.error('[Success] R2 publish / friend link failed (non-fatal):', e);
          } finally {
            appStore.getState().setClipsPublishing(false);
          }
        }
      }
    } catch (err) {
      // A stale deploy has already triggered a bounded reload; suppress the
      // failure UI so the learner does not see an alert mid-navigation.
      if (isStaleChunkReloadPending()) return;
      trackEvent('video_generation_failed', { error: err.message });
      console.error('[Success] Video generation failed:', err);
      alert('Failed to generate video. Please try again.');
      setVideoState('idle');
    }
  }, [canvasRef, fluencyData, lessonId, setCanvasVisible, setSuccessVideoBlob, setVideoState, setRepeatVisible, setContinueVisible, friendLinkMutation, friendResponseMutation]);

  if (!button.visible) return null;

  const isUserLoggedIn = () => {
    const { isLoggedIn, userData } = appStore.getState();
    return (
      !!isLoggedIn &&
      userData?.auth_method === 'supabase' &&
      userData?.$id && userData.$id !== 'guest'
    );
  };

  const handleProcess = async () => {
    trackEvent('video_generation_started');

    // Guests must log in (or dismiss) before the video is created: they need a
    // share code for the shared link. Show the modal and defer generation until
    // the modal closes (login success or "Not now").
    if (!isUserLoggedIn()) {
      appStore.getState().setPendingPublishLessonId(lessonId);
      appStore.getState().setPendingVideoCreation(true);
      appStore.getState().setSaveClipsModalOpen(true);
      return;
    }

    setVideoState('processing');
    setCanvasVisible(true);
    await runProcessing({ publishSegments: true });
  };

  // Resume generation once the guest has resolved the modal (logged in or
  // dismissed). pendingVideoCreation is set by handleProcess; the modal closing
  // (saveClipsModalOpen -> false) is the trigger to run the deferred
  // generation. Depends on saveClipsModalOpen too, because "Not now" closes the
  // modal without clearing pendingVideoCreation.
  useEffect(() => {
    if (!pendingVideoCreation) return;
    if (saveClipsModalOpen) return;
    appStore.getState().setPendingVideoCreation(false);
    setVideoState('processing');
    setCanvasVisible(true);
    runProcessing({ publishSegments: isUserLoggedIn() });
  }, [pendingVideoCreation, saveClipsModalOpen, runProcessing, setVideoState, setCanvasVisible]);

  const handleShare = () => {
    if (shareHandlerRef.current) {
      shareHandlerRef.current();
    }
  };

  if (button.state === 'idle') {
    // The button must never be missing: gating its *existence* on the success
    // clip firing `ended` stranded learners when autoplay was blocked or the
    // clip stalled. So the big call button is always rendered, and what
    // "reveals" when the clip finishes (or there is no clip to wait for) is the
    // glow + the water overlay:
    //  - appPhase === 'lessonSuccess-decisionTime' is set by SimpleVideoPlayer
    //    on `ended`/`error`, and drives the water overlay.
    //  - currentVideo?.responseType === 'success' tells us a success clip is
    //    pending; a success step with no clip reveals (glows) immediately.
    const successVideoPending = currentVideo?.responseType === 'success';
    const revealed = appPhase === 'lessonSuccess-decisionTime' || !successVideoPending;

    const continueLabel = getBilingual('continue', lang);

    return (
      <div className={`ivp-choice-col${revealed ? '' : ' process-btn-pending'}`} style={{ flex: '0 0 auto', minWidth: 0 }}>
        <ChoiceLabel text={continueLabel} />
        <button
          type="button"
          id="processBtn"
          className="btn call-btn"
          onClick={handleProcess}
          aria-label="Continue"
        >
          <i className="bi bi-play-fill" />
        </button>
      </div>
    );
  }

  if (button.state === 'processing') {
    return (
      <button type="button" className="btn btn-outline-primary w-100" disabled>
        <span className="spinner-border spinner-border-sm me-2" />
        Generating...
      </button>
    );
  }

  if (button.state === 'ready') {
    return (
      <div className="ivp-choice-col call-btn-primary" style={{ flex: '1 1 0', minWidth: 0 }}>
        <ChoiceLabel text={getBilingual('share', lang)} />
        <button
          type="button"
          id="createVideoButton"
          className="btn call-btn"
          onClick={handleShare}
          aria-label="Share"
        >
          <i className="bi bi-share-fill" />
        </button>
      </div>
    );
  }

  return null;
}

export function RepeatButton({ lessonId, onRepeat }) {
  const button = useStore(appStore, state => state.successRepeatButton);
  const lang = useNativeLanguage();

  if (!button.visible || !lessonId || !onRepeat) return null;

  const handleRepeat = () => {
    trackEvent('success_repeat', { lesson_id: lessonId });
    onRepeat(lessonId);
  };

  return (
    <div className="ivp-choice-col" style={{ flex: '1 1 0', minWidth: 0 }}>
      <ChoiceLabel text={getBilingual('replay', lang)} />
      <button
        type="button"
        id="repeatButtonSuccess"
        className="btn call-btn"
        onClick={handleRepeat}
        title="Repeat this lesson / Repetir esta lección"
        aria-label="Replay"
      >
        <i className="bi bi-arrow-counterclockwise" />
      </button>
    </div>
  );
}
