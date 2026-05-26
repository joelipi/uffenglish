import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useStore } from 'zustand';
import { appStore } from '../modules/store.js';
import { useAnswerPipeline } from '../hooks/useAnswerPipeline.js';
import { useInitializeLesson } from '../hooks/useInitializeLesson.js';

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
import WhisperReview from './widgets/WhisperReview.jsx';
import MediaContent from './widgets/MediaContent.jsx';
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
import PlaybackVideo from './PlaybackVideo.jsx';
import { useStepLoader } from '../hooks/useStepLoader.js';
import { loadNextStep as loadNextStepImpl } from '../modules/lesson-progression.js';

export default function LessonContainer() {
    const { courseId, lessonId } = useParams();
    const configData = useStore(appStore, (state) => state.configData);
    const currentLessonIndex = useStore(appStore, (state) => state.currentLessonIndex);
    const currentStepIndex = useStore(appStore, (state) => state.currentStepIndex);
    const successHandler = useStore(appStore, (state) => state.successHandler);
    const statsVisible = useStore(appStore, (state) => state.statsVisible);
    const mediaVisible = useStore(appStore, (state) => state.mediaVisible);
    const chatModeActive = useStore(appStore, (state) => state.chatModeActive);

    const [lesson, setLesson] = useState(null);

    const answerPipeline = useAnswerPipeline();
    const { submitAnswerPrecheck, showFeedbackAndProceed, handleHint } = answerPipeline;
    const { initializeLesson, setStepLoaderDeps } = useInitializeLesson();

    useEffect(() => {
        setStepLoaderDeps({ submitAnswerPrecheck, showFeedbackAndProceed, handleHint });
    }, [submitAnswerPrecheck, showFeedbackAndProceed, handleHint, setStepLoaderDeps]);

    const { loadStep } = useStepLoader();
    const { setCallLoadStep, setLoadNextStep } = answerPipeline;

    const callLoadStep = useCallback((step, lesson, fluencyData) => {
        loadStep(step, lesson, fluencyData, {
            submitAnswerPrecheck,
            showFeedbackAndProceed,
            handleHint
        });
    }, [loadStep, submitAnswerPrecheck, showFeedbackAndProceed, handleHint]);

    useEffect(() => {
        setCallLoadStep(callLoadStep);
    }, [callLoadStep, setCallLoadStep]);

    const loadNextStep = useCallback((currentStep, fluencyData) => {
        loadNextStepImpl(currentStep, fluencyData, { callLoadStep });
    }, [callLoadStep]);

    useEffect(() => {
        setLoadNextStep(loadNextStep);
    }, [loadNextStep, setLoadNextStep]);

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

    useEffect(() => {
        const mv = document.getElementById('media-viewport');
        if (mv) mv.classList.toggle('d-none', !mediaVisible);
    }, [mediaVisible]);

    const prevChatModeRef = useRef(chatModeActive);

    useEffect(() => {
        const active = chatModeActive;
        if (active === prevChatModeRef.current) return;
        prevChatModeRef.current = active;

        if (active) {
            document.body.classList.add('chat-mode-active');
        } else {
            document.body.classList.remove('chat-mode-active');
        }
    }, [chatModeActive]);

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
                    {statsVisible && !chatModeActive && (
                        <ScoreBoard />
                    )}
                </div>
            </div>

            {/* Answer Input Area */}
            <AnswerInput />

            {/* Controls */}
            <div className="lesson-body">
                <CriticalErrorModal />
                <GuestLoginModal />
            </div>

            <Hints />
            <WebcamPreview />

            {/* Chat Window */}
            <div id="chat-window-container" className={chatModeActive ? '' : 'd-none'} style={chatModeActive ? { position: 'absolute', top: 60, bottom: 80, left: 0, right: 0, display: 'flex', flexDirection: 'column' } : {}}>
                <ChatHeader />
                <ChatInterface />
                <TutorChatInput />
            </div>

            {/* Bottom Overlay */}
            <div className={`bottom-overlay position-absolute bottom-0 start-0 w-100${chatModeActive ? ' d-none' : ' d-flex flex-column'}`}>
                <MissionSection />
                {/* reflecting-pool-bg temporarily removed — was covering the mission section; reinstate when we can fix the stacking */}
                {/* <div className="reflecting-pool-bg"></div> */}
                <div className="bottom-overlay-content">
                    <div className="controls-section">
                        <div className="d-flex justify-content-center align-items-center w-100">
                            <MicrophoneToggle />
                            <IntroChoices />
                            <LessonSuccessControls successHandler={successHandler} />
                        </div>
                    </div>
                </div>
            </div>

            <StepLoader step={currentStep} lesson={lesson} />

            <WhisperReview />
            <MediaContent />
            <PlaybackVideo />
            <InteractiveVideoWrapper />
            <SimpleVideoWrapper />
            <IntroVideoWrapper />
            <VideoProcessorWrapper />
        </>
    );
}
