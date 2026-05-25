/**
 * LessonContainer — Main lesson orchestrator (React)
 *
 * Owns the full lesson lifecycle: initialization, step loading, and UI rendering.
 * Replaces the previous hybrid approach where React dispatched CustomEvents to app.js.
 *
 * All child components are proper React components — no createPortal, no getElementById.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useStore } from 'zustand';
import { appStore } from '../modules/store.js';
import { initUiEffects } from './ui-effects.js';
import { useAnswerPipeline } from '../hooks/useAnswerPipeline.js';
import { useStepLoader } from '../hooks/useStepLoader.js';
import { useInitializeLesson } from '../hooks/useInitializeLesson.js';
import StepLoader from './StepLoader.jsx';
import Header from './lesson/Header.jsx';
import ChatContainer from './lesson/ChatContainer.jsx';
import StatsBar from './lesson/StatsBar.jsx';
import MicrophoneToggle from './widgets/MicrophoneToggle.jsx';
import IntroChoices from './widgets/IntroChoices.jsx';
import LessonSuccessControls from './widgets/LessonSuccessControls.jsx';
import GuestLoginModal from './modals/GuestLoginModal.jsx';
import CriticalErrorModal from './modals/CriticalErrorModal.jsx';
import MicStatusText from './widgets/MicStatusText.jsx';
import AuthLink from './widgets/AuthLink.jsx';
import MissionSection from './widgets/MissionSection.jsx';
import Hints from './widgets/Hints.jsx';
import AnswerInput from './widgets/AnswerInput.jsx';
import TutorChatInput from './widgets/TutorChatInput.jsx';
import MediaViewport from './widgets/MediaViewport.jsx';
import WebcamPreview from './widgets/WebcamPreview.jsx';
import InteractiveVideoWrapper from './InteractiveVideoWrapper.jsx';
import SimpleVideoWrapper from './SimpleVideoWrapper.jsx';
import IntroVideoWrapper from './IntroVideoWrapper.jsx';
import VideoProcessorWrapper from './VideoProcessorWrapper.jsx';

export default function LessonContainer() {
    const { courseId, lessonId } = useParams();
    const configData = useStore(appStore, (state) => state.configData);
    const currentLessonIndex = useStore(appStore, (state) => state.currentLessonIndex);
    const currentStepIndex = useStore(appStore, (state) => state.currentStepIndex);
    const isLoaded = useStore(appStore, (state) => state.isLoaded);

    const [lesson, setLesson] = useState(null);

    // Initialize hooks
    const answerPipeline = useAnswerPipeline();
    const { submitAnswerPrecheck, showFeedbackAndProceed, handleHint, setCallLoadStep, setLoadNextStep } = answerPipeline;
    const { callLoadStep } = useStepLoader(submitAnswerPrecheck, showFeedbackAndProceed, handleHint, setCallLoadStep, setLoadNextStep);
    const { initializeLesson, setStepLoaderDeps } = useInitializeLesson();

    // Provide the answer pipeline deps to the lesson initializer so it can
    // call the vanilla step loader (step-loader.web.js) for the first step.
    useEffect(() => {
        setStepLoaderDeps({ submitAnswerPrecheck, showFeedbackAndProceed, handleHint });
    }, [submitAnswerPrecheck, showFeedbackAndProceed, handleHint, setStepLoaderDeps]);

    // Initialize web-only DOM side-effect subscriber once on mount
    useEffect(() => {
        initUiEffects();
    }, []);

    // Handle route changes — initialize lesson directly (no CustomEvent to app.js)
    useEffect(() => {
        if (courseId && lessonId && configData) {
            console.log(`[LessonContainer] Route matched. Course: ${courseId}, Lesson: ${lessonId}`);

            appStore.getState().setCourseData({ courseId });
            appStore.setState({ activeLessonId: lessonId });

            initializeLesson(courseId, lessonId, configData, appStore.getState().userData)
                .then(result => {
                    if (result.success) {
                        setLesson(result.lesson);
                        appStore.getState().setIsLoaded(true);
                    }
                });
        }
    }, [courseId, lessonId, configData, initializeLesson]);

    // Get current step from store state
    const getCurrentStep = useCallback(() => {
        if (!configData?.lessons) return null;
        const currentLesson = configData.lessons[currentLessonIndex];
        if (!currentLesson?.steps) return null;
        return currentLesson.steps[currentStepIndex] || null;
    }, [configData, currentLessonIndex, currentStepIndex]);

    const currentStep = getCurrentStep();

    return (
        <div className="react-lesson-shell">
            <Header />
            <StatsBar />

            <div className="lesson-body">
                <MicrophoneToggle />
                <LessonSuccessControls />
                <CriticalErrorModal />
                <GuestLoginModal />
            </div>

            <AuthLink />
            <MissionSection />
            <IntroChoices />
            <MicStatusText />
            <Hints />
            <AnswerInput />
            <TutorChatInput />
            <MediaViewport />
            <WebcamPreview />

            <ChatContainer />

            {/* Step content rendered declaratively based on stepType */}
            <StepLoader step={currentStep} lesson={lesson} />

            {/* Video player wrappers — subscribe to Zustand store
                 and mount/destroy the vanilla player classes. */}
            <InteractiveVideoWrapper />
            <SimpleVideoWrapper />
            <IntroVideoWrapper />
            <VideoProcessorWrapper />
        </div>
    );
}
