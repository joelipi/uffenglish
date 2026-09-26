import React, { useRef, useEffect, useCallback } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';
import { trackEvent } from '../../modules/utils/posthog.js';
import { useAddFriendLinkMutation } from '../../modules/api/api.js';
import { resolveFriendLessonLink } from '../../modules/user/friend-lesson-link-logic.js';
import { getBilingual } from '../../data/strings.js';

// Bilingual label above a circular call-btn, matching the earlier steps.
function ChoiceLabel({ text }) {
  return (
    <div className="ivp-choice-label">
      <div className="ivp-choice-label-text">
        {text.localized ? (
          <React.Fragment>{text.english}<br /><span lang={text.lang}><i>{text.localized}</i></span></React.Fragment>
        ) : text.english}
      </div>
    </div>
  );
}

export function ContinueButton({ onLoadNextLesson }) {
  const button = useStore(appStore, state => state.successContinueButton);
  const userData = useStore(appStore, state => state.userData);
  const setLoading = useStore(appStore, state => state.setSuccessContinueLoading);

  if (!button.visible) return null;

  const handleClick = () => {
    setLoading(true);
    onLoadNextLesson();
  };

  return (
    <div className="ivp-choice-col" style={{ flex: '1 1 0', minWidth: 0 }}>
      <ChoiceLabel text={getBilingual('continue', userData?.native_language || 'en')} />
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
  const shareHandlerRef = useRef(null);
  const friendLinkMutation = useAddFriendLinkMutation();

  // Show SaveClipsModal immediately for guests when the success screen
  // appears, blocking the processBtn behind the dialog's backdrop.
  useEffect(() => {
    if (button.visible) {
      const { isLoggedIn, userData, setSaveClipsModalOpen, setPendingPublishLessonId } = appStore.getState();
      const isUserLoggedIn =
        !!isLoggedIn &&
        userData?.auth_method === 'supabase' &&
        userData?.$id && userData.$id !== 'guest';
      if (!isUserLoggedIn) {
        setPendingPublishLessonId(lessonId);
        setSaveClipsModalOpen(true);
      }
    }
  }, [button.visible, lessonId]);

  // Shared processing logic — runs immediately on processBtn click.
  // For logged-in users, also publishes segments to R2.
  const runProcessing = useCallback(async ({ publishSegments }) => {
    try {
      appStore.getState().triggerPauseAllVideos();
      appStore.getState().setCurrentVideo(null);

      const { processVideo, shareVideo, exportSegmentsToR2 } = await import('../../modules/video/video-processor.js');
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
          try {
            const exportResult = await exportSegmentsToR2(lessonId);
            const { configData, courseId, userData } = appStore.getState();
            const payload = resolveFriendLessonLink({
              configData,
              lessonId,
              courseId,
              shareCode: userData?.shareCode,
              succeeded: exportResult?.succeeded,
              askPublished: exportResult?.askPublished,
            });
            if (payload) {
              await friendLinkMutation.mutateAsync({
                userId: userData.$id,
                entry: { ...payload, addedAt: new Date().toISOString() },
              });
              trackEvent('friend_lesson_link_created', payload);
            }
          } catch (e) {
            console.error('[Success] R2 publish / friend link failed (non-fatal):', e);
          }
        }
      }
    } catch (err) {
      trackEvent('video_generation_failed', { error: err.message });
      console.error('[Success] Video generation failed:', err);
      alert('Failed to generate video. Please try again.');
      setVideoState('idle');
    }
  }, [canvasRef, fluencyData, lessonId, setCanvasVisible, setSuccessVideoBlob, setVideoState, setRepeatVisible, setContinueVisible, friendLinkMutation]);

  if (!button.visible) return null;

  const handleProcess = async () => {
    trackEvent('video_generation_started');
    setVideoState('processing');
    setCanvasVisible(true);

    const { isLoggedIn, userData } = appStore.getState();
    const isUserLoggedIn =
      !!isLoggedIn &&
      userData?.auth_method === 'supabase' &&
      userData?.$id && userData.$id !== 'guest';

    await runProcessing({ publishSegments: isUserLoggedIn });
  };

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

    const continueLabel = getBilingual('continue', userData?.native_language || 'en');

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
        <ChoiceLabel text={getBilingual('share', userData?.native_language || 'en')} />
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
  const userData = useStore(appStore, state => state.userData);

  if (!button.visible || !lessonId || !onRepeat) return null;

  const handleRepeat = () => {
    trackEvent('success_repeat', { lesson_id: lessonId });
    onRepeat(lessonId);
  };

  return (
    <div className="ivp-choice-col" style={{ flex: '1 1 0', minWidth: 0 }}>
      <ChoiceLabel text={getBilingual('replay', userData?.native_language || 'en')} />
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
