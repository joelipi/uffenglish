import React, { useEffect, useRef } from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from './routes/router.js';
import { initLocalVoiceAI } from './modules/speech/speech.js';
import { idiomChecker } from './modules/utils/idiom-checker.js';
import { identifyUser } from './modules/utils/logrocket.js';

export default function App() {
    const isWorkerInitialized = useRef(false);
    const hasIdentifiedGuest = useRef(false);

    useEffect(() => {
        if (!hasIdentifiedGuest.current) {
            hasIdentifiedGuest.current = true;
            identifyUser({ auth_method: 'guest' });
        }
    }, []);

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
        <RouterProvider router={router} />
    );
}
