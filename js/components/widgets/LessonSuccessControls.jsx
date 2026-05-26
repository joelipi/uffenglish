import React, { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';

export default function LessonSuccessControls({ successHandler }) {
    const bottomControlState = useStore(appStore, (state) => state.bottomControlState);
    const configData = useStore(appStore, (state) => state.configData);
    const currentLessonIndex = useStore(appStore, (state) => state.currentLessonIndex);
    const lastSuccessFluencyData = useStore(appStore, (state) => state.lastSuccessFluencyData);
    const createVideoButtonRef = useRef(null);

    useEffect(() => {
        if (bottomControlState !== 'lessonSuccess') return;
        if (!createVideoButtonRef.current) return;
        if (!successHandler || typeof successHandler.createVideoButton !== 'function') return;

        const currentLesson = configData?.lessons?.[currentLessonIndex];
        const currentStep = currentLesson?.steps?.[currentLesson.steps.length - 1];

        if (currentStep) {
            const fluencyData = lastSuccessFluencyData || {
                total: appStore.getState().fluencyScore || 0
            };
            successHandler.createVideoButton(currentStep, fluencyData).catch(console.error);
        } else {
            console.error('[LessonSuccessControls] Could not determine current step for video generation');
            successHandler.createVideoButton().catch(console.error);
        }
    }, [bottomControlState, configData, currentLessonIndex, lastSuccessFluencyData, successHandler]);

    if (bottomControlState !== 'lessonSuccess') return null;

    return (
        <div className="d-flex gap-3 align-items-center" id="state-lesson-success">
            <button
                ref={createVideoButtonRef}
                className="btn btn-outline-primary w-100 text-white"
                id="createVideoButton"
                aria-label="Create Video"
            >
                <i className="bi bi-film text-white"></i>
            </button>
        </div>
    );
}
