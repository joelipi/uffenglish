// --- modules/video-processor.web.js ---
import { getAllSpeechRecordingsForLesson } from './storage.js';
import { VideoRenderPlanner } from './video-processor-logic.js';

let audioContext = null;
let audioSource = null;
let audioDestination = null;
let animationId = null;
let fontReady = false;

/**
 * Processes the video recordings entirely in memory.
 * @returns {Promise<{blob: Blob, ext: string}>} The finalized video blob and extension
 */
export async function processVideo(fluencyData = {}, lessonId = null) {
    return new Promise(async (resolve, reject) => {
        try {
            console.log("[VideoProcessor] Starting background processing...");

            const recordings = await getAllSpeechRecordingsForLesson(lessonId);
            if (!recordings?.length) throw new Error("No recordings found.");

            // 1. Setup In-Memory Elements (No DOM clutter required)
            const originalVideo = document.createElement('video');
            originalVideo.crossOrigin = "anonymous";
            originalVideo.muted = true; // Crucial for auto-play without DOM attachment
            originalVideo.playsInline = true;

            const videoCanvas = document.createElement('canvas');

            const overlayImage = new Image();
            overlayImage.src = 'assets/img/header.png';

            // Load initial recording to get dimensions
            originalVideo.src = URL.createObjectURL(recordings[0].blob);
            await new Promise((res) => {
                originalVideo.onloadedmetadata = res;
            });

            const configData = window.__currentConfigData || window.State?.configData || {};
            const planner = new VideoRenderPlanner(recordings, configData, fluencyData);
            const plan = planner.generatePlan();

            // 2. Setup Resolution
            const dimensions = planner.getTargetDimensions(originalVideo.videoWidth, originalVideo.videoHeight);
            videoCanvas.width = dimensions.width;
            videoCanvas.height = dimensions.height;

            // 3. Setup Audio
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

            // 4. Prepare Fonts
            await ensureFontsReady();

            // 5. Start Recording
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

            // 6. Resolve the promise when the recorder finishes
            recorder.onstop = () => {
                const blob = new Blob(chunks, { type: mimeType });
                const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
                resolve({ blob, ext });
            };

            recorder.start(1000);

            // 7. Execute Render Loop
            await executeRenderLoop(plan, originalVideo, videoCanvas, overlayImage, fluencyData);

            recorder.stop();

        } catch (e) {
            console.error("[VideoProcessor] Render failed:", e);
            reject(e);
        }
    });
}

async function executeRenderLoop(plan, video, canvas, overlayImage, fluencyData) {
    const ctx = canvas.getContext('2d');
    const planner = new VideoRenderPlanner(); // For layout helpers

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

                // Freeze frame for tailing
                lastFrameCanvas = document.createElement('canvas');
                lastFrameCanvas.width = canvas.width;
                lastFrameCanvas.height = canvas.height;
                lastFrameCanvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
                return;
            }

            // Load Video Source
            video.crossOrigin = "anonymous";
            const sourceUrl = step.type === 'remote' ? await resolveRemoteUrl(step.targetId) : URL.createObjectURL(step.blob);
            video.src = sourceUrl;
            video.load();

            await new Promise((res) => {
                video.onloadedmetadata = async () => {
                    if (step.trim?.start) video.currentTime = step.trim.start;
                    await video.play();
                    res();
                };
            });
        };

        const draw = () => {
            const step = plan[stepIndex];
            if (!step) return;

            // 1. Draw Background (Video or Freeze Frame)
            if (isTailing && lastFrameCanvas) {
                ctx.drawImage(lastFrameCanvas, 0, 0);
            } else if (video.readyState >= 2) {
                const layout = planner.calculateLayout(video.videoWidth, video.videoHeight, canvas.width, canvas.height);
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(video, layout.x, layout.y, layout.width, layout.height);
            }

            // 2. Draw Overlay Image (Branding)
            if (overlayImage?.complete && overlayImage.naturalWidth > 0) {
                const x = (canvas.width - overlayImage.naturalWidth) / 2;
                ctx.drawImage(overlayImage, x, 0);
            }

            // 3. Draw Text (Subtitles / Scores)
            drawTextOverlay(ctx, canvas.width, canvas.height, isTailing, tailStart, fluencyData, step.isFirst, step.subtitle);

            // 4. Check Timing / Advance
            let shouldAdvance = false;
            if (isTailing) {
                if (performance.now() - tailStart > 4000) resolve();
            } else {
                let endTime = step.trim?.end || video.duration;
                if (step.isTextMode) {
                    endTime = 3;
                    console.log(`[VideoProcessor] Text mode clip forced to 3s`);
                }
                if (video.ended || video.currentTime >= endTime) shouldAdvance = true;
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
    const blinkOn = Math.floor(now / 500) % 2 === 0;
    context.save();

    // 1. Draw top overlay text only if it's the first segment or the tail segment
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

    // 2. Draw Subtitles at the bottom (burned in)
    if (subtitleText && subtitleText.trim() !== "") {
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
    return `https://firebasestorage.googleapis.com/v0/b/cogdexapptest.appspot.com/o/videos%2F${vUrl}.mp4?alt=media`;
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