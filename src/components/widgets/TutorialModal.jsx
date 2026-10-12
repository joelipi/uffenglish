// TutorialModal — full-screen, scrollable tutorial takeover.
//
// Render-only: every rule (slug, URL, subtitle text, close policy) comes from
// src/modules/video/tutorial-logic.js and the localized Continue label from
// src/data/strings.js. This file holds no gates, mappings, or URL building.
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { getBilingual } from '../../data/strings.js';
import { useNativeLanguage } from '../../hooks/use-native-language.js';
import { buildTutorialModalView, createTutorialModalHandlers } from '../../modules/video/tutorial-logic.js';
import { pauseLessonVideoForTutorial } from '../../modules/lesson/lesson-progression.js';

export default function TutorialModal({ stepType, onClose }) {
    const lang = useNativeLanguage();
    const view = useMemo(() => buildTutorialModalView({ stepType, lang }), [stepType, lang]);
    const continueLabel = getBilingual('continue', lang);

    // Callers pass an inline arrow, so hold it in a ref and expose a stable
    // close() — the keydown effect below then attaches its listener once
    // instead of tearing it down on every parent render.
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;
    const handlers = useMemo(
        () => createTutorialModalHandlers({ onClose: () => onCloseRef.current?.() }),
        []
    );

    // Opening the tutorial stops the lesson underneath so only the tutorial is
    // audible/visible. This is the single pause site: every row renders this
    // modal, so pausing here covers them all. Pausing is idempotent, so
    // re-opening the modal cannot restart the lesson clip.
    useEffect(() => {
        if (!view.isSupported) return undefined;
        console.log('[TutorialModal] opened for stepType:', view.stepType, 'lang:', view.subtitleLang);
        pauseLessonVideoForTutorial();
        return () => console.log('[TutorialModal] closed for stepType:', view.stepType);
    }, [view.isSupported, view.stepType, view.subtitleLang]);

    // Escape-to-close, mirroring the HomeScreen menu pattern (window keydown
    // listener with cleanup).
    useEffect(() => {
        function onKeyDown(e) {
            if (e.key === 'Escape') handlers.close();
        }
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [handlers]);

    const stopPropagation = useCallback((e) => e.stopPropagation(), []);

    if (!view.isSupported) return null;

    return (
        <div
            className="tutorial-modal-overlay"
            id="tutorial-modal-overlay"
            role="dialog"
            aria-modal="true"
            onClick={handlers.handleOverlayClick}
        >
            <div className="tutorial-modal-content" onClick={stopPropagation}>
                <button
                    type="button"
                    className="btn tutorial-modal-close"
                    id="tutorialCloseBtn"
                    aria-label="Close"
                    onClick={handlers.close}
                >
                    <i className="bi bi-x-lg"></i>
                </button>

                <div className="tutorial-modal-video-wrap">
                    <video
                        className="tutorial-modal-video"
                        id="tutorialVideo"
                        src={view.videoUrl}
                        controls
                        playsInline
                        preload="metadata"
                        aria-label={`Tutorial for ${view.stepType}`}
                    />
                    <div className="ivp-subtitle-scroll-container tutorial-modal-subtitles">
                        <div className="ivp-subtitles tutorial-modal-subtitle-text" lang={view.subtitleLang}>
                            {view.subtitleText}
                        </div>
                    </div>
                </div>

                <button
                    type="button"
                    className="btn call-btn btn-row-primary tutorial-modal-continue"
                    id="tutorialContinueBtn"
                    onClick={handlers.close}
                >
                    {continueLabel.localized ? (
                        <>
                            {continueLabel.english}
                            <br />
                            <span lang={continueLabel.lang}>{continueLabel.localized}</span>
                        </>
                    ) : (
                        continueLabel.english
                    )}
                </button>
            </div>
        </div>
    );
}
