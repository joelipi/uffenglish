import React, { useRef, useEffect, useCallback } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';
import { trackEvent } from '../../modules/utils/posthog.js';
import { getBilingual } from '../../data/strings.js';

export function ContinueButton({ onLoadNextLesson }) {
  const button = useStore(appStore, state => state.successContinueButton);
  const setLoading = useStore(appStore, state => state.setSuccessContinueLoading);

  if (!button.visible) return null;

  const handleClick = () => {
    setLoading(true);
    onLoadNextLesson();
  };

  return (
    <button
      type="button"
      id="continueButtonSuccess"
      className="btn btn-primary text-white flex-fill"
      onClick={handleClick}
      disabled={button.loading}
      style={{ display: 'inline-block' }}
    >
      <i className="bi bi-chevron-right text-white" style={{ fontSize: '24px', fontWeight: 900 }} />
    </button>
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
          exportSegmentsToR2(lessonId);
        }
      }
    } catch (err) {
      trackEvent('video_generation_failed', { error: err.message });
      console.error('[Success] Video generation failed:', err);
      alert('Failed to generate video. Please try again.');
      setVideoState('idle');
    }
  }, [canvasRef, fluencyData, lessonId, setCanvasVisible, setSuccessVideoBlob, setVideoState, setRepeatVisible, setContinueVisible]);

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
    // Keep the concat button hidden while the short success clip plays so it
    // lands like every earlier step's glowing call button. If the step has no
    // success clip at all (no pending success video), reveal it immediately.
    const successVideoPending = currentVideo?.responseType === 'success';
    const revealed = appPhase === 'lessonSuccess-decisionTime' || !successVideoPending;
    if (!revealed) return null;

    const continueLabel = getBilingual('continue', userData?.native_language || 'en');

    return (
      <div className="ivp-choice-col" style={{ flex: '0 0 auto', minWidth: 0 }}>
        <div className="ivp-choice-label">
          <div className="ivp-choice-label-text">
            {continueLabel.localized ? (
              <React.Fragment>{continueLabel.english}<br /><span lang={continueLabel.lang}><i>{continueLabel.localized}</i></span></React.Fragment>
            ) : continueLabel.english}
          </div>
        </div>
        <button
          type="button"
          id="processBtn"
          className="btn call-btn"
          onClick={handleProcess}
          aria-label="Continue"
        >
          <i className="bi bi-film" />
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
      <button
        type="button"
        id="createVideoButton"
        className="btn btn-success flex-fill"
        onClick={handleShare}
      >
        <i className="bi bi-share-fill text-white" /> Share
      </button>
    );
  }

  return null;
}

export function RepeatButton({ lessonId, onRepeat }) {
  const button = useStore(appStore, state => state.successRepeatButton);

  if (!button.visible || !lessonId || !onRepeat) return null;

  const handleRepeat = () => {
    trackEvent('success_repeat', { lesson_id: lessonId });
    onRepeat(lessonId);
  };

  return (
    <button
      type="button"
      id="repeatButtonSuccess"
      className="btn btn-primary text-white flex-fill repeat-btn"
      onClick={handleRepeat}
      title="Repeat this lesson / Repetir esta lección"
    >
      <i className="bi bi-arrow-counterclockwise text-white" style={{ fontSize: '24px', fontWeight: 900 }} />
    </button>
  );
}
