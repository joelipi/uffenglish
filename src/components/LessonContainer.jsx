// js/components/LessonContainer.jsx

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useStore } from 'zustand';
import { appStore, getAnswerPipelineDeps } from '../modules/store/store.js';
import { getBilingual } from '../data/strings.js';
import { useInitializeLesson } from '../hooks/use-initialize-lesson-webonly.js';

import StepLoader from './StepLoader.jsx';
import MicrophoneToggle from './widgets/MicrophoneToggle.js';
import IntroChoices from './widgets/IntroChoices.jsx';
import SuccessScreen from './widgets/SuccessScreen.jsx';
import CriticalErrorModal from './modals/CriticalErrorModal.jsx';
import SystemMessageOverlay from './widgets/MicStatusText.jsx';
import DecisionButtons from './widgets/DecisionButtons.jsx';
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

// Replaced legacy wrapper with the direct React component
import InteractiveVideoPlayer from './InteractiveVideoPlayer'; 
import SimpleVideoPlayer from './SimpleVideoPlayer';

import IncomingVideoWidget from './IncomingVideoWidget.jsx';
import PointLossOverlay from './PointLossOverlay.jsx';
import PlaybackVideo from './PlaybackVideo.jsx';
import { loadNextStep as loadNextStepImpl, handleTutorChatSubmit } from '../modules/lesson/lesson-progression.js';
import { loadLessonContent } from '../modules/lesson/lesson-loader.js';
import { loadStep } from './step-loader.js';

export default function LessonContainer() {
    const { courseId, lessonId } = useParams();
    const configData = useStore(appStore, (state) => state.configData);
    const currentLessonIndex = useStore(appStore, (state) => state.currentLessonIndex);
    const currentStepIndex = useStore(appStore, (state) => state.currentStepIndex);
    const statsVisible = useStore(appStore, (state) => state.statsVisible);
    const mediaVisible = useStore(appStore, (state) => state.mediaVisible);
    const chatModeActive = useStore(appStore, (state) => state.chatModeActive);
    const textInputVisible = useStore(appStore, (state) => state.textInputVisible);
    const bottomOverlayVisible = useStore(appStore, (state) => state.bottomOverlayVisible);
    const bottomState = useStore(appStore, (state) => state.bottomState);
    const userData = useStore(appStore, (state) => state.userData);

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
        const stepDeps = getAnswerPipelineDeps();
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
            loadLessonContent(lesson, { forceRestart: true });
        }
    }, []);

    const currentStep = getCurrentStep();

    return (
        <>
            <SystemMessageOverlay />

            {/* Top Overlay */}
            <div className="top-overlay position-absolute top-0 start-0 w-100 px-3 py-2">
                <div className="w-100 text-shadow">
                    <div id="top-bar-primary" className="d-flex align-items-center w-100 mb-0">
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

            {/* Controls */}
            <div className="lesson-body">
                <CriticalErrorModal />
            </div>

            <Hints />
            <WebcamPreview />

            {/* Chat Window */}
            <div id="chat-window-container" className={`chat-window-container ${chatModeActive ? '' : 'chat-hidden'}`}>
                <ChatHeader />
                <ChatInterface />
                <TutorChatInput onSubmit={handleTutorChatSubmit} />
            </div>

            {/* Bottom Overlay */}
            <div className={`bottom-overlay position-absolute bottom-0 start-0 w-100 ${chatModeActive || !bottomOverlayVisible ? 'overlay-hidden' : 'overlay-visible'}${!bottomOverlayVisible ? ' overlay-hidden-instant' : ''}`}>
                <MissionSection responseType={currentStep?.responseType} />
                <div className="bottom-overlay-content">
                    <div className="controls-section">
                        <AnswerInput />
                        {!textInputVisible && (
                            <>
                            {bottomState === 'reviewButtons' && (() => {
                                const labelLang = userData?.native_language || 'en';
                                const reRecord = getBilingual('whisper_re_record', labelLang);
                                const acceptLabel = getBilingual('whisper_accept', labelLang);
                                return (
                                <div className="review-buttons-container d-flex justify-content-center gap-3 w-100">
                                    <div className="ivp-choice-col" style={{ flex: 1, minWidth: 0 }}>
                                        <div className="ivp-choice-label">
                                            <div className="ivp-choice-label-text">
                                                {reRecord.localized ? (
                                                    <React.Fragment>{reRecord.english}<br /><span lang={reRecord.lang}><i>{reRecord.localized}</i></span></React.Fragment>
                                                ) : reRecord.english}
                                            </div>
                                        </div>
                                        <button className="btn call-btn" onClick={() => {
                                            const reject = appStore.getState().phaseData?.onReject;
                                            appStore.getState().setWhisperReviewData(null);
                                            appStore.getState().setWhisperReviewTimeLeft(null);
                                            if (reject) reject();
                                        }}>
                                            <i className="bi bi-arrow-counterclockwise"></i>
                                        </button>
                                    </div>
                                    <div className="ivp-choice-col" style={{ flex: 1, minWidth: 0 }}>
                                        <div className="ivp-choice-label">
                                            <div className="ivp-choice-label-text">
                                                {acceptLabel.localized ? (
                                                    <React.Fragment>{acceptLabel.english}<br /><span lang={acceptLabel.lang}><i>{acceptLabel.localized}</i></span></React.Fragment>
                                                ) : acceptLabel.english}
                                            </div>
                                        </div>
                                        <button className="btn call-btn" onClick={() => {
                                            const accept = appStore.getState().phaseData?.onAccept;
                                            appStore.getState().setWhisperReviewData(null);
                                            appStore.getState().setWhisperReviewTimeLeft(null);
                                            if (accept) accept();
                                        }}>
                                            <i className="bi bi-check2"></i>
                                        </button>
                                    </div>
                                </div>
                                );
                            })()}
                            {bottomState === 'decisionButtons' && (
                                <DecisionButtons />
                            )}
                            {['controlIcon', 'introChoices', 'micActiveOrAnswerInput', 'lessonSuccess'].includes(bottomState) && (
                                <div className="d-flex justify-content-center align-items-center w-100">
                                    <MicrophoneToggle />
                                    <IntroChoices />
                                    <SuccessScreen onLoadNextLesson={onLoadNextLesson} onRepeat={handleRepeat} canvasRef={successCanvasRef} />
                                </div>
                            )}
                            </>
                        )}
                    </div>
                </div>
            </div>

            <StepLoader step={currentStep} lesson={lesson} />

            <WhisperReview />
            <MediaContent />
            <SuccessVideo />
            <SuccessVideoCanvas canvasRef={successCanvasRef} />
            <PlaybackVideo />

            {/* Media Viewport cleanly houses the pure React players now */}
            <div id="media-viewport" className={`position-absolute top-0 start-0 w-100 h-100${mediaVisible ? '' : ' media-viewport-hidden'}`}>
                <InteractiveVideoPlayer />
                <SimpleVideoPlayer />
            </div>

            <IncomingVideoWidget />
            <PointLossOverlay />
        </>
    );
}