import React, { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';
import { State } from '../../modules/state.js';

export default function LessonSuccessControls() {
    const bottomControlState = useStore(appStore, (state) => state.bottomControlState);
    const configData = useStore(appStore, (state) => state.configData);
    const currentLessonIndex = useStore(appStore, (state) => state.currentLessonIndex);
    const lastSuccessFluencyData = useStore(appStore, (state) => state.lastSuccessFluencyData);
    const createVideoButtonRef = useRef(null);

    // Attach click handler when component mounts
    useEffect(() => {
        if (bottomControlState !== 'lessonSuccess') return;
        if (!createVideoButtonRef.current) return;

        const successHandler = State.successHandler;
        if (successHandler && typeof successHandler.createVideoButton === 'function') {
            console.log('[success] LessonSuccessControls mount', {
                bottomControlState,
                currentLessonIndex,
                currentStepCount: configData?.lessons?.[currentLessonIndex]?.steps?.length,
                fluencyScore: appStore.getState().fluencyScore
            });
            // Get the current step from the lesson data
            const currentLesson = configData?.lessons?.[currentLessonIndex];
            const currentStep = currentLesson?.steps?.[currentLesson.steps.length - 1]; // Last step is typically the success step
            
            if (currentStep) {
                const fluencyData = lastSuccessFluencyData || {
                    total: appStore.getState().fluencyScore || 0
                };
                console.log('[success] LessonSuccessControls invoking createVideoButton', { currentStep, fluencyData, lastSuccessFluencyData });
                successHandler.createVideoButton(currentStep, fluencyData).catch(console.error);
            } else {
                console.error('[LessonSuccessControls] Could not determine current step for video generation');
                successHandler.createVideoButton().catch(console.error);
            }
        }
    }, [bottomControlState, configData, currentLessonIndex, lastSuccessFluencyData]);

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
