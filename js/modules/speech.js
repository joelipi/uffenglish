// modules/speech.js
import Strings from '../data/strings.js';
import { getDeepgramToken } from './api.js';
import { saveSpeechRecording } from './storage.js';
import { State } from './state.js';


// --- NEW: Import Whisper Logic ---
import { transcribeAudioBuffer, preloadWhisperEngine, isEngineReady } from './whisper/app-vad-asr.js';

// --- Constants ---
export const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isWindows = navigator.platform.indexOf('Win') > -1;

// Whisper Gibberish / Hallucination Threshold
const MIN_LOGPROB_THRESHOLD = -1.0;

// --- NEW: URL Routing Logic ---
const urlParams = new URLSearchParams(window.location.search);
const forceDeepgram = urlParams.get('deepgram') === 'true';

// --- State ---
let speechCamStream = null;
let speechCamRecorder = null;
let speechCamChunks = [];
let lastSpeechRecordingId = null;
let webcamPreview = null;

let recognition = null;
export let isListening = false;
let isWhisperActive = false; // Tracks if the local model is running
let recognitionTimeout = null;

let deepgramSocket = null;
let audioContext = null;
let audioProcessor = null;
let mediaStream = null;
let silenceTimer = null;

// --- Utility Functions ---

function getMediaConstraints() {
    return {
      video: {
        aspectRatio: { ideal: 16/9 },
        facingMode: "user",
        ...(isWindows && { aspectRatio: { ideal: 9/16 } })
      },
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: { ideal: 16000 }
      }
    };
}

// --- Webcam Functions ---

export function isWebcamPreviewVisible() {
  return webcamPreview && webcamPreview.isConnected && !webcamPreview.classList.contains('d-none');
}

export function createWebcamPreview() {
  if (webcamPreview) webcamPreview.remove();

  webcamPreview = document.createElement('video');
  webcamPreview.id = 'webcam-preview';
  webcamPreview.autoplay = true;
  webcamPreview.muted = true;
  webcamPreview.playsinline = true;

  // Set opacity:0 BEFORE insertion so CSS never has a chance to render
  // the black background / green border during the animation-delay window.
  webcamPreview.style.opacity = '0';

  const isDesktop = window.innerWidth >= 1200;

  if (isDesktop) {
    const questionsContainer = document.getElementById('questions-container-container');
    if (questionsContainer) questionsContainer.appendChild(webcamPreview);
  } else {
    const overlay = document.querySelector('div#media-container-container');
    if (overlay) {
      overlay.appendChild(webcamPreview);
    } else {
      webcamPreview.style.position = 'fixed';
      webcamPreview.style.bottom = '10px';
      webcamPreview.style.right = '10px';
      document.body.appendChild(webcamPreview);
    }
  }
  return webcamPreview;
}

export function ensureWebcamPreview() {
  if (!speechCamStream) return null;
  if (!webcamPreview || !webcamPreview.isConnected) webcamPreview = createWebcamPreview();

  webcamPreview.srcObject = speechCamStream;

  if (webcamPreview.classList.contains('d-none')) {
    // Reset to invisible before un-hiding so the element doesn't pop in at
    // full opacity (the CSS animation's `forwards` fill kept it at opacity:1).
    webcamPreview.style.transition = '';
    webcamPreview.style.opacity   = '0';
    webcamPreview.style.transform = 'scaleX(-1) translateY(10px)';
    webcamPreview.classList.remove('d-none');

    // Mirror the CSS animation delay + duration so Q2+ matches Q1 behaviour.
    setTimeout(() => {
      webcamPreview.style.transition = 'opacity 0.4s ease-out, transform 0.4s ease-out';
      webcamPreview.style.opacity   = '1';
      webcamPreview.style.transform = 'scaleX(-1) translateY(0)';
    }, 500);
  }

  setTimeout(() => {
    if (isWebcamPreviewVisible() && (webcamPreview.readyState < 2 || webcamPreview.paused)) {
      webcamPreview.play().catch(e => console.log('Play failed:', e));
    }
  }, 100);

  return webcamPreview;
}

export function hideWebcamPreview() {
  if (webcamPreview && webcamPreview.isConnected) webcamPreview.classList.add('d-none');
}

export function removeWebcamPreview() {
  if (webcamPreview) {
    webcamPreview.remove();
    webcamPreview = null;
  }
}

export function safelyStopStream() {
  if (speechCamStream) {
    speechCamStream.getTracks().forEach(t => t.stop());
    speechCamStream = null;
  }
}

export async function warmUpSpeechCamStream() {
  try {
    if (!speechCamStream) speechCamStream = await navigator.mediaDevices.getUserMedia(getMediaConstraints());
    ensureWebcamPreview();
  } catch (err) {
    removeWebcamPreview();
    safelyStopStream();
  }
}

export async function startSpeechCamRecording(micStatusText, userData) {
  console.log('[Recording] startSpeechCamRecording called');
  try {
    // --- MEMORY LEAK FIX: Only request a new stream if one doesn't exist ---
    if (!speechCamStream) {
      speechCamStream = await navigator.mediaDevices.getUserMedia(getMediaConstraints());
      console.log('[Recording] getUserMedia succeeded, tracks:', speechCamStream.getTracks().map(t => `${t.kind}:${t.label}:${t.readyState}`));
    } else {
      console.log('[Recording] Reusing existing warmed-up speechCamStream');
    }
    // ------------------------------------------------------------------------

    ensureWebcamPreview();

    let options = {};
    if (isIOS) {
      if (MediaRecorder.isTypeSupported('video/mp4')) options.mimeType = 'video/mp4';
      else if (MediaRecorder.isTypeSupported('video/mp4;codecs=avc1.42E01E')) options.mimeType = 'video/mp4;codecs=avc1.42E01E';
    } else {
      if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) options.mimeType = 'video/webm;codecs=vp9';
      else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) options.mimeType = 'video/webm;codecs=vp8';
      else options.mimeType = 'video/webm';
    }

    console.log('[Recording] MediaRecorder mimeType selected:', options.mimeType);

    speechCamChunks = [];
    speechCamRecorder = new MediaRecorder(speechCamStream, options);
    console.log('[Recording] MediaRecorder created, state:', speechCamRecorder.state, 'mimeType:', speechCamRecorder.mimeType);

    speechCamRecorder.ondataavailable = (e) => {
      console.log('[Recording] ondataavailable fired, data.size:', e.data?.size);
      if (e.data && e.data.size > 0) speechCamChunks.push(e.data);
      else console.warn('[Recording] ondataavailable: empty or missing data chunk');
    };

    speechCamRecorder.onstart = () => console.log('[Recording] MediaRecorder onstart fired, state:', speechCamRecorder.state);
    speechCamRecorder.onerror = (e) => console.error('[Recording] MediaRecorder onerror:', e.error);

    speechCamRecorder.start();
    console.log('[Recording] MediaRecorder.start() called, state:', speechCamRecorder.state);
  } catch (err) {
    console.error('[Recording] startSpeechCamRecording FAILED:', err);
    alert(Strings.get('alert_media_error', userData?.native_language));
    if (micStatusText) {
        micStatusText.innerHTML = `<i class='bi bi-exclamation-diamond'></i> ${Strings.get('error_media_details', userData?.native_language)}`;
    }
    removeWebcamPreview();
    safelyStopStream();
  }
}

export function stopSpeechCamRecording({ download = true, persist = false, meta = {}, keepStreamAlive = false, playback = true, autoplay = false } = {}) {
  console.log('[Recording] stopSpeechCamRecording called — recorder state:', speechCamRecorder?.state, 'chunks so far:', speechCamChunks.length, 'options:', { download, persist, keepStreamAlive, playback, autoplay });

  try {
    if (speechCamRecorder && speechCamRecorder.state !== 'inactive') {
      return new Promise((resolve) => {
        speechCamRecorder.onstop = async () => {
          console.log('[Recording] onstop fired');
          console.log('[Recording] chunks count:', speechCamChunks.length);
          console.log('[Recording] chunks sizes:', speechCamChunks.map(c => c.size));

          let blobToReturn = null;
          try {
            if (speechCamChunks.length === 0) {
              console.warn('[Recording] No chunks available — resolving null');
              resolve(null);
              return;
            }

            const mime = (speechCamRecorder && speechCamRecorder.mimeType) || 'video/webm';
            console.log('[Recording] Building blob with MIME:', mime);
            const blob = new Blob(speechCamChunks, { type: mime });
            blobToReturn = blob;
            console.log('[Recording] Blob created — size:', blob.size, 'type:', blob.type);

            if (blob.size === 0) {
              console.error('[Recording] Blob size is 0 — something went wrong during recording');
            }

            if (playback && blob.size > 0) {
              console.log('[Recording] Calling setupPlaybackVideo with autoplay:', autoplay);
              await setupPlaybackVideo(blob, autoplay);
              console.log('[Recording] setupPlaybackVideo completed');
            } else {
              console.warn('[Recording] Skipping playback — playback flag:', playback, ', blob.size:', blob.size);
            }

            if (download && blob.size > 0) {
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              const ts = new Date().toISOString().replace(/[:.]/g, '-');
              let ext = 'webm';
              if (mime.includes('mp4')) ext = 'mp4';
              a.href = url;
              a.download = `speech_recording_${ts}.${ext}`;
              document.body.appendChild(a);
              a.click(); a.remove();
              setTimeout(() => URL.revokeObjectURL(url), 10000);
            } else if (persist && blob.size > 0) {
              saveSpeechRecording(blob, meta).then((id) => {
                lastSpeechRecordingId = id;
                console.log('[Recording] saveSpeechRecording resolved, id:', id);
                resolve(blobToReturn);
              }).catch((err) => {
                console.error('[Recording] saveSpeechRecording failed:', err);
                resolve(blobToReturn);
              });
              return;
            }
          } catch (error) {
            console.error('[Recording] Error in onstop handler:', error);
          } finally {
            if (!keepStreamAlive) { removeWebcamPreview(); safelyStopStream(); }
            else hideWebcamPreview();
            speechCamRecorder = null; speechCamChunks = [];
            console.log('[Recording] Cleanup done, resolving blob:', blobToReturn?.size ?? 'null');
            resolve(blobToReturn);
          }
        };

        console.log('[Recording] Calling speechCamRecorder.stop(), current state:', speechCamRecorder.state);
        speechCamRecorder.stop();
      });
    } else {
      console.warn('[Recording] stopSpeechCamRecording: recorder is null or already inactive, state:', speechCamRecorder?.state);
      if (!keepStreamAlive) { removeWebcamPreview(); safelyStopStream(); }
      else hideWebcamPreview();
      return Promise.resolve(null);
    }
  } catch (err) {
    console.error('[Recording] stopSpeechCamRecording threw:', err);
    removeWebcamPreview(); safelyStopStream();
    return Promise.resolve(null);
  } finally {
    speechCamRecorder = null; speechCamChunks = [];
  }
}

async function setupPlaybackVideo(blob, autoplay = false) {
  const isDesktop = window.innerWidth > 1000;
  const videoId = isDesktop ? 'playback-video-desktop' : 'playback-video-mobile';
  const playbackVideo = document.getElementById(videoId);

  console.log('[Playback] setupPlaybackVideo — videoId:', videoId, '| element found:', !!playbackVideo, '| blob.size:', blob.size, '| blob.type:', blob.type, '| autoplay:', autoplay, '| isIOS:', isIOS);

  if (!playbackVideo) {
    console.error('[Playback] FATAL: playbackVideo element not found in DOM for id:', videoId);
    return;
  }

  console.log('[Playback] playbackVideo current src:', playbackVideo.src, '| readyState:', playbackVideo.readyState, '| display:', playbackVideo.style.display);

  try {
    if (playbackVideo.src && playbackVideo.src.startsWith('blob:')) {
      console.log('[Playback] Revoking previous blob URL:', playbackVideo.src);
      URL.revokeObjectURL(playbackVideo.src);
    }

    if (isIOS) {
      console.log('[Playback] iOS path — calling setupIOSBlobPlayback');
      await setupIOSBlobPlayback(playbackVideo, blob);
      console.log('[Playback] setupIOSBlobPlayback resolved');
    } else {
      const url = URL.createObjectURL(blob);
      console.log('[Playback] Created blob URL:', url);
      playbackVideo.src = url;
      console.log('[Playback] Set playbackVideo.src to blob URL');
    }

    const muteToggleId = isDesktop ? 'playback-mute-toggle-desktop' : 'playback-mute-toggle-mobile';
    const muteToggle = document.getElementById(muteToggleId);

    if (muteToggle) {
      muteToggle.classList.remove('d-none');
      
      // Update icon based on current state
      const icon = muteToggle.querySelector('i');
      if (icon) {
        icon.className = State.isPlaybackMuted ? 'bi bi-volume-mute-fill' : 'bi bi-volume-up-fill';
      }

      // Add click listener
      muteToggle.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        State.isPlaybackMuted = !State.isPlaybackMuted;
        playbackVideo.muted = State.isPlaybackMuted;
        if (icon) {
          icon.className = State.isPlaybackMuted ? 'bi bi-volume-mute-fill' : 'bi bi-volume-up-fill';
        }
      };
    }

    playbackVideo.onerror = (e) => {
      console.error('[Playback] playbackVideo onerror fired:', e, '| error code:', playbackVideo.error?.code, '| error message:', playbackVideo.error?.message);
      try {
        console.warn('[Playback] Attempting fallback with video/mp4 blob');
        const fallbackBlob = new Blob(speechCamChunks, { type: 'video/mp4' });
        console.log('[Playback] Fallback blob size:', fallbackBlob.size);
        playbackVideo.src = URL.createObjectURL(fallbackBlob);
      } catch (fallbackError) {
        console.error('[Playback] Fallback also failed:', fallbackError);
      }
    };

    playbackVideo.controls = true;
    playbackVideo.loop = true;
    playbackVideo.autoplay = false;
    playbackVideo.preload = 'auto';
    playbackVideo.muted = State.isPlaybackMuted; // Apply current state

    if (!isIOS) {
      const handleVideoInteraction = function(e) {
        e.preventDefault(); e.stopPropagation();
        requestAnimationFrame(() => {
          if (this.paused && this.readyState >= 2) {
            this.play().catch(e => { this.currentTime = 0; setTimeout(() => this.play().catch(console.error), 100); });
          } else if (!this.paused) this.pause();
        });
      };
      playbackVideo.addEventListener('touchstart', handleVideoInteraction, { passive: false });
      playbackVideo.addEventListener('click', handleVideoInteraction);
      playbackVideo.style.cursor = 'pointer';
    }

    playbackVideo.onloadedmetadata = () => {
  console.log('[Playback] onloadedmetadata fired');

  playbackVideo.style.display = 'block';

  if (autoplay) {
    playbackVideo.play().catch(e => {
      console.warn('[Playback] autoplay failed:', e);
    });
  }
};

    playbackVideo.oncanplay = () => console.log('[Playback] oncanplay fired — readyState:', playbackVideo.readyState);
    playbackVideo.onloadeddata = () => console.log('[Playback] onloadeddata fired — readyState:', playbackVideo.readyState);

  } catch (urlError) {
    console.error('[Playback] setupPlaybackVideo threw:', urlError);
  }
}

async function setupIOSBlobPlayback(videoElement, blob) {
  return new Promise((resolve) => {
    videoElement.controls = true; videoElement.loop = true;
    const url = URL.createObjectURL(blob);
    console.log('[Playback][iOS] Created blob URL:', url);

    videoElement.onerror = () => {
      console.error('[Playback][iOS] onerror on videoElement — trying mp4 fallback');
      try {
        const alternativeBlob = new Blob([blob], { type: 'video/mp4' });
        videoElement.src = URL.createObjectURL(alternativeBlob);
        resolve();
      } catch (fallbackError) {
        console.error('[Playback][iOS] Fallback also failed:', fallbackError);
        resolve();
      }
    };

    videoElement.src = url;
    console.log('[Playback][iOS] Set src, waiting for onloadeddata');
    videoElement.onloadeddata = () => {
      console.log('[Playback][iOS] onloadeddata fired');
      resolve();
    };
    setTimeout(() => {
      console.warn('[Playback][iOS] 2000ms timeout reached, resolving anyway');
      resolve();
    }, 2000);
  });
}

export function clearPlaybackVideo() {
  const mobileVideo = document.getElementById('playback-video-mobile');
  const desktopVideo = document.getElementById('playback-video-desktop');

  console.log('[Playback] clearPlaybackVideo — mobile found:', !!mobileVideo, '| desktop found:', !!desktopVideo);

    [mobileVideo, desktopVideo].forEach(video => {
      if (video) {
        if (video.src && video.src.startsWith('blob:')) URL.revokeObjectURL(video.src);
        video.src = ''; video.style.display = 'none';
        video.onerror = null; video.onloadeddata = null; video.onloadedmetadata = null;
      }
    });

    const mobileToggle = document.getElementById('playback-mute-toggle-mobile');
    const desktopToggle = document.getElementById('playback-mute-toggle-desktop');
    if (mobileToggle) mobileToggle.classList.add('d-none');
    if (desktopToggle) desktopToggle.classList.add('d-none');
  }

// --- NEW: Whisper Local Transcription Setup ---

export async function setupWhisperTranscription(params) {
    const { button, micStatusText } = params;
    console.log('[Whisper] setupWhisperTranscription called, isEngineReady:', isEngineReady);

    if (!isEngineReady) {
        console.warn('[Whisper] Engine not ready yet');
        if (micStatusText) {
            micStatusText.innerHTML = `<div class='text-center text-warning'>
                <i class='bi bi-hourglass-split' style='font-size: 2rem;'></i><br>
                <strong>Loading AI Model...</strong><br>
                <small>Please wait a few seconds and try again.</small>
            </div>`;
        }
        button.style.display = "block";
        button.innerHTML = '<i class="bi bi-mic-fill"></i>';
        return false;
    }

    console.log('[Whisper] Engine ready, proceeding');
    return true;
}


// --- Speech Recognition Functions (Deepgram / WebSpeech) ---

function convertFloat32ToInt16(float32Array) {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return int16Array;
}

export async function setupDeepgramTranscription({
    question, button, userData, configData, currentLessonIndex, currentQuestionIndex, handleAnswer, micStatusText, player
}) {
  console.log('[Deepgram] setupDeepgramTranscription called');
  try {
    const token = await getDeepgramToken();
    console.log('[Deepgram] Got token');

    const { createClient } = deepgram;
    const _deepgram = createClient({ accessToken: token });

    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: 48000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    console.log('[Deepgram] Got audio mediaStream');

    audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
    const source = audioContext.createMediaStreamSource(mediaStream);

    deepgramSocket = _deepgram.listen.live({
      model: "nova-2", punctuate: true, interim_results: true, utterance_end_ms: 1000, smart_format: true, encoding: "linear16", sample_rate: 48000
    });

    let fullTranscript = "";
    let lastSpeechTime = Date.now();

    deepgramSocket.on("open", () => {
      console.log('[Deepgram] Socket opened');
      isListening = true; lastSpeechTime = Date.now();
      audioProcessor = audioContext.createScriptProcessor(4096, 1, 1);

      audioProcessor.onaudioprocess = (event) => {
        if (!isListening) return;
        const inputData = event.inputBuffer.getChannelData(0);
        const int16Data = convertFloat32ToInt16(inputData);
        if (deepgramSocket && isListening) deepgramSocket.send(int16Data.buffer);
      };

      source.connect(audioProcessor); audioProcessor.connect(audioContext.destination);

      silenceTimer = setInterval(() => {
        if (isListening && Date.now() - lastSpeechTime > 5000) {
          if (fullTranscript.trim()) {
            console.log('[Deepgram] Silence timeout — transcript:', fullTranscript.trim());
            stopDeepgramTranscription();
            let speechButton = document.getElementById('speechButton');
            if (speechButton) { speechButton.style.display = "none"; speechButton.innerHTML = '<i class="bi bi-mic-fill"></i>'; speechButton.classList.remove('btn-danger'); }

            stopSpeechCamRecording({
              download: false, persist: true, keepStreamAlive: true, playback: true, autoplay: true,
              meta: {
                lessonId: (configData?.lessons?.[currentLessonIndex]?.lessonId) || null,
                questionIndex: typeof currentQuestionIndex !== 'undefined' ? currentQuestionIndex : null,
                inputType: question?.inputType || null, title: question?.question || null,
              }
            }).then(() => {
              console.log('[Deepgram] stopSpeechCamRecording resolved (silence path), calling handleAnswer');
              handleAnswer(fullTranscript.trim(), question.cue, question, document.getElementById('speechButton'), question.explanation, question.translation, { pauseCount: null, netDuration: fullTranscript.trim() ? Math.max(1, fullTranscript.split(' ').length * 0.4) : null });
            });
          } else {
            console.warn('[Deepgram] Silence timeout but no transcript — stopping early');
            stopListeningEarly(micStatusText, userData, player); button.style.display = "block";
          }
        }
      }, 1000);
    });

    deepgramSocket.on("Results", (data) => {
      try {
        if (data.channel?.alternatives?.[0]) {
          const transcript = data.channel.alternatives[0].transcript;
          if (transcript && transcript.trim()) {
            lastSpeechTime = Date.now();
            if (data.is_final && transcript.trim()) {
              fullTranscript += (fullTranscript ? " " : "") + transcript.trim();
              console.log('[Deepgram] Final transcript segment received:', transcript.trim(), '| full so far:', fullTranscript);
            }
          }
        }
      } catch (parseError) {
        console.error('[Deepgram] Error parsing Results event:', parseError);
      }
    });

    deepgramSocket.on("UtteranceEnd", (data) => {
      console.log('[Deepgram] UtteranceEnd fired, isListening:', isListening, '| fullTranscript:', fullTranscript);
      if (isListening && fullTranscript.trim()) {
        const finalTranscript = fullTranscript.trim();
        setTimeout(() => {
          stopDeepgramTranscription();
          let speechButton = document.getElementById('speechButton');
          if (speechButton) { speechButton.style.display = "none"; speechButton.innerHTML = '<i class="bi bi-mic-fill"></i>'; speechButton.classList.remove('btn-danger'); }

          let answerHandled = false;
          const submitTranscript = (transcriptToSubmit) => {
              if (!answerHandled && transcriptToSubmit) {
                  answerHandled = true;
                  console.log('[Deepgram] submitTranscript called with:', transcriptToSubmit);
                  handleAnswer(transcriptToSubmit, question.cue, question, speechButton, question.explanation, question.translation, { pauseCount: null, netDuration: transcriptToSubmit ? Math.max(1, transcriptToSubmit.split(' ').length * 0.4) : null });
              }
          };

          stopSpeechCamRecording({
            download: false, persist: true, keepStreamAlive: true, playback: true, autoplay: true,
            meta: {
              lessonId: (configData?.lessons?.[currentLessonIndex]?.lessonId) || null,
              questionIndex: typeof currentQuestionIndex !== 'undefined' ? currentQuestionIndex : null,
              inputType: question?.inputType || null, title: question?.question || null,
            }
          }).then(() => {
            console.log('[Deepgram] stopSpeechCamRecording resolved (UtteranceEnd path)');
            let processedTranscript = finalTranscript.replace(/\s+(I|a|an|the|and|or)$/i, '');
            submitTranscript(processedTranscript || finalTranscript);
          }).catch((error) => {
            console.error('[Deepgram] stopSpeechCamRecording rejected:', error);
            submitTranscript(finalTranscript);
          });
          setTimeout(() => {
            console.warn('[Deepgram] 1000ms safety timeout fired for submitTranscript');
            submitTranscript(finalTranscript);
          }, 1000);
        }, 300);
      }
    });

    deepgramSocket.on("error", (error) => { console.error('[Deepgram] Socket error:', error); });
    deepgramSocket.on("close", (event) => { console.log('[Deepgram] Socket closed:', event); isListening = false; cleanupDeepgram(); });

    return true;

  } catch (error) {
    console.error('[Deepgram] setupDeepgramTranscription failed:', error);
    alert(Strings.get('alert_speech_setup_error', userData?.native_language));
    cleanupDeepgram();
    return false;
  }
}

export function cleanupDeepgram() {
  if (deepgramSocket) { try { deepgramSocket.finish(); } catch (e) {} deepgramSocket = null; }
  if (silenceTimer) { clearInterval(silenceTimer); silenceTimer = null; }
  if (audioProcessor) { audioProcessor.disconnect(); audioProcessor = null; }
  if (audioContext) { audioContext.close(); audioContext = null; }
  if (mediaStream) { mediaStream.getTracks().forEach(track => track.stop()); mediaStream = null; }
  isListening = false;
}

export function stopListeningEarly(micStatusText, userData, player) {
  console.warn('[Speech] stopListeningEarly called');
  stopDeepgramTranscription();
  if(player){player.play();}
  document.getElementById('media-container')?.classList.remove('d-none');
  if (micStatusText) {
    micStatusText.innerHTML = `<div class='text-center' style='color: red; font-size: large;'><i class='bi bi-exclamation-triangle-fill'></i> ${Strings.get('try_again_speech', userData?.native_language)}</div>`;
  }
}

// --- UPDATED: Stop function now halts whichever engine is running ---
export function stopDeepgramTranscription() {
  console.log('[Speech] stopDeepgramTranscription called');
  cleanupDeepgram();

  if (isWhisperActive) {
      stopWhisperEngine();
      isWhisperActive = false;
  }

  let speechButton = document.getElementById('speechButton');
  if (speechButton) {
    speechButton.innerHTML = '<i class="bi bi-mic-fill"></i>';
    speechButton.classList.remove('btn-danger');
  }
}

export function fallbackToWebSpeech({ question, userData, configData, currentLessonIndex, currentQuestionIndex, handleAnswer, micStatusText }) {
  console.log('[WebSpeech] fallbackToWebSpeech called');
  recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = 'en-US';

  const isAndroid = /Android/.test(navigator.userAgent);
  if (isAndroid) {
    recognition.continuous = false;
    recognition.maxAlternatives = 1;
  }

  recognition.onstart = () => {
    console.log('[WebSpeech] recognition.onstart');
    clearTimeout(recognitionTimeout);
    isListening = true;
    let speechButton = document.getElementById('speechButton');
    if (speechButton) {
      speechButton.innerHTML = '<i class="bi bi-mic-mute-fill"></i>';
      speechButton.classList.add('btn-danger');
    }
  };

  recognition.onend = () => {
    console.log('[WebSpeech] recognition.onend — calling stopSpeechCamRecording');
    isListening = false;
    let speechButton = document.getElementById('speechButton');
    if (speechButton) {
      speechButton.innerHTML = '<i class="bi bi-mic-fill"></i>';
      speechButton.classList.remove('btn-danger');
    }

    stopSpeechCamRecording({
      download: false, persist: true, keepStreamAlive: true, playback: true, autoplay: true,
      meta: {
        lessonId: (configData && configData.lessons && configData.lessons[currentLessonIndex] && configData.lessons[currentLessonIndex].lessonId) || null,
        questionIndex: typeof currentQuestionIndex !== 'undefined' ? currentQuestionIndex : null,
        inputType: (question && question.inputType) || null,
        title: (question && question.question) || null,
      }
    }).catch((err) => { console.error('[WebSpeech] stopSpeechCamRecording in onend failed:', err); });
    recognition = null;
  };

  recognition.onerror = (event) => {
    console.error('[WebSpeech] recognition.onerror:', event.error);
    isListening = false;
    let speechButton = document.getElementById('speechButton');
    if (speechButton) {
      speechButton.innerHTML = '<i class="bi bi-mic-fill"></i>';
      speechButton.classList.remove('btn-danger');
    }

    if (micStatusText) {
      if (event.error === 'NotAllowedError') {
        micStatusText.innerHTML = `<div class='text-center'>${Strings.get('error_mic_permissions', userData?.native_language)}</div>`;
      } else if (event.error === 'network') {
        micStatusText.innerHTML = `<div class='text-center'>${Strings.get('error_internet', userData?.native_language)}</div>`;
      } else {
        micStatusText.innerHTML = Strings.get('error_speech_generic', userData?.native_language);
      }
    }
  };

  recognition.onresult = ((currentQuestion) => (event) => {
    recognition.stop();
    let finalTranscript = '';
    const isAndroid = /Android/.test(navigator.userAgent);

    if (isAndroid) {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript = event.results[i][0].transcript;
          break;
        }
      }
    } else {
      if (event.results && event.results[0] && event.results[0][0]) {
        finalTranscript = event.results[0][0].transcript;
      }
    }

    console.log('[WebSpeech] onresult — finalTranscript:', finalTranscript);

    if (finalTranscript) {
      handleAnswer(finalTranscript, currentQuestion.cue, currentQuestion, document.getElementById('speechButton'), currentQuestion.explanation, currentQuestion.translation, { pauseCount: null, netDuration: finalTranscript ? Math.max(1, finalTranscript.split(' ').length * 0.4) : null });
    } else {
      console.warn('[WebSpeech] onresult — empty transcript');
      if (micStatusText) {
          micStatusText.innerHTML = `<div class='text-center'>${Strings.get('try_again_speech', userData?.native_language)}</div>`;
      }
    }

    let speechButton = document.getElementById('speechButton');
    if (speechButton) speechButton.style.display = "none";
  })(question);

  startRecognitionWithTimeout(micStatusText, userData);
}

export function startRecognitionWithTimeout(micStatusText, userData) {
  const isAndroid = /Android/.test(navigator.userAgent);
  console.log('[WebSpeech] startRecognitionWithTimeout — isAndroid:', isAndroid);
  recognition.start();

  if (micStatusText) {
    micStatusText.innerHTML = `<i class='bi bi-mic-fill'></i> ${Strings.get('status_speak', userData?.native_language)}`;
  }

  recognitionTimeout = setTimeout(() => {
    if (!isListening) {
      console.warn('[WebSpeech] recognitionTimeout fired — restarting recognition');
      recognition.stop();
      setTimeout(() => {
        recognition.start();
        if (micStatusText) micStatusText.innerHTML = `<i class='bi bi-mic-fill'></i> ${Strings.get('status_speak', userData?.native_language)}`;
      }, isAndroid ? 1000 : 500);
    }
  }, isAndroid ? 8000 : 5000);
}

// --- UPDATED: The Core Toggle Routing Function ---
export async function toggleSpeechRecognition(params) {
  const { button, question, micStatusText, userData, configData, currentLessonIndex, currentQuestionIndex, handleAnswer, player } = params;
  const wasManuallyStopped = isListening;
  console.log('[Toggle] toggleSpeechRecognition called — isListening:', isListening, '| question.inputType:', question?.inputType, '| question.videoUrl:', question?.videoUrl);

  // Pass the player object down to our updated function
  pauseVideoIfPlaying(player);

  const urlParams = new URLSearchParams(window.location.search);
  const forceDeepgram = urlParams.get('deepgram') === 'true';
  console.log('[Toggle] forceDeepgram:', forceDeepgram);

  if (!isListening) {
      if (micStatusText) {
        micStatusText.innerHTML = `<div class="text-center"><div class="mb-0" style="color: green; font-size: 30px;"><i class="bi bi-mic" style="color: green; font-size: 100px !important;"></i><br>${Strings.get('status_speak', userData?.native_language)}</div></div>`;
      }

    try {
      // Check if the recorder needs to be initialized, regardless of whether 
      // the camera stream itself was already warmed up.
      if (!speechCamRecorder || speechCamRecorder.state === 'inactive') {
        console.log('[Toggle] No active recorder found — calling startSpeechCamRecording');
        await startSpeechCamRecording(micStatusText, userData);
      }
    } catch (e) {
      console.error('[Toggle] startSpeechCamRecording threw during toggle:', e);
    }

    button.style.display = "none";
    let transcriptionSuccess = false;

    if (forceDeepgram) {
        console.log('[Toggle] URL parameter override: Using Deepgram');
        transcriptionSuccess = await setupDeepgramTranscription(params);
    } else {
        console.log('[Toggle] Using local Whisper WebAssembly');
        transcriptionSuccess = await setupWhisperTranscription(params);

        if (!transcriptionSuccess && isEngineReady) {
            console.warn('[Toggle] Whisper failed to initialize. Falling back to Deepgram.');
            transcriptionSuccess = await setupDeepgramTranscription(params);
        }
    }

    console.log('[Toggle] transcriptionSuccess:', transcriptionSuccess);

    if (transcriptionSuccess) {
      isListening = true;
      let speechButton = document.getElementById('speechButton');
      if (speechButton) {
        speechButton.style.display = "block";
        speechButton.innerHTML = '<i class="bi bi-mic-mute-fill"></i>';
        speechButton.classList.add('btn-danger');
      }
    } else {
      if (micStatusText && forceDeepgram) micStatusText.innerHTML = `<div class='text-center'>${Strings.get('status_connecting', userData?.native_language)}</div>`;
      if (forceDeepgram) fallbackToWebSpeech(params);
    }
  } else {
    // --- THE USER CLICKED STOP ---
    console.log('[Toggle] User clicked STOP');
    isListening = false;

    button.style.display = "none";
    document.getElementById('media-container')?.classList.add('d-none');

    if (micStatusText) {
        micStatusText.innerHTML = `<div class='text-center text-warning mt-3'><div class="spinner-border spinner-border-sm" role="status"></div> Analyzing Speech...</div>`;
    }

    if (forceDeepgram) {
        console.log('[Toggle] Stopping Deepgram transcription');
        stopDeepgramTranscription();
    } else {
        // --- THE OFFLINE WORKFLOW ---
        console.log('[Toggle] Whisper path — calling stopSpeechCamRecording');
        console.log('[Toggle] speechCamRecorder state at stop:', speechCamRecorder?.state);
        console.log('[Toggle] speechCamChunks at stop:', speechCamChunks.length);

        stopSpeechCamRecording({
            download: false, persist: true, keepStreamAlive: true, playback: true, autoplay: true,
            meta: {
              lessonId: (configData?.lessons?.[currentLessonIndex]?.lessonId) || null,
              questionIndex: typeof currentQuestionIndex !== 'undefined' ? currentQuestionIndex : null,
              inputType: question?.inputType || null, title: question?.question || null,
            }
        }).then(async (videoBlob) => {
            console.log('[Toggle] stopSpeechCamRecording resolved — videoBlob:', videoBlob?.size ?? 'null');
            await new Promise(r => setTimeout(r, 250));

            if (!videoBlob) {
                console.warn('[Toggle] No videoBlob returned — calling stopListeningEarly');
                stopListeningEarly(micStatusText, userData, player);
                return;
            }

            try {
                console.log('[Toggle] Extracting audio from blob, size:', videoBlob.size);
                const extractionResult = await extractAudioFromBlob(videoBlob);
                const audioData = extractionResult.trimmed;
                const stats = { pauseCount: extractionResult.pauseCount, netDuration: extractionResult.netDuration };
                // ... previous extraction code ...
                console.log('[Toggle] Audio extracted, samples:', audioData.length);

                // UPDATED: Expecting an object with metadata from Whisper now
                const whisperResult = await transcribeAudioBuffer(audioData);
                console.log('[Toggle] Whisper raw result:', whisperResult);

                // Extract text and logprob fallback
                const finalTranscript = typeof whisperResult === 'string' ? whisperResult : whisperResult.text;
                const logprob = whisperResult.avg_logprob !== undefined ? whisperResult.avg_logprob : 0; 

                if (finalTranscript) {
                    // NEW: The Gibberish Gate
                    if (logprob < MIN_LOGPROB_THRESHOLD) {
                        console.warn(`[Toggle] 🛑 Gibberish detected! avg_logprob (${logprob}) is below threshold (${MIN_LOGPROB_THRESHOLD})`);
                        
                        // Inform the user the audio was unintelligible
                        if (micStatusText) {
                            micStatusText.innerHTML = `<div class='text-center mt-3' style='color: #ff9800; font-size: large;'><i class='bi bi-ear-x'></i> Audio unclear. Please try speaking clearly.</div>`;
                        }
                        
                        // Halt the pipeline (pass null so stopListeningEarly doesn't overwrite our custom UI message)
                        stopListeningEarly(null, userData, player);
                        return;
                    }

                    // Proceed to normal NLP checking if it passes the gate
                    let processedTranscript = finalTranscript.replace(/\s+(I|a|an|the|and|or)$/i, '');
                    console.log('[Toggle] Processed transcript:', processedTranscript);

                    // --- NEW REVIEW STEP ---
                    const transcriptToReview = processedTranscript || finalTranscript;
                    let timeLeft = 7;
                    let reviewActive = true;

                    if (micStatusText) {
                        micStatusText.innerHTML = `
                            <div class='text-center mt-3 p-3 bg-dark rounded border border-secondary shadow-sm'>
                                <div style='font-size: 1.1rem; color: #fff; margin-bottom: 15px;'>
                                    <small class="text-muted d-block mb-1">Whisper heard:</small>
                                    <strong>"${transcriptToReview}"</strong>
                                </div>
                                <div class="d-flex justify-content-center gap-3">
                                    <button id="rejectBtn" class="btn btn-outline-danger px-4">
                                        <i class="bi bi-arrow-repeat"></i> Re-record
                                    </button>
                                    <button id="acceptBtn" class="btn btn-success px-4">
                                        <i class="bi bi-check-circle"></i> Accept (<span id="reviewTimer">${timeLeft}</span>s)
                                    </button>
                                </div>
                                <div class="progress mt-3" style="height: 5px; background-color: #333;">
                                    <div id="reviewProgressBar" class="progress-bar bg-success" role="progressbar" style="width: 100%; transition: width 7s linear;"></div>
                                </div>
                            </div>`;
                    }

                    const acceptTranscript = () => {
                        if (!reviewActive) return;
                        reviewActive = false;
                        clearInterval(timerInterval);
                        if (micStatusText) micStatusText.innerHTML = "";
                        handleAnswer(transcriptToReview, question.cue, question, button, question.explanation, question.translation, stats);
                    };

                    const rejectTranscript = () => {
                        if (!reviewActive) return;
                        reviewActive = false;
                        clearInterval(timerInterval);
                        
                        // FIX: Clean up the lingering DOM video elements
                        clearPlaybackVideo(); 
                        removeWebcamPreview(); 

                        // Fire an event to script.js to deduct 20 points from the speaking score
                        window.dispatchEvent(new CustomEvent('transcriptRejected'));
                        
                        if (micStatusText) {
                            micStatusText.innerHTML = `<div class='text-center text-warning mt-3'><div class="spinner-border spinner-border-sm" role="status"></div> Restarting Mic...</div>`;
                        }
                        
                        // Automatically restart the mic recording state
                        setTimeout(() => {
                            isListening = false;
                            toggleSpeechRecognition(params);
                        }, 600);
                    };

                    // Add button listeners and trigger the CSS animation
                    setTimeout(() => {
                        document.getElementById('acceptBtn')?.addEventListener('click', acceptTranscript);
                        document.getElementById('rejectBtn')?.addEventListener('click', rejectTranscript);
                        
                        // Trigger the 3-second CSS shrink animation
                        const bar = document.getElementById('reviewProgressBar');
                        if (bar) {
                            // Small delay ensures the browser registers the initial 100% width before shrinking
                            requestAnimationFrame(() => {
                                bar.style.width = '0%';
                            });
                        }
                    }, 50);

                    // Start the countdown timer for the text interval
                    const timerInterval = setInterval(() => {
                        if (!reviewActive) return clearInterval(timerInterval);
                        timeLeft--;
                        const timerSpan = document.getElementById('reviewTimer');
                        if (timerSpan) timerSpan.innerText = timeLeft;
                        
                        // Auto-accept when timer hits 0
                        if (timeLeft <= 0) {
                            acceptTranscript();
                        }
                    }, 1000);

                } else {
                    console.warn('[Toggle] Empty transcript from Whisper — calling stopListeningEarly');

                    stopListeningEarly(micStatusText, userData, player);
                }
            } catch (error) {
                console.error('[Toggle] Audio extraction/transcription failed:', error);
                stopListeningEarly(micStatusText, userData, player);
            }
        });
    }

    button.innerHTML = '<i class="bi bi-mic-fill"></i>';
    button.classList.remove('btn-danger');
  }
}

function pauseVideoIfPlaying(playerInstance) {
  // 1. Instance approach: keeps player UI/internal state in sync
  if (playerInstance) {
    if (typeof playerInstance.pause === 'function') {
      playerInstance.pause();
    } else if (playerInstance.video && !playerInstance.video.paused) {
      playerInstance.video.pause();
    }
  }

  // 2. DOM Fallback: Catch ALL .ivp-video elements, not just the first one
  const videoElements = document.querySelectorAll('video.ivp-video');
  videoElements.forEach(video => {
    if (!video.paused) {
      video.pause();
    }
  });
}

export function initLocalVoiceAI() {
    const forceDeepgram = new URLSearchParams(window.location.search).get('deepgram') === 'true';
    console.log('[Whisper] initLocalVoiceAI — forceDeepgram:', forceDeepgram);
    
    if (!forceDeepgram) {
        // Return the promise from preloadWhisperEngine so the caller can await it
        return preloadWhisperEngine();
    } else {
        // Even when skipping, return a resolved promise to maintain the same interface
        console.log('[Whisper] Deepgram override – skipping Whisper preload.');
        return Promise.resolve();
    }
}

async function extractAudioFromBlob(blob) {
    console.log('[Audio] extractAudioFromBlob — blob.size:', blob.size, 'blob.type:', blob.type);

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const arrayBuffer = await blob.arrayBuffer();

    try {
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        const raw = audioBuffer.getChannelData(0);

        // --- NEW: trim silence ---
        const trimResult = trimSilenceWithPadding(raw, {
          threshold: 0.02,
          preRoll: 0.3,
          postRoll: 0.3,
          sampleRate: audioBuffer.sampleRate
        });

        await audioCtx.close();

        console.log('[Audio] Trimmed samples:', trimResult.trimmed.length);
        return trimResult;

    } catch (e) {
        console.error('[Audio] decodeAudioData FAILED:', e);
        if (audioCtx.state !== 'closed') await audioCtx.close();
        throw e;
    }
}

function trimSilenceWithPadding(data, {
    threshold = 0.01,
    preRoll = 0.2,
    postRoll = 0.2,
    sampleRate = 16000
} = {}) {
    let start = 0;
    let end = data.length - 1;

    // Find first speech
    while (start < data.length && Math.abs(data[start]) < threshold) {
        start++;
    }

    // Find last speech
    while (end > start && Math.abs(data[end]) < threshold) {
        end--;
    }

    if (start >= end) {
        console.warn('[Trim] No speech detected, returning original');
        return { trimmed: data, pauseCount: 0, netDuration: data.length / sampleRate };
    }

    // Phase 1: Count pauses within the bounded speech segment
    let pauseCount = 0;
    let inPause = false;
    let pauseLength = 0;
    const pauseThresholdFrames = sampleRate; // e.g., 1 second of silence

    for (let i = start; i <= end; i++) {
        if (Math.abs(data[i]) < threshold) {
            if (!inPause) {
                inPause = true;
                pauseLength = 1;
            } else {
                pauseLength++;
            }
        } else {
            if (inPause) {
                if (pauseLength >= pauseThresholdFrames) {
                    pauseCount++;
                }
                inPause = false;
                pauseLength = 0;
            }
        }
    }
    // Check if it ends with a long pause
    if (inPause && pauseLength >= pauseThresholdFrames) {
        pauseCount++;
    }

    // Apply padding
    const preSamples = Math.floor(preRoll * sampleRate);
    const postSamples = Math.floor(postRoll * sampleRate);

    start = Math.max(0, start - preSamples);
    end = Math.min(data.length - 1, end + postSamples);

    console.log(`[Trim] start=${start}, end=${end}, total=${data.length}`);

    const trimmed = data.slice(start, end + 1);
    const netDuration = trimmed.length / sampleRate;

    return { trimmed, pauseCount, netDuration };
}