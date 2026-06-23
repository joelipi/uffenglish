// modules/video-processor.web.js
// Web-only module — uses navigator.userAgent, window.preloadedMedia, MediaRecorder.
// React Native replaces this with video-processor.native.js.
import { getAllSpeechRecordingsForLesson } from '../storage/storage.js';
import { VideoRenderPlanner } from './video-processor-logic.js';
import { shareVideo } from './video-share.js';
import { appStore } from '../store/store.js';
import headerImg from '../../assets/img/header.png';
import { getVideoUrl } from './video-url.js';

export { shareVideo };

// ---------------------------------------------------------------------------
// Instance factory — each processVideo call owns its own context.
// No module-level mutable state. Safe under HMR, Strict Mode double-invoke,
// and concurrent calls (though the UI prevents those via button state).
// ---------------------------------------------------------------------------
function createVideoProcessor() {
    let animationId = null;
    let fontReady = false;
    let audioContext = null;
    let audioSource = null;
    let audioDestination = null;
    let currentAudioSource = null;

    // The hidden video element is created and destroyed entirely within this
    // instance. Nothing is queried from the DOM by ID.
    const originalVideo = document.createElement('video');
    originalVideo.crossOrigin = 'anonymous';
    originalVideo.playsInline = true;
    originalVideo.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.body.appendChild(originalVideo);

    function cleanup() {
        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }

        if (currentAudioSource) {
            try { currentAudioSource.stop(); } catch (e) { /* ignore */ }
            currentAudioSource = null;
        }

        if (audioContext) {
            if (audioContext.state !== 'closed') {
                audioContext.close().catch(e =>
                    console.warn('[VideoProcessor] Error closing AudioContext:', e)
                );
            }
            audioContext = null;
        }
        audioSource = null;
        audioDestination = null;

        originalVideo.pause();
        originalVideo.src = '';
        originalVideo.load();
        if (originalVideo.parentNode) {
            originalVideo.parentNode.removeChild(originalVideo);
        }
    }

    function initAudio() {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            audioDestination = audioContext.createMediaStreamDestination();
        }

        if (!audioSource || audioSource.mediaElement !== originalVideo) {
            if (audioSource) audioSource.disconnect();
            audioSource = audioContext.createMediaElementSource(originalVideo);
            audioSource.connect(audioDestination);
            audioSource.connect(audioContext.destination);
        }
    }

    async function ensureFontsReady() {
        if (fontReady || !document.fonts) return;
        try {
            await Promise.all([
                document.fonts.load('700 24px "Orbitron"'),
                document.fonts.load('bold 24px "Plus Jakarta Sans"'),
            ]);
            fontReady = true;
        } catch (e) {
            console.warn('[VideoProcessor] Font load failed:', e);
        }
    }

    async function process(fluencyData = {}, lessonId = null, displayCanvas = null) {
        return new Promise(async (resolve, reject) => {
            try {
                console.log('[VideoProcessor] Starting live processing on screen...');

                const recordings = await getAllSpeechRecordingsForLesson(lessonId) || [];
                console.log('[VideoProcessor] processVideo called', {
                    lessonId,
                    fluencyData,
                    recordingsLength: recordings.length,
                });

                if (!recordings.length) {
                    console.warn('[VideoProcessor] No recordings found. Proceeding with text-mode/summary generation.');
                }

                const videoCanvas = document.createElement('canvas');
                const overlayImage = new Image();
                overlayImage.src = headerImg;

                // Probe dimensions from the first real recording blob
                const firstValidRec = recordings.find(r => r.blob);
                if (firstValidRec) {
                    originalVideo.src = URL.createObjectURL(firstValidRec.blob);
                    await new Promise(res => {
                        originalVideo.onloadedmetadata = res;
                        setTimeout(res, 2000);
                    });
                }

                const configData = appStore.getState().configData || {};
                const userLang = appStore.getState().userData?.native_language;
                const planner = new VideoRenderPlanner(recordings, configData, fluencyData, userLang);
                const plan = planner.generatePlan();

                const dimensions = planner.getTargetDimensions(
                    originalVideo.videoWidth || 1080,
                    originalVideo.videoHeight || 1920
                );
                videoCanvas.width = dimensions.width;
                videoCanvas.height = dimensions.height;

                if (displayCanvas) {
                    displayCanvas.width = dimensions.width;
                    displayCanvas.height = dimensions.height;
                }

                await ensureFontsReady();

                initAudio();
                if (audioContext.state === 'suspended') await audioContext.resume();

                // Pre-decode audio from user recording blobs (Safari workaround:
                // createMediaElementSource doesn't capture audio from blob URLs on Safari,
                // so we decode and play the audio directly for webcam steps.)
                const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
                    || /iPad|iPhone|iPod/.test(navigator.userAgent);
                for (const step of plan) {
                    if (step.type === 'webcam' && step.blob && !step.isTextMode && isSafari) {
                        try {
                            const buf = await step.blob.arrayBuffer();
                            step.decodedAudio = await audioContext.decodeAudioData(buf);
                        } catch (e) {
                            console.warn('[VideoProcessor] Audio decode failed:', e);
                            step.decodedAudio = null;
                        }
                    }
                }

                if (typeof videoCanvas.captureStream !== 'function') {
                    throw new Error(
                        '[VideoProcessor] canvas.captureStream is not supported in this browser. ' +
                        'Ensure you are running a modern browser (Chrome 51+, Firefox 43+, Safari 11+, Edge 79+).'
                    );
                }
                const canvasStream = videoCanvas.captureStream(30);
                const combinedStream = new MediaStream([
                    ...canvasStream.getVideoTracks(),
                    ...audioDestination.stream.getAudioTracks(),
                ]);

                const mimeType = getSupportedMimeType();
                const recorder = new MediaRecorder(combinedStream, { mimeType });
                const chunks = [];

                recorder.ondataavailable = e => {
                    if (e.data.size > 0) chunks.push(e.data);
                };

                recorder.onstop = () => {
                    const blob = new Blob(chunks, { type: mimeType });
                    const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
                    cleanup();
                    resolve({ blob, ext });
                };

                recorder.start(1000);

                await executeRenderLoop(
                    plan, originalVideo, videoCanvas, displayCanvas,
                    overlayImage, fluencyData,
                    id => { animationId = id; },
                    audioContext, audioDestination
                );

                recorder.stop();

            } catch (e) {
                console.error('[VideoProcessor] Render failed:', e);
                cleanup();
                reject(e);
            }
        });
    }

    return { process, cleanup };
}

// ---------------------------------------------------------------------------
// Public API — matches the existing call site in SuccessButtons.jsx exactly:
//   const { processVideo, shareVideo } = await import('../../modules/video/video-processor.js');
//   const result = await processVideo(fluencyData, lessonId, canvas);
// ---------------------------------------------------------------------------
export async function processVideo(fluencyData = {}, lessonId = null, displayCanvas = null) {
    const processor = createVideoProcessor();
    return processor.process(fluencyData, lessonId, displayCanvas);
}

// ---------------------------------------------------------------------------
// Render loop — receives an animationId setter so the instance can cancel it
// ---------------------------------------------------------------------------
async function executeRenderLoop(plan, video, canvas, displayCanvas, overlayImage, fluencyData, setAnimationId, audioContext, audioDestination) {
    const ctx = canvas.getContext('2d');
    const planner = new VideoRenderPlanner();
    let currentAudioSource = null;

    function stopDecodedAudio() {
        if (currentAudioSource) {
            try { currentAudioSource.stop(); } catch (e) { /* ignore */ }
            currentAudioSource = null;
        }
    }

    return new Promise(async (resolve) => {
        let stepIndex = 0;
        let isTailing = false;
        let tailStart = 0;
        let lastFrameCanvas = null;

        const nextStep = async () => {
            if (stepIndex >= plan.length) {
                resolve();
                return;
            }

            stopDecodedAudio();

            const step = plan[stepIndex];

            if (step.type === 'tailing') {
                isTailing = true;
                tailStart = performance.now();

                lastFrameCanvas = document.createElement('canvas');
                lastFrameCanvas.width = canvas.width;
                lastFrameCanvas.height = canvas.height;

                if (video.readyState >= 2) {
                    lastFrameCanvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
                } else {
                    const lCtx = lastFrameCanvas.getContext('2d');
                    lCtx.fillStyle = '#111318';
                    lCtx.fillRect(0, 0, canvas.width, canvas.height);
                }
                return;
            }

            if (step.type === 'webcam' && (!step.blob || step.isTextMode)) {
                video.src = '';
                step.textModeStartTime = performance.now();
                return;
            }

            video.crossOrigin = 'anonymous';
            const sourceUrl = step.type === 'remote'
                ? await resolveRemoteUrl(step.targetId)
                : URL.createObjectURL(step.blob);
            video.src = sourceUrl;
            video.load();

            await new Promise(res => {
                video.onloadedmetadata = async () => {
                    if (step.trim?.start) video.currentTime = step.trim.start;
                    try {
                        await video.play();

                        // For webcam steps on Safari, play decoded audio as a buffer source
                        // since createMediaElementSource doesn't capture audio from blob URLs.
                        if (step.type === 'webcam' && step.decodedAudio && audioContext) {
                            if (audioContext.state === 'suspended') await audioContext.resume();
                            const source = audioContext.createBufferSource();
                            source.buffer = step.decodedAudio;
                            source.connect(audioDestination);
                            // Also connect to speakers so the user can hear their recording.
                            source.connect(audioContext.destination);
                            const startOffset = step.trim?.start || 0;
                            source.start(audioContext.currentTime, startOffset);
                            currentAudioSource = source;
                            video.muted = true;
                        } else {
                            video.muted = false;
                        }
                    } catch (err) {
                        console.warn('[VideoProcessor] Browser blocked autoplay. Retrying muted.', err);
                        video.muted = true;
                        try {
                            await video.play();
                        } catch (fatalErr) {
                            console.error('[VideoProcessor] Fatal play error', fatalErr);
                        }
                    }
                    res();
                };
                setTimeout(res, 3000);
            });
        };

        const draw = () => {
            const step = plan[stepIndex];
            if (!step) return;

            if (isTailing && lastFrameCanvas) {
                ctx.fillStyle = '#111318';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(lastFrameCanvas, 0, 0);
            } else if (step.type === 'webcam' && (!step.blob || step.isTextMode)) {
                ctx.fillStyle = '#111318';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            } else if (video.readyState >= 2) {
                const layout = planner.calculateLayout(
                    video.videoWidth, video.videoHeight, canvas.width, canvas.height
                );
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(video, layout.x, layout.y, layout.width, layout.height);
            } else if (lastFrameCanvas) {
                // Video is buffering — show the last captured frame to avoid
                // a black flash during the transition between segments.
                ctx.fillStyle = '#111318';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(lastFrameCanvas, 0, 0);
            } else {
                // Video is buffering and no freeze-frame is available yet.
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }

            if (overlayImage?.complete && overlayImage.naturalWidth > 0) {
                const x = (canvas.width - overlayImage.naturalWidth) / 2;
                ctx.drawImage(overlayImage, x, 0);
            }

            drawTextOverlay(
                ctx, canvas.width, canvas.height,
                isTailing, tailStart, fluencyData,
                step.isFirst, step.subtitle
            );

            if (displayCanvas) {
                const dCtx = displayCanvas.getContext('2d');
                dCtx.drawImage(canvas, 0, 0, displayCanvas.width, displayCanvas.height);
            }

            let shouldAdvance = false;
            if (isTailing) {
                if (performance.now() - tailStart > 4000) resolve();
            } else {
                if (step.isTextMode || (step.type === 'webcam' && !step.blob)) {
                    const elapsed = performance.now() - (step.textModeStartTime || performance.now());
                    if (elapsed >= 3000) shouldAdvance = true;
                } else {
                    const endTime = step.trim?.end || video.duration;
                    if (video.ended || video.currentTime >= endTime) shouldAdvance = true;
                }
            }

            if (shouldAdvance) {
                // Capture the last frame as a freeze-frame so the next
                // segment shows something while its video loads.
                if (video.readyState >= 2) {
                    if (!lastFrameCanvas) {
                        lastFrameCanvas = document.createElement('canvas');
                        lastFrameCanvas.width = canvas.width;
                        lastFrameCanvas.height = canvas.height;
                    }
                    lastFrameCanvas.getContext('2d').drawImage(
                        video, 0, 0, lastFrameCanvas.width, lastFrameCanvas.height
                    );
                }
                stopDecodedAudio();
                stepIndex++;
                nextStep();
            }

            if (stepIndex < plan.length || isTailing) {
                setAnimationId(requestAnimationFrame(draw));
            }
        };

        await nextStep();
        draw();
    });
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

/**
 * Word-wrap a string into lines that fit within maxWidth when rendered
 * with the current font on the given context.
 */
function wrapText(context, text, maxWidth) {
    const words = text.split(' ');
    const lines = [];
    let line = '';

    for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n] + ' ';
        if (context.measureText(testLine).width > maxWidth && n > 0) {
            lines.push(line.trim());
            line = words[n] + ' ';
        } else {
            line = testLine;
        }
    }
    lines.push(line.trim());
    return lines;
}

function drawTextOverlay(context, canvasWidth, canvasHeight, tailing, tailStart, fluencyData, isFirst, subtitleText) {
    const now = performance.now();
    const blinkOn = Math.floor(now / 500) % 2 === 0;
    context.save();

    if (isFirst || tailing) {
        const yFromBottom = canvasHeight * 0.20;
        const baseY = canvasHeight - yFromBottom;
        const lineGap = Math.max(5, Math.round(canvasHeight * 0.03));

        context.textAlign = 'center';
        context.textBaseline = 'top';
        context.fillStyle = 'yellow';
        const centerX = Math.floor(canvasWidth / 2);

        const data = tailing
            ? [
                { text: 'FLUENCY SCORE', mult: 1.35, blink: false },
                { text: `${fluencyData.total || 'NA'}%`, mult: 1.8, blink: true },
              ]
            : [
                { text: 'CALCULATING', mult: 1.0, blink: true },
                { text: 'FLUENCY', mult: 1.0, blink: true },
              ];

        const baseSize = 30;
        context.font = `700 ${baseSize}px "Orbitron", sans-serif`;

        const longestWidth = Math.max(
            context.measureText(data[0].text).width,
            context.measureText(data[1].text).width
        );

        const desiredWidth = canvasWidth * 0.7;
        const scale = desiredWidth / (longestWidth || 1);
        const baseFontSize = Math.max(18, Math.floor(baseSize * scale));

        const heights = data.map(d => {
            const size = Math.floor(baseFontSize * d.mult);
            context.font = `700 ${size}px "Orbitron", sans-serif`;
            const m = context.measureText(d.text);
            return (m.actualBoundingBoxAscent || size * 0.7) + (m.actualBoundingBoxDescent || size * 0.3);
        });

        const totalHeight = heights.reduce((a, b) => a + b, 0) + (data.length - 1) * lineGap;
        const startY = baseY - totalHeight - Math.max(20, Math.floor(canvasHeight * 0.1));

        context.shadowColor = 'rgba(0, 0, 0, 0.8)';
        context.shadowBlur = Math.max(8, Math.round(baseFontSize * 0.3));

        let y = startY;
        data.forEach((d, i) => {
            const fontSize = Math.floor(baseFontSize * d.mult);
            context.font = `700 ${fontSize}px "Orbitron", sans-serif`;
            if (!d.blink || blinkOn) {
                context.strokeStyle = 'rgba(0,0,0,0.8)';
                context.lineWidth = Math.max(6, Math.round(fontSize * 0.18));
                context.strokeText(d.text, centerX, y);
                context.fillText(d.text, centerX, y);
            }
            y += heights[i] + lineGap;
        });
    }

    // Unpack subtitle — support legacy string and new { en, translation } object
    let enText = '';
    let translationText = null;
    if (typeof subtitleText === 'string') {
        enText = subtitleText;
    } else if (subtitleText && typeof subtitleText === 'object') {
        enText = subtitleText.en || '';
        translationText = subtitleText.translation || null;
    }

    if (enText.trim() !== '') {
        context.textAlign = 'center';
        context.textBaseline = 'bottom';
        const centerX = Math.floor(canvasWidth / 2);

        const enFontSize = Math.max(16, Math.round(canvasWidth * 0.05));
        const maxSubtitleWidth = canvasWidth * 0.9;

        // Word-wrap English text
        context.font = `bold ${enFontSize}px "Plus Jakarta Sans", sans-serif`;
        const enLines = wrapText(context, enText, maxSubtitleWidth);

        // Word-wrap translation text (if present)
        let trLines = [];
        const trFontSize = Math.round(enFontSize * 0.85);
        if (translationText && translationText.trim() !== '') {
            context.font = `italic ${trFontSize}px "Plus Jakarta Sans", sans-serif`;
            trLines = wrapText(context, translationText, maxSubtitleWidth);
        }

        const enLineHeight = enFontSize * 1.2;
        const trLineHeight = trFontSize * 1.3;
        const gapBetween = Math.round(enFontSize * 0.15);
        const totalEnHeight = enLines.length * enLineHeight;
        const totalTrHeight = trLines.length > 0
            ? gapBetween + trLines.length * trLineHeight
            : 0;
        const totalTextHeight = totalEnHeight + totalTrHeight;

        // Measure longest line across both English and translation
        let longestLineWidth = 0;
        context.font = `bold ${enFontSize}px "Plus Jakarta Sans", sans-serif`;
        enLines.forEach(l => {
            longestLineWidth = Math.max(longestLineWidth, context.measureText(l).width);
        });
        if (trLines.length > 0) {
            context.font = `italic ${trFontSize}px "Plus Jakarta Sans", sans-serif`;
            trLines.forEach(l => {
                longestLineWidth = Math.max(longestLineWidth, context.measureText(l).width);
            });
        }

        const boxPadding = 10;
        const subtitleStartY = canvasHeight * 0.75;

        // Background box covering both English and translation lines
        context.fillStyle = 'rgba(0, 0, 0, 0.6)';
        context.fillRect(
            centerX - longestLineWidth / 2 - boxPadding,
            subtitleStartY - enLineHeight - boxPadding,
            longestLineWidth + boxPadding * 2,
            totalTextHeight + boxPadding * 2
        );

        // Draw English lines
        context.fillStyle = 'white';
        context.shadowColor = 'black';
        context.shadowBlur = 4;
        context.font = `bold ${enFontSize}px "Plus Jakarta Sans", sans-serif`;
        enLines.forEach((l, i) => {
            context.fillText(l, centerX, subtitleStartY + i * enLineHeight);
        });

        // Draw translation lines (italic, slightly smaller)
        if (trLines.length > 0) {
            context.font = `italic ${trFontSize}px "Plus Jakarta Sans", sans-serif`;
            const trStartY = subtitleStartY + totalEnHeight + gapBetween;
            trLines.forEach((l, i) => {
                context.fillText(l, centerX, trStartY + i * trLineHeight);
            });
        }
    }

    context.restore();
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
async function resolveRemoteUrl(vUrl) {
    return getVideoUrl(vUrl);
}

function getSupportedMimeType() {
    const isIOSDevice =
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    const types = isIOSDevice
        ? [
            'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
            'video/mp4;codecs=avc1.42E01E',
            'video/mp4',
            'video/webm;codecs=vp8,opus',
          ]
        : [
            'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
            'video/mp4',
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/webm',
          ];

    return types.find(t => MediaRecorder.isTypeSupported(t)) || '';
}
