import React from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';
import { ContinueButton, VideoButton, RepeatButton } from './SuccessButtons.jsx';
import SuccessEffects from './SuccessEffects.jsx';

export default function SuccessScreen({ onLoadNextLesson, onRepeat, canvasRef }) {
  const visible = useStore(appStore, state => state.successScreenVisible);
  const lessonId = useStore(appStore, state => state.successLessonId);

  if (!visible) return null;

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
