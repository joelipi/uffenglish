// modules/video-processor.web.js
import { getAllSpeechRecordingsForLesson } from './storage.js';
import { VideoRenderPlanner } from './video-processor-logic.js';
import { shareVideo } from './video-share.web.js';
import { appStore } from './store.js';

export { shareVideo };

let processorContainer = null;
let audioContext = null;
let audioSource = null;
let audioDestination = null;
let animationId = null;
let fontReady = false;

export function initVideoProcessor(container) {
    console.log("[VideoProcessor] Initializing with container:", container);
    processorContainer = container;

    let originalVideo = container.querySelector('#originalVideo') || document.getElementById('originalVideo');
    if (!originalVideo) {
        originalVideo = document.createElement('video');
        originalVideo.id = 'originalVideo';
        originalVideo.crossOrigin = "anonymous";
        originalVideo.playsInline = true;
        originalVideo.style.display = 'none';
    }
    if (originalVideo.parentNode !== container) {
        container.appendChild(originalVideo);
    }
}

export function cleanupVideoProcessor() {
    console.log("[VideoProcessor] Cleaning up processor...");
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }
    if (audioContext) {
        if (audioContext.state !== 'closed') {
            audioContext.close().catch(e => console.warn("[VideoProcessor] Error closing AudioContext:", e));
        }
        audioContext = null;
    }
    audioSource = null;
    audioDestination = null;

    const originalVideo = processorContainer ? processorContainer.querySelector('#originalVideo') : document.getElementById('originalVideo');
    if (originalVideo) {
        originalVideo.pause();
        originalVideo.src = '';
        originalVideo.load();
        if (originalVideo.parentNode) {
            originalVideo.parentNode.removeChild(originalVideo);
        }
    }
    processorContainer = null;
}

export async function processVideo(fluencyData = {}, lessonId = null, displayCanvas = null) {
    return new Promise(async (resolve, reject) => {
        try {
            console.log("[VideoProcessor] Starting live processing on screen...");

            const recordings = await getAllSpeechRecordingsForLesson(lessonId) || [];
            console.warn('[video] processVideo called', { lessonId, fluencyData, recordingsLength: recordings.length });
            console.log('[video] processVideo called', { lessonId, fluencyData, recordingsLength: recordings.length });

            if (!recordings.length) {
                console.warn("[VideoProcessor] No recordings found. Proceeding with text-mode/summary generation.");
            }

            let originalVideo = processorContainer ? processorContainer.querySelector('#originalVideo') : document.getElementById('originalVideo');
            if (!originalVideo) {
                originalVideo = document.createElement('video');
                originalVideo.id = 'originalVideo';
                originalVideo.crossOrigin = "anonymous";
                originalVideo.playsInline = true;
                originalVideo.style.display = 'none';
                if (processorContainer) {
                    processorContainer.appendChild(originalVideo);
                }
            }

            originalVideo.muted = false;

            const videoCanvas = document.createElement('canvas');

            const overlayImage = new Image();
            overlayImage.src = '/assets/img/header.png';

            const firstValidRec = recordings.find(r => r.blob);
            if (firstValidRec) {
                originalVideo.src = URL.createObjectURL(firstValidRec.blob);
                await new Promise((res) => {
                    originalVideo.onloadedmetadata = res;
                    setTimeout(res, 2000);
                });
            }

            const configData = appStore.getState().configData || {};
            const planner = new VideoRenderPlanner(recordings, configData, fluencyData);
            const plan = planner.generatePlan();

            const dimensions = planner.getTargetDimensions(originalVideo.videoWidth || 1080, originalVideo.videoHeight || 1920);
            videoCanvas.width = dimensions.width;
            videoCanvas.height = dimensions.height;

            if (displayCanvas) {
                displayCanvas.width = dimensions.width;
                displayCanvas.height = dimensions.height;
            }

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

            if (audioContext.state === 'suspended') await audioContext.resume();

            await ensureFontsReady();

            const canvasStream = videoCanvas.captureStream(30);
            const combinedStream = new MediaStream([
                ...canvasStream.getVideoTracks(),
                ...audioDestination.stream.getAudioTracks()
            ]);

            const mimeType = getSupportedMimeType();
            const recorder = new MediaRecorder(combinedStream, { mimeType });
            const chunks = [];

            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) chunks.push(e.data);
            };

            recorder.onstop = () => {
                const blob = new Blob(chunks, { type: mimeType });
                const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
                resolve({ blob, ext });
            };

            recorder.start(1000);

            await executeRenderLoop(plan, originalVideo, videoCanvas, displayCanvas, overlayImage, fluencyData);

            recorder.stop();

        } catch (e) {
            console.error("[VideoProcessor] Render failed:", e);
            reject(e);
        }
    });
}

async function executeRenderLoop(plan, video, canvas, displayCanvas, overlayImage, fluencyData) {
    const ctx = canvas.getContext('2d');
    const planner = new VideoRenderPlanner();

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
                    lastFrameCanvas.getContext('2d').fillStyle = '#111318';
                    lastFrameCanvas.getContext('2d').fillRect(0, 0, canvas.width, canvas.height);
                }
                return;
            }

            if (step.type === 'webcam' && (!step.blob || step.isTextMode)) {
                video.src = '';
                step.textModeStartTime = performance.now();
                return;
            }

            video.crossOrigin = "anonymous";
            const sourceUrl = step.type === 'remote' ? await resolveRemoteUrl(step.targetId) : URL.createObjectURL(step.blob);
            video.src = sourceUrl;
            video.load();

            await new Promise((res) => {
                video.onloadedmetadata = async () => {
                    if (step.trim?.start) video.currentTime = step.trim.start;
                    try {
                        await video.play();
                    } catch (err) {
                        console.warn("[VideoProcessor] Browser blocked loud autoplay. Retrying muted.", err);
                        video.muted = true;
                        try {
                            await video.play();
                        } catch (fatalErr) {
                            console.error("[VideoProcessor] Fatal play error", fatalErr);
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
                const layout = planner.calculateLayout(video.videoWidth, video.videoHeight, canvas.width, canvas.height);
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(video, layout.x, layout.y, layout.width, layout.height);
            } else {
                // --- CRITICAL FIX ---
                // If the video is buffering/loading, explicitly clear the screen to black 
                // so the old subtitle from the previous frame doesn't freeze on screen.
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }

            if (overlayImage?.complete && overlayImage.naturalWidth > 0) {
                const x = (canvas.width - overlayImage.naturalWidth) / 2;
                ctx.drawImage(overlayImage, x, 0);
            }

            drawTextOverlay(ctx, canvas.width, canvas.height, isTailing, tailStart, fluencyData, step.isFirst, step.subtitle);

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
                    let endTime = step.trim?.end || video.duration;
                    if (video.ended || video.currentTime >= endTime) shouldAdvance = true;
                }
            }

            if (shouldAdvance) {
                stepIndex++;
                nextStep();
            }

            if (stepIndex < plan.length || isTailing) {
                animationId = requestAnimationFrame(draw);
            }
        };

        await nextStep();
        draw();
    });
}

function drawTextOverlay(context, canvasWidth, canvasHeight, tailing, tailStart, fluencyData, isFirst, subtitleText) {
    const now = performance.now();
    //console.warn('[video] drawTextOverlay', { tailing, fluencyDataTotal: fluencyData?.total, isFirst, subtitleText });
    //console.log('[video] drawTextOverlay', { tailing, fluencyDataTotal: fluencyData?.total, isFirst, subtitleText });
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

        const data = tailing ?
            [{ text: 'FLUENCY SCORE', mult: 1.35, blink: false }, { text: `${fluencyData.total || "NA"}%`, mult: 1.8, blink: true }] :
            [{ text: 'CALCULATING', mult: 1.0, blink: true }, { text: 'FLUENCY', mult: 1.0, blink: true }];

        const baseSize = 30;
        context.font = `700 ${baseSize}px "Orbitron", sans-serif`;

        const longestWidth = Math.max(
            context.measureText(data[0].text).width,
            context.measureText(data[1].text).width
        );

        const desiredWidth = canvasWidth * 0.7;
        const scale = desiredWidth / (longestWidth || 1);
        const baseFontSize = Math.max(18, Math.floor(baseSize * scale));

        const heights = data.map((d, i) => {
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

    if (typeof subtitleText === 'string' && subtitleText.trim() !== "") {
        context.textAlign = 'center';
        context.textBaseline = 'bottom';
        const centerX = Math.floor(canvasWidth / 2);

        const subtitleFontSize = Math.max(16, Math.round(canvasWidth * 0.05));
        const maxSubtitleWidth = canvasWidth * 0.9;

        context.font = `bold ${subtitleFontSize}px "Plus Jakarta Sans", sans-serif`;

        const words = subtitleText.split(' ');
        let line = '';
        const lines = [];

        for (let n = 0; n < words.length; n++) {
            const testLine = line + words[n] + ' ';
            if (context.measureText(testLine).width > maxSubtitleWidth && n > 0) {
                lines.push(line.trim());
                line = words[n] + ' ';
            } else {
                line = testLine;
            }
        }
        lines.push(line.trim());

        const lineHeight = subtitleFontSize * 1.2;
        const subtitleStartY = canvasHeight * 0.75;
        const boxPadding = 10;
        let longestLineWidth = 0;

        lines.forEach(l => longestLineWidth = Math.max(longestLineWidth, context.measureText(l).width));

        context.fillStyle = 'rgba(0, 0, 0, 0.6)';
        context.fillRect(centerX - (longestLineWidth / 2) - boxPadding, subtitleStartY - lineHeight - boxPadding, longestLineWidth + (boxPadding * 2), (lines.length * lineHeight) + (boxPadding * 2));

        context.fillStyle = 'white';
        context.shadowColor = 'black';
        context.shadowBlur = 4;

        lines.forEach((l, i) => context.fillText(l, centerX, subtitleStartY + (i * lineHeight)));
    }

    context.restore();
}

async function resolveRemoteUrl(vUrl) {
    if (window.preloadedMedia && window.preloadedMedia[vUrl]) return window.preloadedMedia[vUrl];
    return `https://r2.ultrafastfluency.com/assets/videos/${vUrl}.mp4`;
}

function getSupportedMimeType() {
    const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const types = isIOSDevice ? [
        'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
        'video/mp4;codecs=avc1.42E01E',
        'video/mp4',
        'video/webm;codecs=vp8,opus'
    ] : [
        'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
        'video/mp4',
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm'
    ];
    return types.find(t => MediaRecorder.isTypeSupported(t)) || '';
}

async function ensureFontsReady() {
    if (fontReady || !document.fonts) return;
    try {
        await Promise.all([
            document.fonts.load('700 24px "Orbitron"'),
            document.fonts.load('bold 24px "Plus Jakarta Sans"')
        ]);
        fontReady = true;
    } catch (e) { console.warn("Font load failed", e); }
}