// js/components/LessonContainer.jsx

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useStore } from 'zustand';
import { appStore, getAnswerPipelineDeps } from '../modules/store/store.js';
import { getBilingual } from '../data/strings.js';
import { useInitializeLesson } from '../hooks/use-initialize-lesson-webonly.js';
import { useNativeLanguage } from '../hooks/use-native-language.js';

import StepLoader from './StepLoader.jsx';
import MicrophoneToggle from './widgets/MicrophoneToggle.js';
import IntroChoices from './widgets/IntroChoices.jsx';
import SuccessScreen from './widgets/SuccessScreen.jsx';
import CriticalErrorModal from './modals/CriticalErrorModal.jsx';
import SystemMessageOverlay from './widgets/MicStatusText.jsx';
import LandscapeWarning from './widgets/LandscapeWarning';
import DecisionButtons from './widgets/DecisionButtons.jsx';
import ViewAndContinueButtons from './widgets/ViewAndContinueButtons.jsx';
import ResponseDecisionButtons from './widgets/ResponseDecisionButtons.jsx';
import BranchChoiceButtons from './widgets/BranchChoiceButtons.jsx';
import AuthLink from './widgets/AuthLink.jsx';
import MissionSection from './widgets/MissionSection.jsx';
import Hints from './widgets/Hints.jsx';
import AnswerInput from './widgets/AnswerInput.jsx';
import WebcamPreview from './widgets/WebcamPreview.jsx';
import PreviewTutorialButton from './widgets/PreviewTutorialButton.jsx';
import WhisperReview from './widgets/WhisperReview.jsx';
import MediaContent from './widgets/MediaContent.jsx';
import SuccessVideo from './widgets/SuccessVideo.jsx';
import WaveformCanvas from './widgets/WaveformCanvas.jsx';
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
import StepCelebration from './widgets/StepCelebration.jsx';
import TakeDiagnosticsOverlay from './widgets/TakeDiagnosticsOverlay.jsx';
import PlaybackVideo from './PlaybackVideo.jsx';
import { loadNextStep as loadNextStepImpl, jumpToStep as jumpToStepImpl, replaySimpleVideo, handleTutorChatSubmit } from '../modules/lesson/lesson-progression.js';
import { buildBranchChoiceView, isBranchingStep, resolveBranchLevel, getBranchHeadingKey } from '../modules/lesson/branch-choice-logic.js';
import { isVideoHeaderBlurVisible, videoHeaderBlurStyle } from '../modules/video/video-header-logic.js';
import { isPreviewGateStep } from '../modules/looks/recording-looks-logic.js';
import { loadLessonContent } from '../modules/lesson/lesson-loader.js';
import { loadStep } from './step-loader.js';
import { isNotFoundError } from '../modules/lesson/lesson-not-found-logic.js';
import NotFoundPage from './NotFoundPage.jsx';

export default function LessonContainer() {
    const { courseId, lessonId } = useParams();
    const configData = useStore(appStore, (state) => state.configData);
    const currentLessonIndex = useStore(appStore, (state) => state.currentLessonIndex);
    const currentStepIndex = useStore(appStore, (state) => state.currentStepIndex);
    const currentVideo = useStore(appStore, (state) => state.currentVideo);
    const topState = useStore(appStore, (state) => state.topState);
    const mediaVisible = useStore(appStore, (state) => state.mediaVisible);
    const mediaState = useStore(appStore, (state) => state.mediaState);
    const textInputVisible = useStore(appStore, (state) => state.textInputVisible);
    const bottomOverlayVisible = useStore(appStore, (state) => state.bottomOverlayVisible);
    const bottomState = useStore(appStore, (state) => state.bottomState);
    const awaitingRecordingStart = useStore(appStore, (state) => state.awaitingRecordingStart);
    const labelLang = useNativeLanguage();

    // Branching choice depth: an array of sibling keys, one per group entered.
    // Reset whenever the lesson moves to a different step so a fresh row of
    // buttons always starts at the first level. Kept here (not in the
    // presentational row) because the overlay headline in SimpleVideoPlayer
    // needs the depth too.
    const [branchPath, setBranchPath] = useState([]);
    useEffect(() => {
        setBranchPath((prev) => (prev.length === 0 ? prev : []));
    }, [currentStepIndex, currentLessonIndex]);

    const [lesson, setLesson] = useState(null);
    // A lesson id that is gone from the course is a dead link: the route
    // answers it with the app's not-found page, not the critical-error
    // screen that blames the visitor's connection.
    const [notFound, setNotFound] = useState(false);

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
                    } else if (isNotFoundError(result?.error)) {
                        setNotFound(true);
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

    const buildStepDeps = useCallback(() => {
        const stepDeps = getAnswerPipelineDeps();
        if (!stepDeps) return null;
        return {
            callLoadStep: (step, lesson, fluencyData) => {
                loadStep(step, lesson, fluencyData, stepDeps);
            },
            loadLessonContent
        };
    }, []);

    const onLoadNextLesson = useCallback(() => {
        // Terminal lesson (no onward lesson in the chain): the final Continue
        // button on the success screen has nowhere to advance to, so send the
        // learner to the courses page instead of leaving them stranded.
        const currentLesson = configData?.lessons?.[currentLessonIndex];
        // Only a loaded lesson that explicitly has no onward lesson is terminal.
        // (A missing lesson/config must not be treated as terminal.)
        if (currentLesson && currentLesson.nextLessonId == null) {
            navigate('/courses');
            return;
        }
        const currentStep = getCurrentStep();
        if (!currentStep) return;
        const stepDeps = buildStepDeps();
        if (!stepDeps) return;
        loadNextStepImpl(currentStep, null, stepDeps);
    }, [configData, currentLessonIndex, getCurrentStep, buildStepDeps, navigate]);

    // Branching: derive the render-ready view in the pure module, then delegate
    // the actions. No offset math or label choice happens in this file.
    const handleBranchChoose = useCallback((targetIndex) => {
        const stepDeps = buildStepDeps();
        if (!stepDeps) return;
        jumpToStepImpl(targetIndex, stepDeps);
    }, [buildStepDeps]);

    // Enter a nested group: extend the path so resolveBranchLevel reveals it.
    const handleBranchChooseGroup = useCallback((key) => {
        setBranchPath((prev) => [...prev, key]);
    }, []);

    // Back out of a nested group (never changes currentStepIndex).
    const handleBranchBack = useCallback(() => {
        setBranchPath((prev) => prev.slice(0, -1));
    }, []);

    // Replay restarts the clip, so the buttons must restart at the first level.
    const handleBranchReplay = useCallback(() => {
        setBranchPath((prev) => (prev.length === 0 ? prev : []));
        replaySimpleVideo();
    }, []);

    const handleRepeat = useCallback((repeatLessonId) => {
        appStore.getState().hideSuccessScreen();
        const configData = appStore.getState().configData;
        const lesson = configData?.lessons?.find(l => l.lessonId === repeatLessonId);
        if (lesson) {
            loadLessonContent(lesson, { forceRestart: true });
        }
    }, []);

    const currentStep = getCurrentStep();

    const branchStepCount = configData?.lessons?.[currentLessonIndex]?.steps?.length || 0;
    const branchView = useMemo(
        () => buildBranchChoiceView({
            step: currentStep,
            currentStepIndex,
            stepCount: branchStepCount,
            lang: labelLang,
        }),
        [currentStep, currentStepIndex, branchStepCount, labelLang]
    );

    // The visible level for the chosen path (root at depth 0). Pure module
    // walks the tree; this file only supplies the path.
    const branchLevelView = useMemo(
        () => resolveBranchLevel(branchView, branchPath),
        [branchView, branchPath]
    );

    // Heading for a branching step is derived from the nesting depth; computed
    // here (not inline in JSX) per the logic/presentation separation rule.
    const branchHeading = isBranchingStep(currentStep)
        ? getBilingual(getBranchHeadingKey(branchPath.length), labelLang)
        : null;

    // The recording-preview screen is a friendClosedResponse step paused before
    // its take (the look rail is open). It shows the tutorial as the right-hand
    // column of the bottom control row, exactly like every decision row.
    const showPreviewTutorial = awaitingRecordingStart && isPreviewGateStep(currentStep);

    // The transcript review box sits flush with the BOTTOM of the top overlay
    // (progress bar + mission). That bar's height depends on the step and the
    // language, so it is measured rather than assumed: a fixed offset either
    // overlapped the progress bar or left a gap.
    const topOverlayRef = useRef(null);
    const [topOverlayHeightPx, setTopOverlayHeightPx] = useState(0);
    useEffect(() => {
        const el = topOverlayRef.current;
        if (!el || typeof ResizeObserver !== 'function') return undefined;
        const measure = () => setTopOverlayHeightPx(el.getBoundingClientRect().height);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, [currentStep, currentStepIndex, mediaState, labelLang]);

    // A dead link (the lesson is gone from the course) answers with the app's
    // not-found page: the copy says the link may no longer be active and the
    // buttons lead to the course list and home. The critical-error screen is
    // reserved for technical failures.
    if (notFound) {
        return <NotFoundPage lang={labelLang} />;
    }

    return (
        <>
            <SystemMessageOverlay />
            <LandscapeWarning />

            {/* Blurred band: full burned-header height on branching steps,
                compact (progress row + mission only) everywhere else */}
            {isVideoHeaderBlurVisible(mediaState, bottomState) && (
                <div className="video-header-blur" aria-hidden="true" style={videoHeaderBlurStyle({ full: isBranchingStep(currentStep) })}></div>
            )}

            {/* Top Overlay */}
            <div ref={topOverlayRef} className="top-overlay position-absolute top-0 start-0 w-100 px-3 py-2">
                <div className="w-100 text-shadow">
                    <div id="top-bar-primary" className="d-flex align-items-center w-100 mb-0">
                        <Link to="/home" id="closePage"
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
                    <MissionSection responseType={currentStep?.responseType} />
                    {branchHeading && (
                        <div className="branch-choice-heading">
                            {branchHeading.localized ? (
                                <>{branchHeading.english}<br /><span lang={branchHeading.lang}>{branchHeading.localized}</span></>
                            ) : branchHeading.english}
                        </div>
                    )}
                    {topState === 'topBarWithStats' && mediaState !== 'chat' && (
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
            <div id="chat-window-container" className={`chat-window-container ${mediaState === 'chat' ? '' : 'chat-hidden'}`}>
                <ChatHeader />
                <ChatInterface />
                <TutorChatInput onSubmit={handleTutorChatSubmit} />
            </div>

            {/* Bottom Overlay */}
            <div className={`bottom-overlay position-absolute bottom-0 start-0 w-100 ${mediaState === 'chat' || !bottomOverlayVisible ? 'overlay-hidden' : 'overlay-visible'}${!bottomOverlayVisible ? ' overlay-hidden-instant' : ''}`}>
                <div className="bottom-overlay-content">
                    <div className="controls-section">
                        <AnswerInput />
                        {!textInputVisible && (
                            <>
                            {bottomState === 'reviewButtons' && (() => {
                                const reRecord = getBilingual('whisper_re_record', labelLang);
                                const acceptLabel = getBilingual('whisper_accept', labelLang);
                                return (
                                <div className="review-buttons-container d-flex justify-content-center gap-3 w-100">
                                    <div className="ivp-choice-col" style={{ flex: 1, minWidth: 0 }}>
                                        <div className="ivp-choice-label">
                                            <div className="ivp-choice-label-text">
                                                {reRecord.localized ? (
                                                    <React.Fragment>{reRecord.english}<br /><span lang={reRecord.lang}>{reRecord.localized}</span></React.Fragment>
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
                                                    <React.Fragment>{acceptLabel.english}<br /><span lang={acceptLabel.lang}>{acceptLabel.localized}</span></React.Fragment>
                                                ) : acceptLabel.english}
                                            </div>
                                        </div>
                                        <button className="btn call-btn btn-row-primary" onClick={() => {
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
                            {bottomState === 'presentDecisionButtons' && (
                                <div className="d-flex justify-content-center align-items-center w-100">
                                    <ViewAndContinueButtons />
                                </div>
                            )}
                            {bottomState === 'responseDecisionButtons' && (
                                <div className="d-flex justify-content-center align-items-center w-100">
                                    <ResponseDecisionButtons />
                                </div>
                            )}
                            {bottomState === 'branchChoices' && (
                                <div className="d-flex justify-content-center align-items-center w-100">
                                    <BranchChoiceButtons
                                        view={branchLevelView}
                                        onChoose={handleBranchChoose}
                                        onChooseGroup={handleBranchChooseGroup}
                                        onBack={handleBranchBack}
                                        onReplay={handleBranchReplay}
                                        onContinue={onLoadNextLesson}
                                        showReplay={!!currentVideo?.url}
                                    />
                                </div>
                            )}
                            {['controlIcon', 'introChoices', 'micActiveOrAnswerInput', 'lessonSuccess'].includes(bottomState) && (
                                <div className={`d-flex ${showPreviewTutorial ? 'justify-content-around align-items-end' : 'justify-content-center align-items-center'} w-100`}>
                                    {showPreviewTutorial && (
                                        <div className="ivp-choice-col" style={{ flex: 1, minWidth: 0 }} aria-hidden="true" />
                                    )}
                                    <MicrophoneToggle />
                                    {showPreviewTutorial && <PreviewTutorialButton />}
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

            <WhisperReview topOffsetPx={topOverlayHeightPx} />
            <MediaContent />
            <SuccessVideo />
            <SuccessVideoCanvas canvasRef={successCanvasRef} />
            <PlaybackVideo />
            {mediaState === 'processingRecording' && <WaveformCanvas />}

            {/* Media Viewport cleanly houses the pure React players now */}
            <div id="media-viewport" className={`position-absolute top-0 start-0 w-100 h-100${mediaVisible ? '' : ' media-viewport-hidden'}`} style={mediaState === 'processingRecording' || mediaState === 'preflightRejected' || mediaState === 'hidden' || mediaState === 'preloader' ? { display: 'none' } : undefined}>
                <InteractiveVideoPlayer />
                <SimpleVideoPlayer branchDepth={branchPath.length} />
            </div>

            <IncomingVideoWidget />
            <PointLossOverlay />
            <StepCelebration />
            <TakeDiagnosticsOverlay />
        </>
    );
}