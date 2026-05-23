import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useParams } from 'react-router-dom';
import { useStore } from 'zustand';
import { appStore } from '../modules/store.js';
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
    const isLoaded = useStore(appStore, (state) => state.isLoaded);

    useEffect(() => {
        const preloader = document.getElementById('appLoadingImageDiv');
        if (isLoaded && preloader) preloader.style.display = 'none';
    }, [isLoaded]);

    useEffect(() => {
        if (courseId && lessonId) {
            console.log(`[Router] Route matched. Course: ${courseId}, Lesson: ${lessonId}`);

            appStore.getState().setCourseData({ courseId });
            appStore.setState({ activeLessonId: lessonId });

            window.dispatchEvent(new CustomEvent('hybridRouteChange', {
                detail: { courseId, lessonId }
            }));
        }
    }, [courseId, lessonId]);

    const micRootEl = document.getElementById('react-root-mic');
    const criticalErrorRootEl = document.getElementById('react-root-critical-error');

    return (
        <div className="react-lesson-shell">
            <Header />
            <StatsBar />

            <div className="lesson-body">
                {micRootEl && createPortal(<>
                    <MicrophoneToggle />
                    <IntroChoices />
                    <LessonSuccessControls />
                </>, micRootEl)}
                {criticalErrorRootEl && createPortal(<CriticalErrorModal />, criticalErrorRootEl)}
                {createPortal(<GuestLoginModal />, document.body)}
            </div>

            <AuthLink />
            <MissionSection />
            <MicStatusText />
            <Hints />
            <AnswerInput />
            <TutorChatInput />
            <MediaViewport />
            <WebcamPreview />

            <ChatContainer />

            {/* Video player wrappers — subscribe to Zustand store
                 and mount/destroy the vanilla player classes. */}
            <InteractiveVideoWrapper />
            <SimpleVideoWrapper />
            <IntroVideoWrapper />
            <VideoProcessorWrapper />
        </div>
    );
}
