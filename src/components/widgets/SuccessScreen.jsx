import React from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';
import { ContinueButton, VideoButton, RepeatButton } from './SuccessButtons.jsx';
import SuccessEffects from './SuccessEffects.jsx';
import { getBilingual } from '../../data/strings.js';
import { resolveRecapOverlay } from '../../modules/video/video-processor-logic.js';

export default function SuccessScreen({ onLoadNextLesson, onRepeat, canvasRef }) {
  const bottomState = useStore(appStore, state => state.bottomState);
  const lessonId = useStore(appStore, state => state.successLessonId);
  const videoButton = useStore(appStore, state => state.successVideoButton);
  const configData = useStore(appStore, state => state.configData);
  const currentLessonIndex = useStore(appStore, state => state.currentLessonIndex);
  const userData = useStore(appStore, state => state.userData);

  if (bottomState !== 'lessonSuccess') return null;

  // The water band only appears once the recap is generated and the action
  // button(s) are on screen.
  const showActions = videoButton.state === 'ready';

  // Friend-challenge lessons (recapOverlay: 'shareCta') offer only Share, with a
  // call to action; other lessons keep the Replay / Share / Continue row.
  const currentLesson = configData?.lessons?.[currentLessonIndex];
  const isFriendLesson = resolveRecapOverlay(currentLesson) === 'shareCta';
  const cta = getBilingual('share_cta_success', userData?.native_language || 'en');

  return (
    <>
      <SuccessEffects />

      <div
        id="state-lesson-success"
        className={showActions ? 'success-actions water-surface' : undefined}
      >
        {showActions && isFriendLesson && (
          <p className="success-share-cta">
            {cta.localized ? (
              <React.Fragment>{cta.english}<br /><span lang={cta.lang}>{cta.localized}</span></React.Fragment>
            ) : cta.english}
          </p>
        )}

        <div className="success-actions-row">
          {!isFriendLesson && <RepeatButton lessonId={lessonId} onRepeat={onRepeat} />}
          <VideoButton canvasRef={canvasRef} />
          {!isFriendLesson && <ContinueButton onLoadNextLesson={onLoadNextLesson} />}
        </div>
      </div>
    </>
  );
}
