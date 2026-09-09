// modules/speech.js v2 - Lifecycle-managed worker
import * as mediaAdapter from './speech.web.js';
import { createWhisperAdapter } from '../../workers/whisper/app-vad-asr-web.js';
import { updateSpeechRecording } from '../storage/storage.js';
import { createSpeechOrchestrator } from './speech-orchestrator.js';
import { getIsPWAMode } from '../user/demo-mode-webonly.js';
import { appStore } from '../store/store.js';

const isPWAMode = getIsPWAMode();
console.warn(`[speech] PWA mode ${isPWAMode ? 'ACTIVE (Sherpa-ONNX full Whisper + VAD)' : 'OFF (Transformers.js tiny.en — default)'}`);

function createWhisperWorker() {
    const w = isPWAMode
        ? new Worker(new URL('../../workers/whisper/whisper-worker-web.js', import.meta.url))
        : new Worker(
            new URL('../../workers/whisper/whisper-worker-demo.js', import.meta.url),
            { type: 'module' },
        );
    w.onerror = (err) => {
        console.error(`[speech] Worker failed to load (${isPWAMode ? 'pwa' : 'default'}):`, err);
        try { import('../utils/posthog.js').then(m => m.captureException?.(err instanceof Error ? err : new Error(String(err)), { source: 'whisper-worker-onerror' })); } catch {}
    };
    return w;
}

let whisperWorker = createWhisperWorker();

const whisperAdapter = createWhisperAdapter({ worker: whisperWorker });

const { listeningState, initLocalVoiceAI, toggleSpeechRecognition } =
    createSpeechOrchestrator({
        ...mediaAdapter,
        ...whisperAdapter,
        updateSpeechRecording,
        getSpeechCamStream: () => mediaAdapter.speechCamStream,
    });

whisperAdapter.preloadWhisperEngine();

// ── Lifecycle: free WASM memory when the page is suspended ──────────────
// iOS Safari can suspend the page (via bfcache, page cache, or tab
// suspension) while the Web Worker holds ~100 MB of WASM/model data
// alive. pagehide fires before suspension regardless of the exact
// mechanism (reload, back/forward, tab switch, low-memory eviction),
// so terminating here works in all cases.
//
// Note: pagehide deliberately does NOT branch on event.persisted —
// termination should happen on ANY pagehide. Regular navigation tears
// down the page too, so the worker memory would leak either way.
// Only pageshow branches on event.persisted (recreation is only
// relevant for cache-restore).
if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => {
        console.warn('[speech] pagehide: releasing Whisper worker + media resources');
        try {
            if (typeof mediaAdapter.stopLocalAudioTap === 'function') {
                mediaAdapter.stopLocalAudioTap().catch(() => {});
            }
        } catch (e) {
            console.warn('[speech] stopLocalAudioTap during pagehide failed:', e);
        }
        try {
            if (typeof mediaAdapter.safelyStopStream === 'function' && mediaAdapter.speechCamStream) {
                mediaAdapter.safelyStopStream(mediaAdapter.speechCamStream);
            }
        } catch (e) {
            console.warn('[speech] safelyStopStream during pagehide failed:', e);
        }
        try {
            if (whisperAdapter && typeof whisperAdapter.terminate === 'function') {
                whisperAdapter.terminate();
            }
        } catch (e) {
            console.warn('[speech] terminate during pagehide failed:', e);
        }
    });

    // Restore from page cache (event.persisted=true) — recreate the
    // worker and reinitialize. The orchestrator's "wait for engine
    // ready" polling handles the brief gap.
    window.addEventListener('pageshow', (event) => {
        if (event.persisted) {
            console.warn('[speech] pageshow from page-cache: recreating Whisper worker');
            try {
                whisperWorker = createWhisperWorker();
                whisperAdapter.rebindWorker(whisperWorker);
                whisperAdapter.preloadWhisperEngine();
            } catch (e) {
                console.error('[speech] page-cache restore failed:', e);
                appStore.getState().setWhisperEngineFailed(true);
            }
        }
    });
}

export { listeningState, initLocalVoiceAI, toggleSpeechRecognition };
export * from './speech.web.js';
