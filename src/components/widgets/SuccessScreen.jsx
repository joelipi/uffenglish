import React from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';
import { ContinueButton, VideoButton, RepeatButton } from './SuccessButtons.jsx';
import SuccessEffects from './SuccessEffects.jsx';

export default function SuccessScreen({ onLoadNextLesson, onRepeat, canvasRef }) {
  const bottomState = useStore(appStore, state => state.bottomState);
  const lessonId = useStore(appStore, state => state.successLessonId);

  if (bottomState !== 'lessonSuccess') return null;

  return (
    <>
      <SuccessEffects />
      
      <div id="state-lesson-success" className="d-flex gap-2">
        <RepeatButton lessonId={lessonId} onRepeat={onRepeat} />
        <VideoButton canvasRef={canvasRef} />
        <ContinueButton onLoadNextLesson={onLoadNextLesson} />
      </div>
    </>
  );
}
