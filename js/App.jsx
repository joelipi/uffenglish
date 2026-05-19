import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { initLocalVoiceAI } from './modules/speech.js';
import { idiomChecker } from './modules/idiom-checker.js';

const ChatRoot = () => <></>;
const StatsRoot = () => <></>;

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

    return (
        <>
            {chatRootEl && createPortal(<ChatRoot />, chatRootEl)}
            {statsRootEl && createPortal(<StatsRoot />, statsRootEl)}
        </>
    );
}
