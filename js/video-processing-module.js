// video-processing-module.js

import { shareVideo } from './videoShare.js';
import { getAllSpeechRecordingsForLesson } from './modules/storage.js';

export function initVideoProcessor(externalPromptText, fluencyData = {}, lessonId = null) {
    window.__currentProcessingLessonId = lessonId;
    if (typeof State !== 'undefined') window.__currentConfigData = State.configData;
    console.log("initVideoProcessor called");
    document.getElementById('bottomButtonBar').classList.add('d-none');
    document.getElementById('bottomButtonBarSuccess').classList.remove('d-none');
    document.getElementById("micStatusText").innerHTML = "<div class='text-center'>Get Complete Fluency Score and Shareable Video.<br><span lang='es'><i>Recibir Calificación de Fluidez Completa y Video Compartible.</i></span></div>";

    const finalFluencyData = { listening: fluencyData.listening || "NA", speaking: fluencyData.speaking || "NA", total: fluencyData.total || "NA"};
        console.log("finalFluencyData: ", finalFluencyData);
    const originalVideo = document.getElementById('originalVideo');
    const processBtn = document.getElementById('processBtn');

    // Get or create the resultVideo element
    let resultVideo = document.getElementById('resultVideo');
    if (!resultVideo) {
        resultVideo = document.createElement('video');
        resultVideo.id = 'resultVideo';
        resultVideo.classList.add('d-none');
        
        // Add it to an appropriate container
        const container = document.getElementById('media-container') || document.body;
        container.appendChild(resultVideo);
        console.log("Created resultVideo element dynamically");
    }

    const processBtnContainer = document.getElementById('bottomButtonBarSuccess');
    const bigButtons = document.getElementById('big-buttons');
    const videoCanvas = document.getElementById('videoCanvas');
    
    console.log("Elements found:", {
        originalVideo: !!originalVideo,
        processBtn: !!processBtn,
        resultVideo: !!resultVideo,
        bigButtons: !!bigButtons,
        videoCanvas: !!videoCanvas
    });
    
    // Create display canvas for preview
    const displayCanvas = document.createElement('canvas');
    displayCanvas.id = 'displayCanvas';
    displayCanvas.style.position = 'static';
    displayCanvas.style.width = '100%';
    displayCanvas.style.maxWidth = '400px';
    displayCanvas.style.height = 'auto';
    displayCanvas.style.margin = '10px auto';
    displayCanvas.style.zIndex = 'auto';
    displayCanvas.style.display = 'none';
    displayCanvas.style.boxSizing = 'border-box';
    displayCanvas.style.backgroundColor = '#000';

    // Determine where to place the canvas based on screen width
    const isDesktop = window.innerWidth > 1000;
    const targetContainer = isDesktop 
        ? document.getElementById('playback-video-mobile-container')
        : document.getElementById('playback-video-mobile-container');

    if (targetContainer) {
        targetContainer.appendChild(displayCanvas);
        console.log("Display canvas appended to target container");
    } else {
        const questionsContainer = document.getElementById('questions-container-container');
        if (questionsContainer) {
            questionsContainer.insertBefore(displayCanvas, questionsContainer.firstChild);
            console.log("Display canvas appended to questions container");
        } else {
            console.warn('No suitable container found, appending to body as fallback');
            document.body.appendChild(displayCanvas);
        }
    }

    const displayContext = displayCanvas.getContext('2d', { 
        alpha: false, 
        willReadFrequently: false
    });
    
    const overlayImage = document.getElementById('overlayImage');
    const canvasContext = videoCanvas.getContext('2d', { 
        alpha: false, 
        willReadFrequently: false
    });
    
    // Cache iOS detection result
    const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    
    let overlayReady = false;
    let fontReady = false;
    
    if (overlayImage && overlayImage.complete && overlayImage.naturalWidth > 0) {
        overlayReady = true;
        console.log("Overlay image already loaded");
    }
    
    if (overlayImage) {
        overlayImage.addEventListener('load', () => {
            overlayReady = true;
            console.log("Overlay image loaded successfully");
        }, { once: true });
        
        overlayImage.addEventListener('error', () => {
            overlayReady = false;
            console.error("Overlay image failed to load");
        }, { once: true });
    } else {
        console.error("Overlay image element not found");
    }

    let videoBlob = null;
    let audioContext = null;
    let audioSource = null;
    let audioDestination = null;
    let audioStream = null;
    let fileExtension = 'webm';
    let animationId = null;
    let lastFrameCanvas = null;
    let lastFrameCtx = null;
    
    // Function to update display canvas size based on video aspect ratio
    function updateDisplayCanvasSize() {
        if (!originalVideo.videoWidth || !originalVideo.videoHeight) {
            console.log("Video dimensions not available yet");
            return;
        }
        
        const container = displayCanvas.parentElement;
        const containerWidth = container ? container.offsetWidth : window.innerWidth;
        
        const aspectRatio = originalVideo.videoWidth / originalVideo.videoHeight;
        const isPortrait = originalVideo.videoHeight > originalVideo.videoWidth;
        const isMobile = window.innerWidth <= 1000;
        
        let maxDisplayWidth;
        if (isMobile && isPortrait) {
            maxDisplayWidth = Math.min(300, containerWidth * 0.80);
        } else if (isMobile) {
            maxDisplayWidth = Math.min(350, containerWidth * 0.90);
        } else {
            maxDisplayWidth = Math.min(400, containerWidth * 0.90);
        }
        
        const displayHeight = Math.round(maxDisplayWidth / aspectRatio);
        
        displayCanvas.width = maxDisplayWidth;
        displayCanvas.height = displayHeight;
        displayCanvas.style.width = maxDisplayWidth + 'px';
        displayCanvas.style.height = displayHeight + 'px';
        displayCanvas.style.maxWidth = '100%';
        displayCanvas.style.boxSizing = 'border-box';
        
        console.log("Display canvas size updated:", {width: maxDisplayWidth, height: displayHeight});
    }

    // Call this when video metadata is loaded
    originalVideo.addEventListener('loadedmetadata', function() {
        console.log("Video metadata loaded:", {
            videoWidth: originalVideo.videoWidth,
            videoHeight: originalVideo.videoHeight,
            duration: originalVideo.duration,
            readyState: originalVideo.readyState,
            networkState: originalVideo.networkState
        });
        
        videoCanvas.width = originalVideo.videoWidth;
        videoCanvas.height = originalVideo.videoHeight;
        updateDisplayCanvasSize();
    }, { once: true });

    // Add error event listener for detailed error information
    originalVideo.addEventListener('error', function() {
        console.error("Video error event fired:", {
            error: originalVideo.error,
            readyState: originalVideo.readyState,
            networkState: originalVideo.networkState,
            src: originalVideo.src
        });
    }, { once: true });
    
    // Update display canvas size on window resize
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            if (originalVideo.videoWidth && originalVideo.videoHeight) {
                updateDisplayCanvasSize();
            }
        }, 250);
    });
    
    // Optimize IndexedDB with connection pooling
    let dbConnection = null;
    async function getLatestVideoFromIndexedDB() {
        console.log("Attempting to get video from IndexedDB");
        
        try {
            const currentLessonId = window.__currentProcessingLessonId || 'unknown_lesson';
            const recordings = await getAllSpeechRecordingsForLesson(currentLessonId);
            if (recordings && recordings.length > 0) {
                const video = recordings[0];
                if (video && video.blob) {
                    console.log("Video blob found in IndexedDB, size:", video.blob.size, "type:", video.blob.type);
                    return video.blob;
                }
            }
            console.log("No video found in IndexedDB");
            throw new Error('No video found');
        } catch (error) {
            console.error("Failed to retrieve video:", error);
            if (error.message === 'No video found') {
                throw error;
            }
            throw new Error('Failed to retrieve video');
        }
    }
    
    // Cache text metrics for performance
    const textMetricsCache = new Map();
    function getCachedTextMetrics(context, text, font) {
        const key = `${font}-${text}`;
        if (textMetricsCache.has(key)) {
            return textMetricsCache.get(key);
        }
        
        context.font = font;
        const metrics = context.measureText(text);
        textMetricsCache.set(key, metrics);
        return metrics;
    }

    function drawWrappedText(context, text, x, y, maxWidth, lineHeight) {
        const words = text.split(' ');
        let line = '';
        let testLine = '';
        let lineCount = 0;
        
        for(let n = 0; n < words.length; n++) {
            testLine = line + words[n] + ' ';
            const metrics = context.measureText(testLine);
            const testWidth = metrics.width;
            
            if (testWidth > maxWidth && n > 0) {
                context.fillText(line, x, y);
                line = words[n] + ' ';
                y += lineHeight;
                lineCount++;
            } else {
                line = testLine;
            }
        }
        
        context.fillText(line, x, y);
        return lineCount + 1;
    }

    // Cache gradient and other expensive objects
    let cachedGradients = new Map();
    function getCachedGradient(context, width, height, type = 'main') {
        const key = `${type}-${width}-${height}`;
        if (cachedGradients.has(key)) {
            return cachedGradients.get(key);
        }
        
        let gradient;
        if (type === 'main') {
            gradient = context.createLinearGradient(0, 0, width, height);
            gradient.addColorStop(0, '#3a8fd5');
            gradient.addColorStop(1, '#00c0d8');
        } else if (type === 'top') {
            gradient = context.createLinearGradient(0, 0, width, 0);
            gradient.addColorStop(0, '#000000');
            gradient.addColorStop(1, '#000000');
        }
        
        cachedGradients.set(key, gradient);
        return gradient;
    }

    // Consolidated text overlay function with optimizations
    function drawTextOverlay(context, canvasWidth, canvasHeight, tailing, tailStart, isDisplayCanvas = false, fluencyData = {}, isFirst = false, subtitleText = "") {
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

            const grad = getCachedGradient(context, canvasWidth, canvasHeight, 'main');
            context.fillStyle = 'yellow';

            const centerX = Math.floor(canvasWidth / 2);

            const normalData = [
                { text: 'CALCULATING', mult: 1.0, blink: true },
                { text: 'FLUENCY', mult: 1.0, blink: true }
            ];

            const tailData = [
                { text: 'FLUENCY SCORE', mult: 1.35, blink: false },
                { text: `${fluencyData.total || "NA"}%`, mult: 1.8, blink: true }
            ];

            const data = tailing ? tailData : normalData;

            const baseSize = 30;
            const baseFontKey = `700 ${baseSize}px "Orbitron", sans-serif`;

            let longestWidth = 1;
            data.forEach(d => {
                const metrics = getCachedTextMetrics(context, d.text, baseFontKey);
                longestWidth = Math.max(longestWidth, metrics.width);
            });

            const desiredWidth = canvasWidth * 0.7;
            const scale = desiredWidth / longestWidth;
            const baseFontSize = Math.max(18, Math.floor(baseSize * scale));

            const fontSizes = data.map(d => Math.floor(baseFontSize * d.mult));
            
            const heights = data.map((d, i) => {
                const fontKey = `700 ${fontSizes[i]}px "Orbitron", sans-serif`;

                let metrics = getCachedTextMetrics(context, d.text, fontKey);
                const maxWidth = canvasWidth * 0.98;
                if (metrics.width > maxWidth) {
                    const reduceScale = maxWidth / metrics.width;
                    fontSizes[i] = Math.floor(fontSizes[i] * reduceScale);
                    const newFontKey = `700 ${fontSizes[i]}px "Orbitron", sans-serif`;
                    metrics = getCachedTextMetrics(context, d.text, newFontKey);
                }
                return (metrics.actualBoundingBoxAscent || fontSizes[i] * 0.7) + (metrics.actualBoundingBoxDescent || fontSizes[i] * 0.3);
            });

            const totalHeight = heights.reduce((a, b) => a + b, 0) + (data.length - 1) * lineGap;
            const startY = baseY - totalHeight - Math.max(20, Math.floor(canvasHeight * 0.1));

            const isVisible = (i) => !data[i].blink || blinkOn;

            // Add glow
            context.shadowColor = 'rgba(0, 0, 0, 0.8)';
            context.shadowBlur = Math.max(8, Math.round(baseFontSize * 0.3));

            // Draw text outline
            context.strokeStyle = 'rgba(0,0,0,0.8)';
            const glowWidth = Math.max(6, Math.round(baseFontSize * 0.18));
            context.lineWidth = glowWidth;

            let y = startY;
            data.forEach((d, i) => {
                context.font = `700 ${fontSizes[i]}px "Orbitron", sans-serif`;
                if (isVisible(i)) {
                    context.strokeText(d.text, centerX, y);
                }
                y += heights[i] + (i < data.length - 1 ? lineGap : 0);
            });

            // Remove glow for subsequent passes
            context.shadowColor = 'transparent';
            context.shadowBlur = 0;

            // Draw crisp inner stroke
            context.strokeStyle = 'rgba(0,0,0,0.8)';
            context.lineWidth = Math.max(2, Math.round(baseFontSize * 0.08));

            y = startY;
            data.forEach((d, i) => {
                context.font = `700 ${fontSizes[i]}px "Orbitron", sans-serif`;
                if (isVisible(i)) {
                    context.strokeText(d.text, centerX, y);
                }
                y += heights[i] + (i < data.length - 1 ? lineGap : 0);
            });

            // Draw filled text
            y = startY;
            data.forEach((d, i) => {
                context.font = `700 ${fontSizes[i]}px "Orbitron", sans-serif`;
                if (isVisible(i)) {
                    context.fillText(d.text, centerX, y);
                }
                y += heights[i] + (i < data.length - 1 ? lineGap : 0);
            });
        }
        
        // 2. Draw Subtitles at the bottom (burned in)
        if (subtitleText && subtitleText.trim() !== "") {
            // Draw subtitle at bottom
            context.textAlign = 'center';
            context.textBaseline = 'bottom';

            const centerX = Math.floor(canvasWidth / 2);

            // Base font for subtitle (Plus Jakarta Sans)
            const subtitleFontSize = Math.max(16, Math.round(canvasWidth * 0.05));
            const maxSubtitleWidth = canvasWidth * 0.9;
            context.font = `bold ${subtitleFontSize}px "Plus Jakarta Sans", sans-serif`;

            // Wrap text
            const words = subtitleText.split(' ');
            let line = '';
            const lines = [];

            for (let n = 0; n < words.length; n++) {
                const testLine = line + words[n] + ' ';
                const metrics = context.measureText(testLine);
                if (metrics.width > maxSubtitleWidth && n > 0) {
                    lines.push(line.trim());
                    line = words[n] + ' ';
                } else {
                    line = testLine;
                }
            }
            lines.push(line.trim());

            const lineHeight = subtitleFontSize * 1.2;
            const subtitleStartY = canvasHeight * 0.75; // 25% from the bottom of the screen

            // Background box for subtitle readability
            const boxPadding = 10;
            let longestLineWidth = 0;
            lines.forEach(l => {
                longestLineWidth = Math.max(longestLineWidth, context.measureText(l).width);
            });

            context.fillStyle = 'rgba(0, 0, 0, 0.6)';
            context.fillRect(
                centerX - (longestLineWidth / 2) - boxPadding,
                subtitleStartY - lineHeight + (lineHeight * 0.2) - boxPadding,
                longestLineWidth + (boxPadding * 2),
                (lines.length * lineHeight) + (boxPadding * 2)
            );

            // Draw text
            context.fillStyle = 'white';
            context.shadowColor = 'black';
            context.shadowBlur = 4;

            lines.forEach((l, i) => {
                context.fillText(l, centerX, subtitleStartY + (i * lineHeight));
            });
        }
        
        context.restore();
    }

    async function createThumbnail() {
        return new Promise((resolve) => {
            // Use the SAME dimensions as your final video canvas
            const thumbnailCanvas = document.createElement('canvas');
            thumbnailCanvas.width = videoCanvas.width;
            thumbnailCanvas.height = videoCanvas.height;
            const ctx = thumbnailCanvas.getContext('2d');
            
            // Draw the LAST FRAME (with all overlays and final text)
            if (lastFrameCanvas) {
                // Use the cached last frame from your tail effect
                ctx.drawImage(lastFrameCanvas, 0, 0, thumbnailCanvas.width, thumbnailCanvas.height);
            } else {
                // Fallback: use current video frame
                ctx.drawImage(originalVideo, 0, 0, thumbnailCanvas.width, thumbnailCanvas.height);
            }
            
            // Draw ALL the same overlays and text as your final frame
            if (overlayReady && overlayImage.naturalWidth > 0) {
                const xPos = (thumbnailCanvas.width - overlayImage.naturalWidth) / 2;
                const yPos = 0;
                ctx.drawImage(overlayImage, xPos, yPos);
            }
            
            if (fontReady) {
                // Draw the FINAL text state (tailing completed)
                drawTextOverlay(ctx, thumbnailCanvas.width, thumbnailCanvas.height, true, 0, false, fluencyData, false, "");
            }
            
            // Create high-quality JPEG
            thumbnailCanvas.toBlob(resolve, 'image/jpeg', 0.95);
        });
    }
    
    // Define processVideoSequence to handle multiple recordings sequentially
    async function processVideoSequence(recordings, fluencyData = {}) {
        console.log("processVideoSequence called with", recordings.length, "recordings");
        
        return new Promise(async (resolve, reject) => {
            try {
                const processingVideo = originalVideo;

                let currentItemIndex = 0;
                let currentPhase = 'remote';
                let tailing = false;
                let tailStart = 0;
                lastFrameCanvas = null;
                lastFrameCtx = null;

                // FIRST: Pre-load the first video to ensure the source is valid before we capture stream
                await setupVideoSource(true);

                const srcW = processingVideo.videoWidth || 1080;
                const srcH = processingVideo.videoHeight || 1920;
                let targetW = srcW;
                let targetH = srcH;
                
                const isPortrait = srcH > srcW;

                if (isPortrait) {
                    if (srcH < 1080) {
                        const scale = 1080 / srcH;
                        targetW = Math.round(srcW * scale);
                        targetH = 1080;
                    }
                } else {
                    if (srcW < 1920) {
                        const scale = 1920 / srcW;
                        targetW = 1920;
                        targetH = Math.round(srcH * scale);
                    }
                }

                if (targetW % 2) targetW++;
                if (targetH % 2) targetH++;
                
                videoCanvas.width = targetW;
                videoCanvas.height = targetH;
                
                let audioStream;
                if (isIOSDevice) {
                    try {
                        if (audioContext && audioSource && audioDestination) {
                            if (audioContext.state === 'suspended') await audioContext.resume();
                            audioStream = audioDestination.stream;
                        } else {
                            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                            let source;
                            try {
                                source = audioCtx.createMediaElementSource(processingVideo);
                            } catch (sourceError) {
                                if (audioSource && audioSource.context === audioCtx) source = audioSource;
                                else throw sourceError;
                            }
                            
                            const dest = audioCtx.createMediaStreamDestination();
                            source.connect(dest);
                            source.connect(audioCtx.destination);
                            audioStream = dest.stream;
                            
                            audioContext = audioCtx;
                            audioSource = source;
                            audioDestination = dest;
                            
                            if (audioCtx.state === 'suspended') await audioCtx.resume();
                        }
                    } catch (iosAudioError) {
                        audioStream = processingVideo.captureStream ? processingVideo.captureStream().getAudioTracks()[0] : null;
                    }
                } else {
                    if (audioContext && audioDestination && audioContext.state === 'suspended') await audioContext.resume();
                    if (audioDestination) audioStream = audioDestination.stream;
                }

                let videoStream;
                if (videoCanvas.captureStream) videoStream = videoCanvas.captureStream(30);
                else if (videoCanvas.mozCaptureStream) videoStream = videoCanvas.mozCaptureStream(30);
                else throw new Error('Canvas captureStream not supported in this browser');

                const combinedStream = new MediaStream();
                videoStream.getVideoTracks().forEach(track => combinedStream.addTrack(track));
                
                if (audioStream) {
                    if (audioStream instanceof MediaStream) {
                        audioStream.getAudioTracks().forEach(track => combinedStream.addTrack(track));
                    } else if (audioStream instanceof MediaStreamTrack) {
                        combinedStream.addTrack(audioStream);
                    }
                }

                const testMimeTypes = isIOSDevice ? [
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
                
                let selectedMimeType = null;
                for (const mimeType of testMimeTypes) {
                    if (MediaRecorder.isTypeSupported(mimeType)) {
                        selectedMimeType = mimeType;
                        if (mimeType.startsWith('video/mp4')) fileExtension = 'mp4';
                        break;
                    }
                }
                
                const recorderOptions = {};
                if (selectedMimeType) recorderOptions.mimeType = selectedMimeType;

                let recorder;
                try {
                    if (isIOSDevice) {
                        try {
                            recorder = new MediaRecorder(combinedStream, {
                                mimeType: 'video/mp4',
                                videoBitsPerSecond: 1000000,
                                audioBitsPerSecond: 128000
                            });
                        } catch (iosError) {
                            recorder = new MediaRecorder(combinedStream, recorderOptions);
                        }
                    } else {
                        recorder = new MediaRecorder(combinedStream, recorderOptions);
                    }
                } catch (e) {
                    try {
                        recorder = new MediaRecorder(combinedStream);
                    } catch (finalError) {
                        reject(new Error('MediaRecorder not supported in this browser'));
                        return;
                    }
                }

                const chunks = [];
                let recordingStarted = false;
                
                recorder.ondataavailable = (event) => {
                    if (event.data.size > 0) chunks.push(event.data);
                };
                
                recorder.onstart = () => { recordingStarted = true; };
                
                recorder.onstop = () => {
                    displayCanvas.classList.add('d-none');
                    videoCanvas.classList.add('d-none');
                    if (chunks.length === 0) {
                        reject(new Error('No video data recorded'));
                        return;
                    }
                    const processedBlob = new Blob(chunks, { type: recorder.mimeType });
                    resolve({ processedBlob, mimeType: recorder.mimeType });
                };
                
                recorder.onerror = (event) => reject(new Error('Recording failed: ' + event.error));

                try {
                    recorder.start(1000);
                } catch (error) {
                    reject(new Error('Failed to start recording: ' + error.message));
                    return;
                }

                const startTimeout = setTimeout(() => {
                    if (!recordingStarted) {
                        recorder.stop();
                        reject(new Error('Recording failed to start within timeout'));
                    }
                }, 5000);

                // Now that recorder is started, play the pre-loaded first video
                await processingVideo.play().catch(e => console.error("Error playing first video", e));

                async function setupVideoSource(isInitial = false) {
                    if (currentItemIndex >= recordings.length) {
                        tailing = true;
                        tailStart = performance.now();

                        lastFrameCanvas = document.createElement('canvas');
                        lastFrameCanvas.width = videoCanvas.width;
                        lastFrameCanvas.height = videoCanvas.height;
                        lastFrameCtx = lastFrameCanvas.getContext('2d', { alpha: false });
                        lastFrameCtx.drawImage(processingVideo, 0, 0, videoCanvas.width, videoCanvas.height);
                        return;
                    }

                    const rec = recordings[currentItemIndex];
                    let blobUrl = null;

                    if (currentPhase === 'remote') {
                        let remoteVideoUrl = null;
                        const configData = window.__currentConfigData || (window.State && window.State.configData);
                        
                        console.log(`[Phase: Remote] Looking for Lesson: ${rec.originalLessonId}, Question Index: ${rec.originalQuestionIndex}`);
                    
                        console.log(`[Phase: Remote] Does configData exist?`, !!configData);
                        console.log(`[Phase: Remote] Did we find the Lesson in JSON?`, configData && configData.lessons ? configData.lessons.find(l => l.lessonId === rec.originalLessonId) : "No configData.lessons");
                    
                        if (configData && configData.lessons) {
                            const lesson = configData.lessons.find(l => l.lessonId === rec.originalLessonId);
                            if (lesson && lesson.questions && lesson.questions[rec.originalQuestionIndex]) {
                                const q = lesson.questions[rec.originalQuestionIndex];
                                const vUrl = q.videoUrl || q.introBackgroundVideoUrl || null;
                                
                                console.log(`[Phase: Remote] Found Target URL in JSON: ${vUrl}`);
                                
                                if (vUrl) {
                                    // 1. Try the preloaded cache first
                                    if (window.preloadedMedia && window.preloadedMedia[vUrl]) {
                                        remoteVideoUrl = window.preloadedMedia[vUrl];
                                        console.log(`[Phase: Remote] Success: Using PRELOADED cache.`);
                                    } 
                                    // 2. THE FIX: Fallback to the live Firebase URL if cache misses!
                                    else {
                                        remoteVideoUrl = `https://firebasestorage.googleapis.com/v0/b/cogdexapptest.appspot.com/o/videos%2F${vUrl}.mp4?alt=media`;
                                        console.log(`[Phase: Remote] Cache miss: Falling back to LIVE URL.`);
                                    }
                                }
                            }
                        }
                    
                        if (remoteVideoUrl) {
                            blobUrl = remoteVideoUrl;
                            console.log(`[Phase: Remote] Successfully attached URL:`, blobUrl);
                        } else {
                            console.warn(`[Phase: Remote] FAILED TO FIND VIDEO. Skipping to webcam.`);
                            currentPhase = 'webcam';
                            return setupVideoSource(isInitial);
                        }
                    } else if (currentPhase === 'webcam') {
                        if (window.__lastWebcamBlobUrl) URL.revokeObjectURL(window.__lastWebcamBlobUrl);
                        blobUrl = URL.createObjectURL(rec.blob);
                        window.__lastWebcamBlobUrl = blobUrl;
                    }

                    processingVideo.src = blobUrl;
                    processingVideo.load();
                    processingVideo.crossOrigin = "anonymous";

                    return new Promise((res, rej) => {
                        processingVideo.onloadedmetadata = async () => {
                            try {
                                // --- Phase 4: Slicing User Video ---
                                if (currentPhase === 'webcam' && rec.meta && rec.meta.trimTimestamps) {
                                    const ts = rec.meta.trimTimestamps;
                                    if (ts.start > 0) {
                                        processingVideo.currentTime = ts.start;
                                        console.log(`[Video Processing] Jumping user video to start: ${ts.start}`);
                                    }
                                }

                                if (!isInitial) await processingVideo.play();
                                res();
                            } catch (e) { rej(e); }
                        };
                        processingVideo.onerror = (e) => {
                            console.error(`[Video Load Error] Phase: ${currentPhase}, Failed to load URL:`, blobUrl, "Video Error State:", processingVideo.error);
                            advancePhase();
                            setupVideoSource(isInitial).then(res).catch(rej);
                        };
                    });
                }

                function advancePhase() {
                    if (currentPhase === 'remote') {
                        currentPhase = 'webcam';
                    } else {
                        currentItemIndex++;
                        
                        // Check if the next recording is a retry of the same question
                        if (currentItemIndex < recordings.length) {
                            const currentRec = recordings[currentItemIndex];
                            const prevRec = recordings[currentItemIndex - 1];
                            
                            if (currentRec.originalQuestionIndex === prevRec.originalQuestionIndex) {
                                // Same question! Skip the remote video and go straight to the next webcam attempt
                                currentPhase = 'webcam';
                            } else {
                                // New question, play the remote video
                                currentPhase = 'remote';
                            }
                        } else {
                            currentPhase = 'remote';
                        }
                    }
                }

                function drawFrame() {
                    try {
                        if (startTimeout) clearTimeout(startTimeout);

                        let shouldAdvance = false;

                        if (!tailing) {
                            if (processingVideo.ended || (processingVideo.paused && processingVideo.currentTime >= processingVideo.duration)) {
                                shouldAdvance = true;
                            } else if (currentPhase === 'webcam') {
                                const rec = recordings[currentItemIndex];
                                if (rec && rec.meta && rec.meta.trimTimestamps) {
                                    if (processingVideo.currentTime >= rec.meta.trimTimestamps.end) {
                                        console.log(`[Video Processing] User video reached trim end timestamp: ${rec.meta.trimTimestamps.end}`);
                                        processingVideo.pause();
                                        shouldAdvance = true;
                                    }
                                }
                            }
                        }

                        if (shouldAdvance) {
                            advancePhase();
                            setupVideoSource().catch(e => console.error(e));
                        }

                        if (tailing && lastFrameCanvas) {
                            canvasContext.drawImage(lastFrameCanvas, 0, 0, videoCanvas.width, videoCanvas.height);
                            displayContext.drawImage(lastFrameCanvas, 0, 0, displayCanvas.width, displayCanvas.height);
                        } else if (!tailing && processingVideo.readyState >= 2) {
                            // Calculate letterbox dimensions
                            const vRatio = videoCanvas.width / videoCanvas.height;
                            const pRatio = processingVideo.videoWidth / processingVideo.videoHeight;
                            let drawW = videoCanvas.width;
                            let drawH = videoCanvas.height;
                            let offsetX = 0;
                            let offsetY = 0;
                            
                            if (pRatio > vRatio) {
                                // Video is wider than canvas (landscape on portrait canvas)
                                drawH = videoCanvas.width / pRatio;
                                offsetY = (videoCanvas.height - drawH) / 2;
                            } else {
                                // Video is taller than canvas
                                drawW = videoCanvas.height * pRatio;
                                offsetX = (videoCanvas.width - drawW) / 2;
                            }
                            
                            // Fill background black for letterboxes
                            canvasContext.fillStyle = '#000';
                            canvasContext.fillRect(0, 0, videoCanvas.width, videoCanvas.height);
                            canvasContext.drawImage(processingVideo, offsetX, offsetY, drawW, drawH);
                            
                            // Same for display canvas
                            const dRatio = displayCanvas.width / displayCanvas.height;
                            let dDrawW = displayCanvas.width;
                            let dDrawH = displayCanvas.height;
                            let dOffsetX = 0;
                            let dOffsetY = 0;
                            
                            if (pRatio > dRatio) {
                                dDrawH = displayCanvas.width / pRatio;
                                dOffsetY = (displayCanvas.height - dDrawH) / 2;
                            } else {
                                dDrawW = displayCanvas.height * pRatio;
                                dOffsetX = (displayCanvas.width - dDrawW) / 2;
                            }
                            
                            displayContext.fillStyle = '#000';
                            displayContext.fillRect(0, 0, displayCanvas.width, displayCanvas.height);
                            displayContext.drawImage(processingVideo, dOffsetX, dOffsetY, dDrawW, dDrawH);
                        }

                        const showFinalOverlay = tailing || (currentItemIndex === recordings.length - 1 && currentPhase === 'webcam');

                        if (showFinalOverlay) {
                            if (overlayReady && overlayImage.naturalWidth > 0) {
                                const xPos = (videoCanvas.width - overlayImage.naturalWidth) / 2;
                                const yPos = 0;
                                canvasContext.drawImage(overlayImage, xPos, yPos);

                                const displayOverlayHeight = Math.round(overlayImage.naturalHeight * (displayCanvas.width / overlayImage.naturalWidth));
                                displayContext.drawImage(overlayImage, 0, 0, overlayImage.naturalWidth, overlayImage.naturalHeight, 0, 0, displayCanvas.width, displayOverlayHeight);
                            } else {
                                const overlayHeight = videoCanvas.height * 0.15;
                                const displayOverlayHeight = displayCanvas.height * 0.15;
                                canvasContext.fillStyle = 'rgba(0,0,0,0.75)';
                                canvasContext.fillRect(0, 0, videoCanvas.width, overlayHeight);
                                displayContext.fillStyle = 'rgba(0,0,0,0.75)';
                                displayContext.fillRect(0, 0, displayCanvas.width, displayOverlayHeight);
                            }

                        }

                        if (fontReady) {
                            const isFirst = currentItemIndex === 0 && !tailing;
                            const rec = recordings[Math.min(currentItemIndex, recordings.length - 1)];
                            let subtitleText = "";
                            
                            // Only set subtitle text if we are NOT showing the final fluency score
                            if (rec && !tailing) {
                                subtitleText = (currentPhase === 'webcam') ? rec.userResponse : rec.cue;
                            }
                            
                            drawTextOverlay(canvasContext, videoCanvas.width, videoCanvas.height, tailing, tailStart, false, fluencyData, isFirst, subtitleText);
                            drawTextOverlay(displayContext, displayCanvas.width, displayCanvas.height, tailing, tailStart, true, fluencyData, isFirst, subtitleText);
                        }

                        if (tailing) {
                            const tailElapsed = performance.now() - tailStart;
                            if (tailElapsed >= 4000) {
                                if (animationId) cancelAnimationFrame(animationId);
                                recorder.stop();
                                return;
                            }
                        }

                        animationId = requestAnimationFrame(drawFrame);
                    } catch (error) {
                        console.error("Error in drawFrame:", error);
                        if (animationId) cancelAnimationFrame(animationId);
                        recorder.stop();
                        reject(error);
                    }
                }

                drawFrame();

            } catch (error) {
                console.error("Error in processVideoSequence:", error);
                reject(error);
            }
        });
    }

    async function downloadVideo() {
        console.log("downloadVideo called");
        try {
            videoBlob = await getLatestVideoFromIndexedDB();
            console.log("Video blob retrieved successfully, size:", videoBlob.size, "type:", videoBlob.type);
            
            // iOS-specific video loading with enhanced error handling
            if (isIOSDevice) {
                console.log("iOS device detected, using special handling");
                
                // Create a new video element for testing to avoid conflicts
                const testVideo = document.createElement('video');
                testVideo.style.display = 'none';
                document.body.appendChild(testVideo);
                
                // Test the blob with a new video element first
                const blobUrl = URL.createObjectURL(videoBlob);
                testVideo.src = blobUrl;
                testVideo.preload = 'auto';
                
                // Add detailed event listeners for debugging
                testVideo.addEventListener('loadeddata', () => {
                    console.log("Test video loadeddata event fired");
                });
                
                testVideo.addEventListener('canplay', () => {
                    console.log("Test video canplay event fired");
                    // If test video works, use the blob for the main video
                    originalVideo.src = blobUrl;
                    originalVideo.load(); // Explicitly call load()
                    processBtn.disabled = false;
                    document.body.removeChild(testVideo);
                    URL.revokeObjectURL(blobUrl);
                });
                
                testVideo.addEventListener('error', (e) => {
                    console.error("Test video error event:", e, {
                        error: testVideo.error,
                        readyState: testVideo.readyState,
                        networkState: testVideo.networkState
                    });
                    
                    // Fallback to creating an object URL with a different approach
                    try {
                        // Try creating a new blob with explicit type
                        const typedBlob = new Blob([videoBlob], { type: 'video/mp4' });
                        const fallbackUrl = URL.createObjectURL(typedBlob);
                        originalVideo.src = fallbackUrl;
                        
                        originalVideo.addEventListener('canplay', () => {
                            console.log("Fallback video loaded successfully");
                            processBtn.disabled = false;
                            URL.revokeObjectURL(fallbackUrl);
                        }, { once: true });
                        
                        originalVideo.addEventListener('error', () => {
                            console.error("Fallback also failed, using default video");
                            originalVideo.src = 'tall.webm';
                            processBtn.disabled = false;
                            URL.revokeObjectURL(fallbackUrl);
                        }, { once: true });
                        
                    } catch (fallbackError) {
                        console.error("Fallback creation failed:", fallbackError);
                        originalVideo.src = 'tall.webm';
                        processBtn.disabled = false;
                    }
                    
                    document.body.removeChild(testVideo);
                    URL.revokeObjectURL(blobUrl);
                });
                
                // Try to load the test video
                testVideo.load();
                
            } else {
                // Non-iOS handling
                const blobUrl = URL.createObjectURL(videoBlob);
                originalVideo.src = blobUrl;
                processBtn.disabled = false;
                console.log("Video loaded successfully on non-iOS device");
            }
            
        } catch (error) {
            console.error('Error loading video from IndexedDB:', error);
            alert('Failed to load video from storage: ' + error.message);
            processBtn.disabled = false;
            
            if (isIOSDevice) {
                console.log("Falling back to default video on iOS");
                originalVideo.src = 'tall.webm';
                
                originalVideo.addEventListener('error', () => {
                    console.error("Error loading fallback video on iOS");
                    processBtn.disabled = false;
                }, { once: true });
                
                originalVideo.addEventListener('canplay', () => {
                    console.log("Fallback video can play on iOS");
                    processBtn.disabled = false;
                }, { once: true });
            }
        }
    }

    // Cache font loading promises
    let fontLoadingPromise = null;
    async function ensureFontsReady() {
        console.log("ensureFontsReady called");
        if (fontLoadingPromise) {
            return fontLoadingPromise;
        }
        
        fontLoadingPromise = (async () => {
            try {
                if (document.fonts && document.fonts.load) {
                    console.log("Loading fonts with FontFace API");
                    const promises = [
                        document.fonts.load('700 24px "Orbitron"'),
                        document.fonts.load('400 24px "Orbitron"'),
                        document.fonts.load('bold 24px "Plus Jakarta Sans"'),
                        document.fonts.load('bold 28px "Plus Jakarta Sans"')
                    ];
                    await Promise.all(promises);
                    if (document.fonts.ready) {
                        await document.fonts.ready;
                    }
                    console.log("Fonts loaded successfully");
                } else {
                    console.log("FontFace API not available, skipping font loading");
                }
                fontReady = true;
            } catch (e) {
                console.error("Error loading fonts:", e);
                fontReady = true;
            }
        })();
        
        return fontLoadingPromise;
    }
    
    // Add detailed logging to processBtn event listener
    if (processBtn) {
        console.log("Adding event listener to process button");
        processBtn.addEventListener('click', processVideo, { once: false });
    } else {
        console.error("Process button not found!");
    }
    
    async function processVideo() {
        console.log("processVideo called");

        // Clear only the playback videos to avoid interfering with originalVideo or others
        const desktopVideo = document.getElementById('playback-video-desktop');
        if (desktopVideo) {
            desktopVideo.pause();
            desktopVideo.src = '';
        }

        const mobileVideo = document.getElementById('playback-video-mobile');
        if (mobileVideo) {
            mobileVideo.pause();
            mobileVideo.src = '';
        }

        const footer = document.querySelector('footer');
        footer.classList.add("d-none");
        try {
            processBtn.disabled = true;
            processBtn.style.display = 'none';
            console.log("Process button disabled and display none");

            displayCanvas.style.display = 'block';

            const currentLessonId = window.__currentProcessingLessonId || 'unknown_lesson';
            const recordings = await getAllSpeechRecordingsForLesson(currentLessonId);

            if (!recordings || recordings.length === 0) {
                throw new Error('No recordings found for this lesson.');
            }
            window.__currentRecordings = recordings;

            // Check if video is properly loaded
            if (originalVideo.readyState < 2) {
                console.log("Waiting for video metadata, readyState:", originalVideo.readyState);
                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        reject(new Error('Video metadata loading timeout'));
                    }, 10000);
                    
                    originalVideo.addEventListener('loadedmetadata', () => {
                        clearTimeout(timeout);
                        resolve();
                    }, { once: true });
                    
                    originalVideo.addEventListener('error', () => {
                        clearTimeout(timeout);
                        reject(new Error('Video loading error'));
                    }, { once: true });
                });
                console.log("Video metadata loaded");
            }

            if (!audioContext) {
                console.log("Creating audio context");
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
                audioDestination = audioContext.createMediaStreamDestination();
                console.log("Audio context created");
            }
            
            if (!audioSource || audioSource.mediaElement !== originalVideo) {
                console.log("Creating audio source");
                if (audioSource) {
                    audioSource.disconnect();
                }
                audioSource = audioContext.createMediaElementSource(originalVideo);
                audioSource.connect(audioDestination);
                audioSource.connect(audioContext.destination);
                console.log("Audio source created and connected");
            }
            
            if (audioContext.state === 'suspended') {
                console.log("Resuming audio context");
                await audioContext.resume();
                console.log("Audio context resumed");
            }
            
            audioStream = audioDestination.stream;
            console.log("Audio stream obtained");

            await ensureFontsReady();

            console.log("Starting video processing sequence");
            let { processedBlob, mimeType } = await processVideoSequence(window.__currentRecordings, fluencyData);
            
            if (!processedBlob) {
                throw new Error('Failed to process video');
            }
            
            console.log("Video processing completed, blob size:", processedBlob.size);
            const url = URL.createObjectURL(processedBlob);
            
            // CREATE THUMBNAIL FROM FINAL FRAME
            let thumbnailUrl = null;
            try {
                const thumbnailBlob = await createThumbnail();
                thumbnailUrl = URL.createObjectURL(thumbnailBlob);
                console.log("Thumbnail created successfully");
            } catch (thumbnailError) {
                console.error("Error creating thumbnail:", thumbnailError);
                // Continue without thumbnail if creation fails
            }
            
            // Calculate maxVideoWidth for result video styling
            const aspectRatio = originalVideo.videoWidth / originalVideo.videoHeight;
            const isPortrait = originalVideo.videoHeight > originalVideo.videoWidth;
            const isMobile = window.innerWidth <= 1000;
            
            let maxVideoWidth;
            if (isMobile && isPortrait) {
                maxVideoWidth = Math.min(150, window.innerWidth * 0.40);
            } else if (isMobile) {
                maxVideoWidth = Math.min(350, window.innerWidth * 0.90);
            } else {
                maxVideoWidth = Math.min(100, window.innerWidth * 0.20);
            }
            
            // Instead of creating a new element with a different ID, reuse the existing one
            resultVideo.src = url;
            resultVideo.controls = true;
            resultVideo.playsInline = true;
            resultVideo.setAttribute('playsinline', '');
            resultVideo.setAttribute('webkit-playsinline', '');
            resultVideo.muted = false;
            resultVideo.preload = 'auto';
            resultVideo.crossOrigin = 'anonymous';

            // Set thumbnail as poster if available
            if (thumbnailUrl) {
                resultVideo.poster = thumbnailUrl;
            }

            // Remove the display canvas
            displayCanvas.style.display = 'none';

            // Show the result video
            resultVideo.classList.remove('d-none');
            resultVideo.style.display = 'block'; // Ensure it's visible

            // Update the styling to match your requirements
            resultVideo.style.position = 'static';
            resultVideo.style.width = '100%';
            resultVideo.style.maxWidth = maxVideoWidth + 'px';
            resultVideo.style.height = 'auto';
            resultVideo.style.margin = '10px auto';
            resultVideo.style.boxSizing = 'border-box';
            resultVideo.style.zIndex = 'auto';
            resultVideo.style.backgroundColor = '#000';

            // Add click-to-play functionality for non-iOS
            if (!isIOSDevice) {
                resultVideo.addEventListener('click', function() {
                    this.paused ? this.play() : this.pause();
                });
            }

            resultVideo.load();

            const suggestedName = `uffenglish.${fileExtension}`;
            processBtnContainer.classList.add('d-none');
            bigButtons.classList.remove('d-none');
            document.body.style.background = "black";
            document.documentElement.style.background = "black";

            // MOVE THESE LINES TO BE SET BEFORE THE SHARE BUTTON LISTENER
            window.__lastProcessedBlob = processedBlob;
            window.__lastProcessedName = suggestedName;

            // Add the share button event listener
            const shareBtn = document.getElementById('shareMp4Btn');
            if (shareBtn) {
                shareBtn.classList.remove('d-none');
                console.log("sharebutton d-none removed!");
                shareBtn.addEventListener('click', async function() {
                    try {
                        await shareVideo(
                            window.__lastProcessedBlob, 
                            window.__lastProcessedName, 
                            fileExtension
                        );
                    } catch (error) {
                        console.error('Share error:', error);
                    }
                });
            }

            processBtn.disabled = false;
            console.log("Process completed successfully");
            
        } catch (error) {
            console.error('Error processing video:', error);
            alert('Error processing video: ' + error.message);
            processBtn.disabled = false;
        }
    }

    // Cleanup function to prevent memory leaks
    function cleanup() {
        console.log("Cleaning up video processor");
        if (animationId) {
            cancelAnimationFrame(animationId);
        }
        
        if (audioContext && audioContext.state !== 'closed') {
            audioContext.close();
        }
        
        if (dbConnection) {
            dbConnection.close();
        }
        
        // Clear caches
        textMetricsCache.clear();
        cachedGradients.clear();
        
        // Revoke any remaining blob URLs
        if (videoBlob && originalVideo.src.startsWith('blob:')) {
            URL.revokeObjectURL(originalVideo.src);
        }
    }
    
    // Add cleanup on page unload
    window.addEventListener('beforeunload', cleanup);

    downloadVideo();

    return processVideo;
}
