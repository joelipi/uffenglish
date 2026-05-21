import React, { useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { initLocalVoiceAI } from './modules/speech.js';
import { idiomChecker } from './modules/idiom-checker.js';

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

    return (
        <BrowserRouter>
            <Routes>
                <Route path="/course/:courseId/lesson/:lessonId" element={<LessonContainer />} />
                <Route path="*" element={<Navigate to="/course/gt2/lesson/a" replace />} />
            </Routes>
        </BrowserRouter>
    );
}
