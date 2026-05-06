// --- modules/video-processor-web.js ---
import { getAllSpeechRecordingsForLesson } from './storage-web.js';
import { VideoRenderPlanner } from './video-processor-logic.js';

let currentProcessorInstance = null;

export function initVideoProcessor(externalPromptText, fluencyData = {}, lessonId = null) {
    // Kill any previously running instance to prevent ghost render loops
    if (currentProcessorInstance) {
        currentProcessorInstance.cleanup();
    }

    window.__currentProcessingLessonId = lessonId;

    // Prefer explicitly passed configData over globals
    const configData = typeof State !== 'undefined'
        ? State.configData
        : window.__currentConfigData;

    // UI Setup
    document.getElementById('bottomButtonBar').classList.add('d-none');
    document.getElementById('bottomButtonBarSuccess').classList.remove('d-none');

    const originalVideo = document.getElementById('originalVideo');
    const processBtn = document.getElementById('processBtn');
    const videoCanvas = document.getElementById('videoCanvas');
    const displayCanvas = document.getElementById('displayCanvas') || createDisplayCanvas();
    const overlayImage = document.getElementById('overlayImage');

    let animationId = null;
    let audioContext = null;
    let recorder = null;

    function createDisplayCanvas() {
        const c = document.createElement('canvas');
        c.id = 'displayCanvas';
        c.style.cssText = 'width:100%; max-width:400px; height:auto; margin:10px auto; display:none; background:#000;';
        const container = document.getElementById('playback-video-mobile-container') || document.body;
        container.appendChild(c);
        return c;
    }

    // --- Rendering Engine ---
    // The user watches this as a lesson review — effective processing time is zero
    // because the render loop IS the playback.
    function executeRenderPlan(plan, canvasCtx, displayCtx) {
        return new Promise((resolve, reject) => {
            let currentPlanIndex = 0;
            let stepStartMs = 0;
            let lastFrameCanvas = null;

            // crossOrigin must be set once before any src is assigned
            originalVideo.crossOrigin = 'anonymous';

            const stream = videoCanvas.captureStream(30);
            // TODO: wire AudioContext destination into stream for audio track

            recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
            const chunks = [];
            recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
            recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
            recorder.start();

            async function loadStep(index) {
                if (index >= plan.length) {
                    recorder.stop();
                    cancelAnimationFrame(animationId);
                    return;
                }

                const step = plan[index];
                stepStartMs = performance.now();

                if (step.type === 'tailing') {
                    // Freeze the last rendered video frame
                    lastFrameCanvas = document.createElement('canvas');
                    lastFrameCanvas.width = videoCanvas.width;
                    lastFrameCanvas.height = videoCanvas.height;
                    lastFrameCanvas.getContext('2d').drawImage(
                        originalVideo, 0, 0, videoCanvas.width, videoCanvas.height
                    );
                    return;
                }

                if (step.type === 'remote') {
                    const cached = window.preloadedMedia?.[step.targetId];
                    originalVideo.src = cached ||
                        `https://firebasestorage.googleapis.com/v0/b/cogdexapptest.appspot.com/o/videos%2F${step.targetId}.mp4?alt=media`;
                } else if (step.type === 'webcam') {
                    originalVideo.src = URL.createObjectURL(step.blob);
                }

                await new Promise(r => {
                    originalVideo.onloadedmetadata = r;
                    originalVideo.load();
                });

                if (step.trim?.start > 0) originalVideo.currentTime = step.trim.start;
                await originalVideo.play();
            }

            function drawLoop() {
                const step = plan[currentPlanIndex];

                if (step.type === 'tailing') {
                    if (performance.now() - stepStartMs >= step.durationMs) {
                        loadStep(++currentPlanIndex);
                        return;
                    }
                } else {
                    const hitTrimEnd = step.trim && originalVideo.currentTime >= step.trim.end;
                    if (originalVideo.ended || hitTrimEnd) {
                        loadStep(++currentPlanIndex);
                    }
                }

                // Draw background
                if (step.type === 'tailing' && lastFrameCanvas) {
                    canvasCtx.drawImage(lastFrameCanvas, 0, 0);
                } else if (originalVideo.readyState >= 2) {
                    canvasCtx.drawImage(originalVideo, 0, 0, videoCanvas.width, videoCanvas.height);
                }

                // Draw overlay image if present
                if (overlayImage?.complete && overlayImage.naturalWidth > 0) canvasCtx.drawImage(overlayImage, 0, 0);

                // Mirror to display canvas so user sees the render in real time
                displayCtx.drawImage(videoCanvas, 0, 0, displayCanvas.width, displayCanvas.height);

                // TODO: drawTextOverlay(canvasCtx, step.subtitle, step.type === 'tailing', fluencyData)

                animationId = requestAnimationFrame(drawLoop);
            }

            // Bootstrap — use an immediately invoked async to cleanly catch load errors
            loadStep(0)
                .then(() => drawLoop())
                .catch(reject);
        });
    }

    async function processVideo() {
        processBtn.disabled = true;
        displayCanvas.style.display = 'block';

        try {
            const recordings = await getAllSpeechRecordingsForLesson(
                window.__currentProcessingLessonId
            );

            const planner = new VideoRenderPlanner(recordings, configData, fluencyData);
            const renderPlan = planner.generatePlan();

            const canvasCtx = videoCanvas.getContext('2d');
            const displayCtx = displayCanvas.getContext('2d');

            const finalBlob = await executeRenderPlan(renderPlan, canvasCtx, displayCtx);

            // TODO: pass finalBlob to share/download UI
            console.log('Render complete', finalBlob);

        } catch (e) {
            console.error('[VideoProcessor] Render failed:', e);
            processBtn.disabled = false;
        }
    }

    if (processBtn) processBtn.addEventListener('click', processVideo, { once: true });

    currentProcessorInstance = {
        cleanup: () => {
            if (animationId) cancelAnimationFrame(animationId);
            if (recorder?.state !== 'inactive') recorder?.stop();
            audioContext?.close();
        }
    };

    return processVideo;
}