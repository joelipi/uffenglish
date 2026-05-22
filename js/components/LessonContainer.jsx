import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useParams } from 'react-router-dom';
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
import Hints from './widgets/Hints.jsx';
import InteractiveVideoWrapper from './InteractiveVideoWrapper.jsx';
import SimpleVideoWrapper from './SimpleVideoWrapper.jsx';
import IntroVideoWrapper from './IntroVideoWrapper.jsx';
import VideoProcessorWrapper from './VideoProcessorWrapper.jsx';

export default function LessonContainer() {
    const { courseId, lessonId } = useParams();

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

            <MicStatusText />
            <Hints />

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
