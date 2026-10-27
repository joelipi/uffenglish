import React from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';
import { resolveTranscriptTopOffset } from '../../modules/lesson/transcript-overlay-logic.js';
import {
    reviewCountdownProgress,
    shouldShowReviewCountdown,
} from '../../modules/lesson/review-countdown-logic.js';

/**
 * @param {{ topOffsetPx?: number }} props the lesson's top overlay height, so the
 *        box starts flush with the bar's bottom edge instead of a guessed ratio.
 */
export default function WhisperReview({ topOffsetPx = 0 }) {
    const data = useStore(appStore, (s) => s.whisperReviewData);
    const timeLeft = useStore(appStore, (s) => s.whisperReviewTimeLeft);

    if (!data) return null;

    // The auto-accept countdown is off by default (review-countdown-logic.js), so
    // the store holds no time left and the box shows only the transcript: the
    // learner accepts or re-records whenever they are ready.
    const showCountdown = shouldShowReviewCountdown(timeLeft);

    return (
        // Spacing is inline, never a `p-*` utility: app.css defines those with
        // `!important`, which beat the measured top offset and pinned this box
        // 16px from the top (the field report "it's overlapping the progress
        // bar"). Anchored to the TOP of the frame, not centred: the recorded take's play
        // control sits in the middle of the 9:16 video, and a centred transcript
        // box covered it — so a learner whose autoplay was refused could not
        // even see the play button to tap it (stories/094). pointerEvents stays
        // none so every tap still reaches the video underneath.
        <div className="position-absolute top-0 start-0 w-100 h-100 d-flex flex-column align-items-center text-white text-center" style={{ zIndex: 1050, pointerEvents: 'none', justifyContent: 'flex-start', paddingTop: resolveTranscriptTopOffset(topOffsetPx), paddingLeft: 12, paddingRight: 12 }}>
            <div className="whisper-review-box bg-dark p-3 rounded border border-secondary shadow-lg">
                {showCountdown && (
                    <div className="mb-3 text-center fw-bold">Time remaining: {timeLeft}s</div>
                )}
                <div className="mb-3 text-center">{`\"${data.transcript}\"`}</div>
                {showCountdown && (
                    <div className="progress whisper-progress mb-4" style={{ maxWidth: '300px', width: '100%' }}>
                        <div
                            className="progress-bar bg-success"
                            role="progressbar"
                            style={{ width: `${reviewCountdownProgress(timeLeft)}%`, transition: timeLeft > 0 ? 'width 1s linear' : 'none' }}
                        ></div>
                    </div>
                )}
            </div>
        </div>
    );
}
