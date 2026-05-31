import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useStore } from 'zustand';
import { appStore } from '../modules/store.js';
import { useInitializeLesson } from '../hooks/use-initialize-lesson-webonly.js';

import StepLoader from './StepLoader.jsx';
import MicrophoneToggle from './widgets/MicrophoneToggle.js';
import IntroChoices from './widgets/IntroChoices.jsx';
import SuccessScreen from './widgets/SuccessScreen.jsx';
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
import SuccessVideo from './widgets/SuccessVideo.jsx';
import SuccessVideoCanvas from './widgets/SuccessVideoCanvas.jsx';
import ScoreBoard from './widgets/ScoreBoard.jsx';
import ProgressBar from './widgets/ProgressBar.jsx';
import ActivityStats from './widgets/ActivityStats.jsx';
import ChatInterface from './chat/ChatInterface.jsx';
import ChatHeader from './chat/ChatHeader.jsx';
import TutorChatInput from './widgets/TutorChatInput.jsx';
import InteractiveVideoWrapper from './InteractiveVideoWrapper.jsx';
import SimpleVideoPlayer from './SimpleVideoPlayer.js';
import IncomingVideoWidget from './IncomingVideoWidget.jsx';
import PointLossOverlay from './PointLossOverlay.jsx';
import VideoProcessorWrapper from './VideoProcessorWrapper.jsx';
import PlaybackVideo from './PlaybackVideo.jsx';
import { loadNextStep as loadNextStepImpl, handleTutorChatSubmit } from '../modules/lesson-progression.js';
import { loadLessonContent } from '../modules/lesson-loader.js';
import { loadStep } from './step-loader.js';

export default function LessonContainer() {
    const { courseId, lessonId } = useParams();
    const configData = useStore(appStore, (state) => state.configData);
    const currentLessonIndex = useStore(appStore, (state) => state.currentLessonIndex);
    const currentStepIndex = useStore(appStore, (state) => state.currentStepIndex);
    const statsVisible = useStore(appStore, (state) => state.statsVisible);
    const mediaVisible = useStore(appStore, (state) => state.mediaVisible);
    const chatModeActive = useStore(appStore, (state) => state.chatModeActive);

    const [lesson, setLesson] = useState(null);

    const [searchParams] = useSearchParams();
    const forceRestart = searchParams.has('restart');
    const { initializeLesson } = useInitializeLesson({ forceRestart });
    const successCanvasRef = useRef(null);

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

    const navigate = useNavigate();
    const pendingNav = useStore(appStore, (state) => state.pendingLessonNavigation);

    useEffect(() => {
        if (pendingNav && courseId) {
            navigate(`/course/${courseId}/lesson/${pendingNav}`, { replace: true });
            appStore.setState({ pendingLessonNavigation: null });
        }
    }, [pendingNav, courseId, navigate]);

    const getCurrentStep = useCallback(() => {
        if (!configData?.lessons) return null;
        const currentLesson = configData.lessons[currentLessonIndex];
        if (!currentLesson?.steps) return null;
        return currentLesson.steps[currentStepIndex] || null;
    }, [configData, currentLessonIndex, currentStepIndex]);

    const onLoadNextLesson = useCallback(() => {
        const currentStep = getCurrentStep();
        if (!currentStep) return;
        const stepDeps = appStore.getState().answerPipelineDeps;
        if (!stepDeps) return;
        loadNextStepImpl(currentStep, null, {
            callLoadStep: (step, lesson, fluencyData) => {
                loadStep(step, lesson, fluencyData, stepDeps);
            },
            loadLessonContent
        });
    }, [getCurrentStep]);

    const handleRepeat = useCallback((repeatLessonId) => {
        appStore.getState().hideSuccessScreen();
        const configData = appStore.getState().configData;
        const lesson = configData?.lessons?.find(l => l.lessonId === repeatLessonId);
        if (lesson) {
            loadLessonContent(lesson);
        }
    }, []);

    const currentStep = getCurrentStep();

    return (
        <>
            <MicStatusText />

            {/* Top Overlay */}
            <div className="top-overlay position-absolute top-0 start-0 w-100 px-3 py-2 z-1">
                <div className="w-100 text-shadow">
                    <div className="d-flex align-items-center w-100 mb-0">
                        {/* TODO: Replace with proper home route when one exists */}
                        <Link to="/" id="closePage"
                            className="d-flex align-items-center text-decoration-none flex-shrink-0" aria-label="Close">
                            <i className="bi bi-x-lg"></i>
                        </Link>
                        <div className="flex-grow-1 ms-3">
                            <div className="progress progress-xs shadow-sm">
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
            <div id="chat-window-container" className={`chat-window-container ${chatModeActive ? '' : 'd-none'}`}>
                <ChatHeader />
                <ChatInterface />
                <TutorChatInput onSubmit={handleTutorChatSubmit} />
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
                            <SuccessScreen onLoadNextLesson={onLoadNextLesson} onRepeat={handleRepeat} canvasRef={successCanvasRef} />
                        </div>
                    </div>
                </div>
            </div>

            <StepLoader step={currentStep} lesson={lesson} />

            <WhisperReview />
            <MediaContent />
            <SuccessVideo />
            <SuccessVideoCanvas canvasRef={successCanvasRef} />
            <PlaybackVideo />
            <div id="media-viewport" className={`position-absolute top-0 start-0 w-100 h-100${mediaVisible ? '' : ' media-viewport-hidden'}`}>
                <div id="ivp-container"></div>
                <div id="simple-video-container"></div>
                <InteractiveVideoWrapper />
            </div>
            <SimpleVideoPlayer />
            <IncomingVideoWidget />
            <PointLossOverlay />
            <VideoProcessorWrapper />
        </>
    );
}
