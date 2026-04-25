// app-vad-asr.js v 457 pm
export let isEngineReady = false;
let whisperWorker = null;
let activeTranscriptionResolve = null;

export function preloadWhisperEngine() {
    // Return a promise that resolves when the worker sends 'ready'
    return new Promise((resolve, reject) => {
        if (whisperWorker) {
            // Already loading or loaded – check current state
            if (isEngineReady) {
                resolve();
            } else {
                // Wait for the existing worker to become ready
                const interval = setInterval(() => {
                    if (isEngineReady) {
                        clearInterval(interval);
                        resolve();
                    }
                }, 50);
            }
            return;
        }

        console.log("Starting Whisper Web Worker...");
        
        whisperWorker = new Worker(new URL('./whisper-worker.js?0', import.meta.url));

        whisperWorker.onmessage = function(e) {
            if (e.data.type === 'ready') {
                isEngineReady = true;
                window.whisperEngineReady = true;
                console.log("Main Thread: Whisper is locked and loaded in the background.");
                
                const preloader = document.getElementById('appLoadingImageDiv');
                if (preloader) preloader.style.display = 'none';
                
                resolve(); // 👈 Signal that Whisper is fully ready
            } 
            else if (e.data.type === 'result') {
                if (activeTranscriptionResolve) {
                    // UPDATED: Pass the entire object so speech.js can access avg_logprob
                    activeTranscriptionResolve(e.data);
                    activeTranscriptionResolve = null;
                }
            }
        };

        whisperWorker.onerror = (err) => {
            console.error("Whisper worker error:", err);
            reject(err);
        };
    });
}

export function transcribeAudioBuffer(float32Array) {
    return new Promise((resolve) => {
        if (!isEngineReady || !whisperWorker) {
            console.error("Engine not ready.");
            resolve(null);
            return;
        }

        activeTranscriptionResolve = resolve;
        
        // Send the raw audio to the background worker to compute
        // Use Transferable Objects to move memory without copying it which can cause memory crashes
        whisperWorker.postMessage({ 
            type: 'transcribe', 
            audio: float32Array 
        }, [float32Array.buffer]);
    });
}

// Stubs to prevent errors with your existing code
export async function startWhisperEngine(options) { return false; }
export function stopWhisperEngine() { }