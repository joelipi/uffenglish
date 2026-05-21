import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useParams } from 'react-router-dom';
import { appStore } from '../modules/store.js';
import Header from './lesson/Header.jsx';
import ChatContainer from './lesson/ChatContainer.jsx';
import StatsBar from './lesson/StatsBar.jsx';
import MicrophoneToggle from './widgets/MicrophoneToggle.jsx';
import GuestLoginModal from './modals/GuestLoginModal.jsx';
import CriticalErrorModal from './modals/CriticalErrorModal.jsx';
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

    // Retain React ownership of existing hardcoded video containers via portals.
    // The vanilla step-loader still mounts players into these containers directly.
    // Phase 4 will migrate each to be fully React-controlled (vanilla class in wrapper).
    const portalTo = (id) => document.getElementById(id);

    return (
        <div className="react-lesson-shell">
            <Header />
            <StatsBar />

            <div className="lesson-body">
                {micRootEl && createPortal(<MicrophoneToggle />, micRootEl)}
                {criticalErrorRootEl && createPortal(<CriticalErrorModal />, criticalErrorRootEl)}
                {createPortal(<GuestLoginModal />, document.body)}

                {/* Video player mount points — React claims ownership of the containers.
                     The vanilla step-loader still creates players inside them for now.
                     Once Phase 4 wires them with Zustand, these will become active wrappers. */}
                {portalTo('ivp-container') && createPortal(
                    <div className="react-ivp-mount" data-owner="LessonContainer" />,
                    portalTo('ivp-container')
                )}
                {portalTo('simple-video-container') && createPortal(
                    <div className="react-svp-mount" data-owner="LessonContainer" />,
                    portalTo('simple-video-container')
                )}
                {portalTo('intro-call-widget') && createPortal(
                    <div className="react-intro-mount" data-owner="LessonContainer" />,
                    portalTo('intro-call-widget')
                )}
            </div>

            <ChatContainer />

            {/* Future: Active video player wrappers (wired in Phase 4) — inert until videoUrl/config set via Zustand */}
            <InteractiveVideoWrapper />
            <SimpleVideoWrapper />
            <IntroVideoWrapper />
            <VideoProcessorWrapper />
        </div>
    );
}
