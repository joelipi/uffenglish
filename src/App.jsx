import React, { useEffect, useRef } from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from './routes/router.js';
import { initLocalVoiceAI } from './modules/speech/speech.js';
import { idiomChecker } from './modules/utils/idiom-checker.js';
import { identifyUser } from './modules/utils/posthog.js';

export default function App() {
    const isWorkerInitialized = useRef(false);
    const hasIdentifiedGuest = useRef(false);

    useEffect(() => {
        // Load heavy CSS + analytics after first paint — not on the critical path.
        // Inline styles in index.html cover the preloader during the gap.
        import('./assets/css/app.css');
        import('bootstrap-icons/font/bootstrap-icons.css');
        import('./modules/utils/posthog-client.js').then(m => m.initPostHog());
    }, []);

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
            // Start idiom dictionary build immediately so it can run in parallel
            // with Whisper initialization. It now runs in a Web Worker, so it no
            // longer blocks the main thread or the first video from mounting.
            const idiomInitPromise = idiomChecker.init();

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
                    await idiomInitPromise;
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
