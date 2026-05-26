import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useStore } from 'zustand';
import { appStore } from '../modules/store.js';
import { useAnswerPipeline } from '../hooks/useAnswerPipeline.js';
import { useInitializeLesson } from '../hooks/useInitializeLesson.js';
import { useChatVisibilityEffects } from '../hooks/useChatVisibilityEffects.js';
import { useScoreUpdateEffects } from '../hooks/useScoreUpdateEffects.js';
import { useInputFocusEffects } from '../hooks/useInputFocusEffects.js';
import { usePlaybackEffects } from '../hooks/usePlaybackEffects.js';
import { usePointLossEffects } from '../hooks/usePointLossEffects.js';
import { useCompletionEffects } from '../hooks/useCompletionEffects.js';
import { useChatScoreSpanEffects } from '../hooks/useChatScoreSpanEffects.js';
import StepLoader from './StepLoader.jsx';
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
import WebcamPreview from './widgets/WebcamPreview.jsx';
import ScoreBoard from './widgets/ScoreBoard.jsx';
import ProgressBar from './widgets/ProgressBar.jsx';
import ActivityStats from './widgets/ActivityStats.jsx';
import ChatInterface from './chat/ChatInterface.jsx';
import ChatHeader from './chat/ChatHeader.jsx';
import TutorChatInput from './widgets/TutorChatInput.jsx';
import InteractiveVideoWrapper from './InteractiveVideoWrapper.jsx';
import SimpleVideoWrapper from './SimpleVideoWrapper.jsx';
import IntroVideoWrapper from './IntroVideoWrapper.jsx';
import VideoProcessorWrapper from './VideoProcessorWrapper.jsx';
import { handleAuthClick } from '../modules/lesson-init.js';

export default function LessonContainer() {
    const { courseId, lessonId } = useParams();
    const configData = useStore(appStore, (state) => state.configData);
    const currentLessonIndex = useStore(appStore, (state) => state.currentLessonIndex);
    const currentStepIndex = useStore(appStore, (state) => state.currentStepIndex);
    const successHandler = useStore(appStore, (state) => state.successHandler);
    const statsVisible = useStore(appStore, (state) => state.statsVisible);
    const chatModeActive = useStore(appStore, (state) => state.chatModeActive);

    const [lesson, setLesson] = useState(null);

    const answerPipeline = useAnswerPipeline();
    const { submitAnswerPrecheck, showFeedbackAndProceed, handleHint } = answerPipeline;
    const { initializeLesson, setStepLoaderDeps } = useInitializeLesson();

    useEffect(() => {
        setStepLoaderDeps({ submitAnswerPrecheck, showFeedbackAndProceed, handleHint });
    }, [submitAnswerPrecheck, showFeedbackAndProceed, handleHint, setStepLoaderDeps]);

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

    const getCurrentStep = useCallback(() => {
        if (!configData?.lessons) return null;
        const currentLesson = configData.lessons[currentLessonIndex];
        if (!currentLesson?.steps) return null;
        return currentLesson.steps[currentStepIndex] || null;
    }, [configData, currentLessonIndex, currentStepIndex]);

    const currentStep = getCurrentStep();

    useChatVisibilityEffects();
    useScoreUpdateEffects();
    useInputFocusEffects();
    usePlaybackEffects();
    usePointLossEffects();
    useCompletionEffects();
    useChatScoreSpanEffects();

    return (
        <>
            <MicStatusText />

            {/* Top Overlay */}
            <div className="top-overlay position-absolute top-0 start-0 w-100 px-3 py-2 z-1">
                <div className="w-100 text-shadow">
                    <div className="d-flex align-items-center w-100 mb-0">
                        <a href="homescreen.html" id="closePage"
                            className="d-flex align-items-center text-decoration-none flex-shrink-0" aria-label="Close">
                            <i className="bi bi-x-lg"></i>
                        </a>
                        <div className="flex-grow-1 ms-3">
                            <div className="progress shadow-sm" style={{ height: '8px' }}>
                                <ProgressBar />
                            </div>
                        </div>
                        <div className="ms-2">
                            <ActivityStats />
                        </div>
                    </div>
                    {statsVisible && (
                        <ScoreBoard />
                    )}
                </div>
            </div>

            {/* Answer Input Area */}
            <AnswerInput />

            {/* Controls */}
            <div className="lesson-body">
                <MicrophoneToggle />
                <LessonSuccessControls successHandler={successHandler} />
                <CriticalErrorModal />
                <GuestLoginModal />
                <AuthLink onAuthClick={handleAuthClick} />
            </div>

            <MissionSection />
            <IntroChoices />
            <Hints />
            <WebcamPreview />

            {/* Chat Window */}
            <div id="chat-window-container" className={chatModeActive ? '' : 'd-none'} style={chatModeActive ? { display: 'flex', flexDirection: 'column' } : {}}>
                <ChatHeader />
                <ChatInterface />
                <TutorChatInput />
            </div>

            {/* Bottom Overlay */}
            <div className="bottom-overlay position-absolute bottom-0 start-0 w-100 d-flex flex-column">
                <div className="reflecting-pool-bg"></div>
                <div className="bottom-overlay-content">
                    <div className="controls-section">
                        <div className="d-flex justify-content-between align-items-center w-100"></div>
                    </div>
                </div>
            </div>

            <StepLoader step={currentStep} lesson={lesson} />

            <InteractiveVideoWrapper />
            <SimpleVideoWrapper />
            <IntroVideoWrapper />
            <VideoProcessorWrapper />
        </>
    );
}
