import React, { useEffect } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';
import { ContinueButton, VideoButton, RepeatButton } from './SuccessButtons.jsx';
import SuccessEffects from './SuccessEffects.jsx';
import { getBilingual } from '../../data/strings.js';
import Strings from '../../data/strings.js';
import { resolveRecapOverlay } from '../../modules/video/video-processor-logic.js';
import { useNativeLanguage } from '../../hooks/use-native-language.js';

export default function SuccessScreen({ onLoadNextLesson, onRepeat, canvasRef }) {
  const bottomState = useStore(appStore, state => state.bottomState);
  const lessonId = useStore(appStore, state => state.successLessonId);
  const videoButton = useStore(appStore, state => state.successVideoButton);
  const configData = useStore(appStore, state => state.configData);
  const currentLessonIndex = useStore(appStore, state => state.currentLessonIndex);
  const clipsPublishing = useStore(appStore, state => state.clipsPublishing);
  const lang = useNativeLanguage();

  // Closing or navigating away while the per-segment clips are still uploading
  // aborts them (they are not retried on the next visit), so prompt first.
  useEffect(() => {
    if (!clipsPublishing) return undefined;
    const handler = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [clipsPublishing]);

  if (bottomState !== 'lessonSuccess') return null;

  // The water band only appears once the recap is generated and the action
  // button(s) are on screen.
  const showActions = videoButton.state === 'ready';

  // Friend-challenge lessons (recapOverlay: 'shareCta') offer only Share, with a
  // call to action; other lessons keep the Replay / Share / Continue row.
  const currentLesson = configData?.lessons?.[currentLessonIndex];
  const isFriendLesson = resolveRecapOverlay(currentLesson) === 'shareCta';
  const cta = getBilingual('share_cta_success', lang);
  const uploadingWarning = Strings.get('clips_uploading_warning', lang);

  return (
    <>
      <SuccessEffects />

      <div
        id="state-lesson-success"
        className={showActions ? 'success-actions water-surface' : undefined}
      >
        {clipsPublishing && (
          <div
            id="clipsUploadingWarning"
            role="alert"
            style={{
              background: '#ffc107',
              color: '#111',
              fontWeight: 700,
              fontSize: '0.9rem',
              lineHeight: 1.3,
              textAlign: 'center',
              borderRadius: '0.5rem',
              padding: '0.5rem 0.75rem',
              margin: '0 0 0.5rem',
              boxShadow: '0 2px 10px rgba(0, 0, 0, 0.45)'
            }}
          >
            {uploadingWarning}
          </div>
        )}

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
