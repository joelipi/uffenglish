import React, { useRef } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';
import { trackEvent } from '../../modules/utils/logrocket.js';

export function ContinueButton({ onLoadNextLesson }) {
  const button = useStore(appStore, state => state.successContinueButton);
  const setLoading = useStore(appStore, state => state.setSuccessContinueLoading);

  if (!button.visible) return null;

  const handleClick = () => {
    trackEvent('success_continue');
    setLoading(true);
    onLoadNextLesson();
  };

  return (
    <button
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
  const setVideoState = useStore(appStore, state => state.setSuccessVideoState);
  const setCanvasVisible = useStore(appStore, state => state.setSuccessCanvasVisible);
  const setRepeatVisible = useStore(appStore, state => state.setSuccessRepeatButtonVisible);
  const setSuccessVideoBlob = useStore(appStore, state => state.setSuccessVideoBlob);
  const setContinueVisible = useStore(appStore, state => state.setSuccessContinueVisible);
  const shareHandlerRef = useRef(null);

  if (!button.visible) return null;

  const handleProcess = async () => {
    trackEvent('video_generation_started');
    setVideoState('processing');
    setCanvasVisible(true);

    try {
      appStore.getState().triggerPauseAllVideos();
      appStore.getState().setCurrentVideo(null);

      const { processVideo, shareVideo } = await import('../../modules/video/video-processor.js');
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
      }
    } catch (err) {
      trackEvent('video_generation_failed', { error: err.message });
      console.error('[Success] Video generation failed:', err);
      alert('Failed to generate video. Please try again.');
      setVideoState('idle');
    }
  };

  const handleShare = () => {
    trackEvent('video_shared');
    if (shareHandlerRef.current) {
      shareHandlerRef.current();
    }
  };

  if (button.state === 'idle') {
    return (
      <button
        id="processBtn"
        className="btn btn-outline-primary w-100"
        onClick={handleProcess}
      >
        <i className="bi bi-film text-white" />
      </button>
    );
  }

  if (button.state === 'processing') {
    return (
      <button className="btn btn-outline-primary w-100" disabled>
        <span className="spinner-border spinner-border-sm me-2" />
        Generating...
      </button>
    );
  }

  if (button.state === 'ready') {
    return (
      <button
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
      id="repeatButtonSuccess"
      className="btn btn-primary text-white flex-fill repeat-btn"
      onClick={handleRepeat}
      title="Repeat this lesson / Repetir esta lección"
    >
      <i className="bi bi-arrow-counterclockwise text-white" style={{ fontSize: '24px', fontWeight: 900 }} />
    </button>
  );
}
