import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { initLocalVoiceAI } from './modules/speech.js';
import { idiomChecker } from './modules/idiom-checker.js';

import ScoreBoard from './components/widgets/ScoreBoard.jsx';
import ActivityStats from './components/widgets/ActivityStats.jsx';
import MicrophoneToggle from './components/widgets/MicrophoneToggle.jsx';
import GuestLoginModal from './components/modals/GuestLoginModal.jsx';
import CriticalErrorModal from './components/modals/CriticalErrorModal.jsx';
import ChatInterface from './components/chat/ChatInterface.jsx';
import LessonContainer from './components/LessonContainer.jsx';

export default function App() {
    const isWorkerInitialized = useRef(false);

    useEffect(() => {
        if (isWorkerInitialized.current) return;
        isWorkerInitialized.current = true;

        console.log('[React] Booting background AI workers...');
        (async () => {
            try {
                let voiceInitFn = initLocalVoiceAI;
                if (typeof voiceInitFn !== 'function') {
                    console.warn('initLocalVoiceAI not available statically, attempting dynamic import...');
                    const scriptDir = new URL('.', import.meta.url).href;
                    const speechModuleUrl = new URL('modules/speech.web.js', scriptDir).href;
                    const speechModule = await import(/* @vite-ignore */ speechModuleUrl);
                    voiceInitFn = speechModule.initLocalVoiceAI;
                }
                if (typeof voiceInitFn === 'function') {
                    await Promise.resolve(voiceInitFn());
                    console.log('  Whisper initialization complete.');
                }
            } catch (err) {
                console.error('Voice AI initialization error:', err);
            } finally {
                try {
                    console.log("  Local NLP bypassed. Now fetching and building idiom dictionary...");
                    await idiomChecker.init();
                    console.log("  Idiom checker ready!");
                } catch (err) {
                    console.error("  Failed to initialize idiom checker:", err);
                }
            }
        })();
    }, []);

    const chatRootEl = document.getElementById('react-root-chat');
    const statsRootEl = document.getElementById('react-root-stats');
    const activityRootEl = document.getElementById('react-root-activity');
    const micRootEl = document.getElementById('react-root-mic');
    const criticalErrorRootEl = document.getElementById('react-root-critical-error');

    return (
        <BrowserRouter>
            {/* The React Router Controller */}
            <Routes>
                <Route path="/course/:courseId/lesson/:lessonId" element={<LessonContainer />} />
                {/* Temporary fallback to catch empty URLs during testing */}
                <Route path="*" element={<Navigate to="/course/gt2/lesson/a" replace />} />
            </Routes>

            {/* The Portals injecting into the Vanilla index.html */}
            {chatRootEl && createPortal(<ChatInterface />, chatRootEl)}
            {statsRootEl && createPortal(<ScoreBoard />, statsRootEl)}
            {activityRootEl && createPortal(<ActivityStats />, activityRootEl)}
            {micRootEl && createPortal(<MicrophoneToggle />, micRootEl)}
            {criticalErrorRootEl && createPortal(<CriticalErrorModal />, criticalErrorRootEl)}
            {createPortal(<GuestLoginModal />, document.body)}
        </BrowserRouter>
    );
}