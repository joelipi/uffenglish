import React from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';
import { ContinueButton, VideoButton, RepeatButton } from './SuccessButtons.jsx';
import SuccessEffects from './SuccessEffects.jsx';

export default function SuccessScreen({ onLoadNextLesson, onRepeat, canvasRef }) {
  const bottomState = useStore(appStore, state => state.bottomState);
  const lessonId = useStore(appStore, state => state.successLessonId);
  const videoButton = useStore(appStore, state => state.successVideoButton);

  if (bottomState !== 'lessonSuccess') return null;

  // The water band only appears once the recap is generated and the three big
  // action buttons (Replay / Share / Continue) are on screen.
  const showActions = videoButton.state === 'ready';

  return (
    <>
      <SuccessEffects />

      <div
        id="state-lesson-success"
        className={`d-flex gap-2${showActions ? ' success-actions water-surface' : ''}`}
      >
        <RepeatButton lessonId={lessonId} onRepeat={onRepeat} />
        <VideoButton canvasRef={canvasRef} />
        <ContinueButton onLoadNextLesson={onLoadNextLesson} />
      </div>
    </>
  );
}
