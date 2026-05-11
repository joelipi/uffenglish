// modules/speech.web.js
import Strings from '../data/strings.js';
import { getDeepgramToken } from './api.js';
import { saveSpeechRecording, updateSpeechRecording } from './storage.js';
import { State } from './state.js';
import swearjar from './swearjar.js';
import { validateAnswerPrecheck } from './answers.js';
import * as ui from '../components/ui.js';


// --- NEW: Import Whisper Logic ---
import { transcribeAudioBuffer, preloadWhisperEngine, isEngineReady } from '../workers/whisper/app-vad-asr-web.js';

// --- Constants ---
export const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isWindows = navigator.platform.indexOf('Win') > -1;

// Whisper Gibberish / Hallucination Threshold
const MIN_LOGPROB_THRESHOLD = -1.0;

// --- NEW: URL Routing Logic ---
const urlParams = new URLSearchParams(window.location.search);
const forceDeepgram = urlParams.get('deepgram') === 'true';

// --- State ---
let localRawAudioChunks = [];
let localAudioContext = null;
let localAudioProcessor = null;

let speechCamStream = null;
let speechCamRecorder = null;
let speechCamChunks = [];
let lastSpeechRecordingId = null;
let isPlaceholderStream = false;

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
      aspectRatio: { ideal: 16 / 9 },
      facingMode: "user",
      ...(isWindows && { aspectRatio: { ideal: 9 / 16 } })
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


export function safelyStopStream() {
  if (speechCamStream) {
    speechCamStream.getTracks().forEach(t => t.stop());
    speechCamStream = null;
  }
  isPlaceholderStream = false;
}

async function createPlaceholderStream() {
  console.log('[Recording] Creating placeholder stream');
  const audioStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      sampleRate: { ideal: 16000 }
    }
  });

  const canvas = document.createElement('canvas');

  // Exact same dimensions as ideal constraints
  if (isWindows) {
    canvas.width = 480;
    canvas.height = 854; // 9:16
  } else {
    canvas.width = 854;
    canvas.height = 480; // 16:9
  }

  const ctx = canvas.getContext('2d');

  function draw() {
    // Neutral dark gray background
    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const baseSize = Math.min(canvas.width, canvas.height);

    // Draw Silhouette Avatar Icon
    ctx.fillStyle = '#444444';

    // Head
    const headRadius = baseSize * 0.15;
    ctx.beginPath();
    ctx.arc(centerX, centerY - headRadius * 0.4, headRadius, 0, Math.PI * 2);
    ctx.fill();

    // Shoulders/Torso
    const torsoWidth = baseSize * 0.5;
    const torsoHeight = baseSize * 0.3;
    ctx.beginPath();
    // Drawing an arc for the shoulders
    ctx.ellipse(centerX, centerY + headRadius * 1.5, torsoWidth / 2, torsoHeight, 0, Math.PI, 0);
    ctx.fill();

    // Subtle "Webcam Off" text
    ctx.fillStyle = '#666666';
    ctx.font = `bold ${Math.round(baseSize * 0.05)}px Arial`;
    ctx.textAlign = 'center';
    ctx.fillText('WEBCAM OFF', centerX, canvas.height - (baseSize * 0.1));
  }

  draw();

  const canvasStream = canvas.captureStream(5);
  const mixedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...audioStream.getAudioTracks()
  ]);

  const interval = setInterval(() => {
    if (speechCamStream && isPlaceholderStream) {
      draw();
    } else {
      clearInterval(interval);
    }
  }, 1000);

  return mixedStream;
}

async function ensureSpeechCamStream() {
  const wantsPlaceholder = !!State.isCameraOff;

  if (speechCamStream) {
    if (isPlaceholderStream === wantsPlaceholder) {
      return speechCamStream;
    }
    console.log('[Recording] Camera preference changed, switching stream type');
    safelyStopStream();
  }

  if (wantsPlaceholder) {
    speechCamStream = await createPlaceholderStream();
    isPlaceholderStream = true;
  } else {
    speechCamStream = await navigator.mediaDevices.getUserMedia(getMediaConstraints());
    isPlaceholderStream = false;
  }
  return speechCamStream;
}

export async function warmUpSpeechCamStream() {
  try {
    await ensureSpeechCamStream();
    ui.ensureWebcamPreview(speechCamStream);
  } catch (err) {
    console.error('[Recording] warmUpSpeechCamStream failed:', err);
    ui.removeWebcamPreview();
    safelyStopStream();
  }
}

export async function startSpeechCamRecording(micStatusText, userData) {
  console.log('[Recording] startSpeechCamRecording called');
  try {
    // --- MEMORY LEAK FIX: Only request a new stream if one doesn't exist ---
    await ensureSpeechCamStream();
    console.log('[Recording] ensureSpeechCamStream succeeded, tracks:', speechCamStream.getTracks().map(t => `${t.kind}:${t.label}:${t.readyState}`));
    // ------------------------------------------------------------------------

    ui.ensureWebcamPreview(speechCamStream);

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

    speechCamRecorder.onstart = () => {
      if (speechCamRecorder) console.log('[Recording] MediaRecorder onstart fired, state:', speechCamRecorder.state);
    };
    speechCamRecorder.onerror = (e) => console.error('[Recording] MediaRecorder onerror:', e.error);

    speechCamRecorder.start();
    console.log('[Recording] MediaRecorder.start() called, state:', speechCamRecorder.state);
  } catch (err) {
    console.error('[Recording] startSpeechCamRecording FAILED:', err);
    alert(Strings.get('alert_media_error', userData?.native_language));

    ui.setMicStatusText(`<i class='bi bi-exclamation-diamond'></i> ${Strings.get('error_media_details', userData?.native_language)}`);

    ui.removeWebcamPreview();
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
            if (!keepStreamAlive) { ui.removeWebcamPreview(); safelyStopStream(); }
            else ui.hideWebcamPreview();
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
      if (!keepStreamAlive) { ui.removeWebcamPreview(); safelyStopStream(); }
      else ui.hideWebcamPreview();
      return Promise.resolve(null);
    }
  } catch (err) {
    console.error('[Recording] stopSpeechCamRecording threw:', err);
    ui.removeWebcamPreview(); safelyStopStream();
    return Promise.resolve(null);
  } finally {
    speechCamRecorder = null; speechCamChunks = [];
  }
}

async function setupPlaybackVideo(blob, autoplay = false) {
  await ui.setupPlaybackVideo(blob, autoplay, speechCamChunks);
}

// --- NEW: Whisper Local Transcription Setup ---

export function startLocalAudioTap(stream) {
  console.log('[Audio Tap] Starting real-time 16kHz audio tap');
  localRawAudioChunks = [];

  // Whisper requires exactly 16000Hz
  localAudioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
  const source = localAudioContext.createMediaStreamSource(stream);
  localAudioProcessor = localAudioContext.createScriptProcessor(4096, 1, 1);

  localAudioProcessor.onaudioprocess = (event) => {
    // Copy the Float32 data so it isn't garbage collected
    const inputData = event.inputBuffer.getChannelData(0);
    localRawAudioChunks.push(new Float32Array(inputData));
  };

  source.connect(localAudioProcessor);
  localAudioProcessor.connect(localAudioContext.destination);
}

export function stopLocalAudioTap() {
  console.log('[Audio Tap] Stopping tap and flattening chunks');
  if (localAudioProcessor) {
    localAudioProcessor.disconnect();
    localAudioContext.close();
    localAudioProcessor = null;
    localAudioContext = null;
  }

  // Flatten the chunks into a single Float32Array for Whisper
  const totalLength = localRawAudioChunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const flattenedAudio = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of localRawAudioChunks) {
    flattenedAudio.set(chunk, offset);
    offset += chunk.length;
  }

  localRawAudioChunks = []; // Free memory
  return flattenedAudio;
}

export async function setupWhisperTranscription(params) {
  const { button, micStatusText } = params;
  console.log('[Whisper] setupWhisperTranscription called, isEngineReady:', isEngineReady);

  if (!isEngineReady) {
    console.warn('[Whisper] Engine not ready yet');
    ui.setMicStatusText(`<div class='text-center text-warning'>
                <i class='bi bi-hourglass-split' style='font-size: 2rem;'></i><br>
                <strong>Loading AI Model...</strong><br>
                <small>Please wait a few seconds and try again.</small>
            </div>`);
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

// IMPORTANT: THIS IS HERE AS A DEVELOPMENT FALLBACK ONLY. IT IS TOO EXPENSIVE FOR PRODUCTION AND WOULD REQUIRE REARCHITECTING TO WORK IN DEVELOPMENT.
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
            ui.hideContinueButton(); // Or whatever button state is needed

            stopSpeechCamRecording({
              download: false, persist: true, keepStreamAlive: true, playback: true, autoplay: true,
              meta: {
                lessonId: (configData?.lessons?.[currentLessonIndex]?.lessonId) || null,
                questionIndex: typeof currentQuestionIndex !== 'undefined' ? currentQuestionIndex : null,
                inputType: question?.inputType || null, title: question?.question || null,
              }
            }).then(() => {
              console.log('[Deepgram] stopSpeechCamRecording resolved (silence path), calling handleAnswer');
              handleAnswer(fullTranscript.trim(), question.cue, question, document.getElementById('speechButton'), question.explanation, question.translation, { pauseCount: null, netDuration: fullTranscript.trim() ? Math.max(1, fullTranscript.split(' ').length * 0.4) : null }, userData, configData);
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

          let answerHandled = false;
          const submitTranscript = (transcriptToSubmit) => {
            if (!answerHandled && transcriptToSubmit) {
              answerHandled = true;
              console.log('[Deepgram] submitTranscript called with:', transcriptToSubmit);
              handleAnswer(transcriptToSubmit, question.cue, question, speechButton, question.explanation, question.translation, { pauseCount: null, netDuration: transcriptToSubmit ? Math.max(1, transcriptToSubmit.split(' ').length * 0.4) : null }, userData, configData);
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
// IMPORTANT: THIS IS HERE AS A DEVELOPMENT FALLBACK ONLY. IT IS TOO EXPENSIVE FOR PRODUCTION AND WOULD REQUIRE REARCHITECTING TO WORK IN DEVELOPMENT.

// IMPORTANT: THIS IS HERE AS A DEVELOPMENT FALLBACK ONLY. IT IS TOO EXPENSIVE FOR PRODUCTION AND WOULD REQUIRE REARCHITECTING TO WORK IN DEVELOPMENT.
export function cleanupDeepgram() {
  if (deepgramSocket) { try { deepgramSocket.finish(); } catch (e) { } deepgramSocket = null; }
  if (silenceTimer) { clearInterval(silenceTimer); silenceTimer = null; }
  if (audioProcessor) { audioProcessor.disconnect(); audioProcessor = null; }
  if (audioContext) { audioContext.close(); audioContext = null; }
  if (mediaStream) { mediaStream.getTracks().forEach(track => track.stop()); mediaStream = null; }
  isListening = false;
}
// IMPORTANT: THIS IS HERE AS A DEVELOPMENT FALLBACK ONLY. IT IS TOO EXPENSIVE FOR PRODUCTION AND WOULD REQUIRE REARCHITECTING TO WORK IN DEVELOPMENT.

export function stopListeningEarly(micStatusText, userData, player) {
  console.warn('[Speech] stopListeningEarly called');
  stopDeepgramTranscription();
  if (player) { player.play(); }
  ui.prepareMediaUI();
  ui.setMicStatusText(`<div class='text-center' style='color: red; font-size: large;'><i class='bi bi-exclamation-triangle-fill'></i> ${Strings.get('try_again_speech', userData?.native_language)}</div>`);
}

// --- UPDATED: Stop function now halts whichever engine is running ---
// IMPORTANT: THIS IS HERE AS A DEVELOPMENT FALLBACK ONLY. IT IS TOO EXPENSIVE FOR PRODUCTION AND WOULD REQUIRE REARCHITECTING TO WORK IN DEVELOPMENT.
export function stopDeepgramTranscription() {
  console.log('[Speech] stopDeepgramTranscription called');
  cleanupDeepgram();

  if (isWhisperActive) {
    stopWhisperEngine();
    isWhisperActive = false;
  }

  if (recognition) {
    try { recognition.stop(); } catch (e) {}
    recognition = null;
  }
}
// IMPORTANT: THIS IS HERE AS A DEVELOPMENT FALLBACK ONLY. IT IS TOO EXPENSIVE FOR PRODUCTION AND WOULD REQUIRE REARCHITECTING TO WORK IN DEVELOPMENT.

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
  };

  let capturedTranscript = '';

  recognition.onresult = (event) => {
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

    console.log('[WebSpeech] onresult — captured transcript:', finalTranscript);
    capturedTranscript = finalTranscript;
    
    // Stop the recognition immediately once we have a final result
    // This will trigger the onend handler where the audio analysis happens
    recognition.stop();
  };

  recognition.onerror = (event) => {
    console.error('[WebSpeech] recognition.onerror:', event.error);
    isListening = false;

    let errorMessage = Strings.get('error_speech_generic', userData?.native_language);
    if (event.error === 'NotAllowedError') {
      errorMessage = `<div class='text-center'>${Strings.get('error_mic_permissions', userData?.native_language)}</div>`;
    } else if (event.error === 'network') {
      errorMessage = `<div class='text-center'>${Strings.get('error_internet', userData?.native_language)}</div>`;
    }
    ui.setMicStatusText(errorMessage);
  };

  recognition.onend = async () => {
    console.log('[WebSpeech] recognition.onend — performing final audio analysis');
    isListening = false;

    try {
      // 1. Stop the webcam recorder and get the actual audio blob
      const blob = await stopSpeechCamRecording({
        download: false, persist: true, keepStreamAlive: true, playback: true, autoplay: true,
        meta: {
          lessonId: (configData && configData.lessons && configData.lessons[currentLessonIndex] && configData.lessons[currentLessonIndex].lessonId) || null,
          questionIndex: typeof currentQuestionIndex !== 'undefined' ? currentQuestionIndex : null,
          inputType: (question && question.inputType) || null,
          title: (question && question.question) || null,
        }
      });

      if (capturedTranscript) {
        let stats = { pauseCount: 0, netDuration: 0 };

        // 2. Extract real stats from the blob instead of guessing
        if (blob && blob.size > 0) {
          try {
            const arrayBuffer = await blob.arrayBuffer();
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
            const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
            const float32Data = audioBuffer.getChannelData(0);
            
            const analysis = trimSilenceWithPadding(float32Data, { sampleRate: 16000 });
            stats = { pauseCount: analysis.pauseCount, hesitation: analysis.hesitation, netDuration: analysis.netDuration };
            console.log('[WebSpeech] Real audio stats extracted:', stats);
          } catch (e) {
            console.error('[WebSpeech] Audio analysis failed, using estimates:', e);
            stats = { pauseCount: null, netDuration: Math.max(1, capturedTranscript.split(' ').length * 0.4) };
          }
        }

        // 3. Finalize with real text and real stats
        handleAnswer(capturedTranscript, question.cue, question, document.getElementById('speechButton'), question.explanation, question.translation, stats, userData, configData);
      } else {
        console.warn('[WebSpeech] onend — no transcript captured');
        ui.setMicStatusText(`<div class='text-center'>${Strings.get('try_again_speech', userData?.native_language)}</div>`);
      }
    } catch (err) {
      console.error('[WebSpeech] Final processing in onend failed:', err);
    } finally {
      recognition = null;
    }
  };

  startRecognitionWithTimeout(micStatusText, userData);
}

export function startRecognitionWithTimeout(micStatusText, userData) {
  const isAndroid = /Android/.test(navigator.userAgent);
  console.log('[WebSpeech] startRecognitionWithTimeout — isAndroid:', isAndroid);
  recognition.start();
  ui.setMicStatusText(`<i class='bi bi-mic-fill'></i> ${Strings.get('status_speak', userData?.native_language)}`);

  recognitionTimeout = setTimeout(() => {
    if (!isListening) {
      console.warn('[WebSpeech] recognitionTimeout fired — restarting recognition');
      recognition.stop();
      setTimeout(() => {
        recognition.start();
        ui.setMicStatusText(`<i class='bi bi-mic-fill'></i> ${Strings.get('status_speak', userData?.native_language)}`);
      }, isAndroid ? 1000 : 500);
    }
  }, isAndroid ? 8000 : 5000);
}

// --- UPDATED: The Core Toggle Routing Function ---
export async function toggleSpeechRecognition(params) {
  const { button, question, micStatusText, userData, configData, currentLessonIndex, currentQuestionIndex, handleAnswer, player } = params;
  const wasManuallyStopped = isListening;
  console.log('[Toggle] toggleSpeechRecognition called — isListening:', isListening, '| question.inputType:', question?.inputType, '| question.videoUrl:', question?.videoUrl);

  ui.pauseVideoIfPlaying(player);
  let swappedWrapper = null;
  let ivpParent = null;
  let webcamParent = null;
  let webcamNode = null;

  const urlParams = new URLSearchParams(window.location.search);
  const forceDeepgram = urlParams.get('deepgram') === 'true';
  console.log('[Toggle] forceDeepgram:', forceDeepgram);

  if (!isListening) {
      if (player && player.pauseAndPrepForSwap) {
          swappedWrapper = player.pauseAndPrepForSwap();
          webcamNode = document.getElementById('webcam-preview');
          if (swappedWrapper && webcamNode) {
              ivpParent = swappedWrapper.parentNode;
              webcamParent = webcamNode.parentNode;

              // Create invisible placeholders to hold the swapped elements
              const ivpPlaceholder = document.createElement('div');
              ivpPlaceholder.id = 'ivp-swap-placeholder';
              const webcamPlaceholder = document.createElement('div');
              webcamPlaceholder.id = 'webcam-swap-placeholder';

              ivpParent.replaceChild(ivpPlaceholder, swappedWrapper);
              webcamParent.replaceChild(webcamPlaceholder, webcamNode);

              // Put elements into the opposing placeholders
              ivpPlaceholder.appendChild(webcamNode);
              webcamPlaceholder.appendChild(swappedWrapper);
          }
      }
    ui.setMicStatusText(`<div class="text-center"><div class="mb-0" style="color: green; font-size: 30px;"><i class="bi bi-mic" style="color: green; font-size: 100px !important;"></i><br>${Strings.get('status_speak', userData?.native_language)}</div></div>`);

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

      // ADD THIS: Start tapping the stream for Whisper
      if (transcriptionSuccess && speechCamStream) {
        startLocalAudioTap(speechCamStream);
      }

      if (!transcriptionSuccess && isEngineReady) {
        console.warn('[Toggle] Whisper failed to initialize. Falling back to Deepgram.');
        transcriptionSuccess = await setupDeepgramTranscription(params);
      }
    }

    const isDemoMode = urlParams.get('demo') === 'true';
    console.log('[Toggle] transcriptionSuccess:', transcriptionSuccess, '| isDemoMode:', isDemoMode);

    if (transcriptionSuccess && !isDemoMode) {
      isListening = true;
      button.style.display = "block";
      button.innerHTML = '<i class="bi bi-mic-mute-fill"></i>';
      button.classList.add('btn-danger');
    } else {
      // If Whisper/Deepgram failed, OR if we are explicitly in demo mode
      if (isDemoMode) {
        console.log('[Toggle] 🚀 Demo Mode detected: Forcing Web Speech API');
      } else {
        console.warn('[Toggle] ⚠️ Whisper and Deepgram failed: Falling back to Web Speech API');
      }
      
      fallbackToWebSpeech(params);
    }
  } else {
    // --- THE USER CLICKED STOP ---
    console.log('[Toggle] User clicked STOP');
    isListening = false;

    button.style.display = "none";
    ui.clearMicStatusAndHideMedia();

    ui.setMicStatusText(`<div class='text-center text-warning mt-3'><div class="spinner-border spinner-border-sm" role="status"></div> Analyzing Speech...</div>`);

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
          console.log('[Toggle] Retrieving flattened audio from real-time tap');
          const rawAudioData = stopLocalAudioTap();

          // Pass directly to the trimming function
          const extractionResult = trimSilenceWithPadding(rawAudioData, {
            threshold: 0.02,
            preRoll: 0.3,
            postRoll: 0.3,
            sampleRate: 16000
          });

          const audioData = extractionResult.trimmed;
          const stats = { 
            pauseCount: extractionResult.pauseCount, 
            hesitation: extractionResult.hesitation, 
            netDuration: extractionResult.netDuration 
          };
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

              ui.setMicStatusText(`<div class='text-center mt-3' style='color: #ff9800; font-size: large;'><i class='bi bi-ear-x'></i> Audio unclear. Please try speaking clearly.</div>`);

              // Halt the pipeline (pass null so stopListeningEarly doesn't overwrite our custom UI message)
              stopListeningEarly(null, userData, player);

              // Update the recording anyway so the final video has subtitles for this gibberish attempt!
              const lessonId = configData?.lessons?.[currentLessonIndex]?.lessonId || null;
              const qIndex = typeof currentQuestionIndex !== 'undefined' ? currentQuestionIndex : null;
              updateSpeechRecording(lessonId, qIndex, {
                  userResponse: finalTranscript,
                  cue: question?.cue
              }).catch(e => console.error('[Toggle] Failed to update gibberish recording:', e));
              
              return;
            }

            // Proceed to normal NLP checking if it passes the gate
            let processedTranscript = finalTranscript.replace(/\s+(I|a|an|the|and|or)$/i, '');
            console.log('[Toggle] Processed transcript:', processedTranscript);

            // --- PREFLIGHT CHECK (before showing review UI) ---
            const transcriptToReview = processedTranscript || finalTranscript;

            const rejectPreflight = (message) => {
              ui.clearPlaybackVideo();
              ui.removeWebcamPreview();
              window.dispatchEvent(new CustomEvent('preflightRejected'));
              ui.setMicStatusText(`<div class='text-center text-danger'>${message}</div>`);
              
              // Update the recording anyway so the final video has subtitles for this invalid attempt!
              const lessonId = configData?.lessons?.[currentLessonIndex]?.lessonId || null;
              const qIndex = typeof currentQuestionIndex !== 'undefined' ? currentQuestionIndex : null;
              updateSpeechRecording(lessonId, qIndex, {
                  userResponse: transcriptToReview,
                  cue: question?.cue
              }).catch(e => console.error('[Toggle] Failed to update preflight-rejected recording:', e));

              setTimeout(() => { isListening = false; toggleSpeechRecognition(params); }, 2500);
            };

            const englishLevel = configData?.languageLevel || 'A0';
            const { isValid, warningMessage } = await validateAnswerPrecheck(
              transcriptToReview,
              question.cue,
              question,
              englishLevel,
              userData,
              State.cuesGiven
            );
            if (!isValid) {
              rejectPreflight(warningMessage);
              return;
            }

            // --- REVIEW STEP ---
            let timeLeft = 7;
            let reviewActive = true;

            const acceptTranscript = () => {
              if (!reviewActive) return;
              reviewActive = false;
              clearInterval(timerInterval);
              ui.setMicStatusText("");
              const ivpPlaceholder = document.getElementById('ivp-swap-placeholder');
              const webcamPlaceholder = document.getElementById('webcam-swap-placeholder');
              if (swappedWrapper && webcamNode && ivpPlaceholder && webcamPlaceholder) {
                  const currentIvpParent = ivpPlaceholder.parentNode;
                  const currentWebcamParent = webcamPlaceholder.parentNode;
                  if (currentIvpParent && currentWebcamParent) {
                      currentIvpParent.replaceChild(swappedWrapper, ivpPlaceholder);
                      currentWebcamParent.replaceChild(webcamNode, webcamPlaceholder);
                  }
                  swappedWrapper.classList.remove('ivp-swapped');
              }
              params.handleAnswer(transcriptToReview, question.cue, question, button, question.explanation, question.translation, stats, userData, configData);
            };

            const rejectTranscript = () => {
              if (!reviewActive) return;
              reviewActive = false;
              clearInterval(timerInterval);

              ui.clearPlaybackVideo();
              ui.removeWebcamPreview();

              window.dispatchEvent(new CustomEvent('transcriptRejected', {
                  detail: {
                      cue: question?.cue || "unknown_cue",
                      transcript: transcriptToReview || "unknown_transcript"
                  }
              }));
              ui.setMicStatusText(`<div class='text-center text-warning mt-3'><div class="spinner-border spinner-border-sm" role="status"></div> Restarting Mic...</div>`);

              // Update the recording anyway so the final video has subtitles for this rejected attempt!
              const lessonId = configData?.lessons?.[currentLessonIndex]?.lessonId || null;
              const qIndex = typeof currentQuestionIndex !== 'undefined' ? currentQuestionIndex : null;
              updateSpeechRecording(lessonId, qIndex, {
                  userResponse: transcriptToReview,
                  cue: question?.cue
              }).catch(e => console.error('[Toggle] Failed to update rejected recording:', e));

              const ivpPlaceholder = document.getElementById('ivp-swap-placeholder');
              const webcamPlaceholder = document.getElementById('webcam-swap-placeholder');
              if (swappedWrapper && webcamNode && ivpPlaceholder && webcamPlaceholder) {
                  const currentIvpParent = ivpPlaceholder.parentNode;
                  const currentWebcamParent = webcamPlaceholder.parentNode;
                  if (currentIvpParent && currentWebcamParent) {
                      currentIvpParent.replaceChild(swappedWrapper, ivpPlaceholder);
                      currentWebcamParent.replaceChild(webcamNode, webcamPlaceholder);
                  }
                  swappedWrapper.classList.remove('ivp-swapped');
              }
              if (player && player.controller && player.controller.applySpeechResult) {
                  // Compute indices simply (could be more sophisticated, but we just mark all wrong for a reject)
                  const wrongIndices = player.controller.tokens.map((_, i) => i);
                  player.controller.applySpeechResult([], wrongIndices);
              }

              setTimeout(() => {
                isListening = false;
                toggleSpeechRecognition(params);
              }, 600);
            };

            ui.renderWhisperReviewUI(transcriptToReview, timeLeft, acceptTranscript, rejectTranscript);


            // Start the countdown timer for the text interval
            const timerInterval = setInterval(() => {
              if (!reviewActive) return clearInterval(timerInterval);
              timeLeft--;
              ui.updateWhisperTimer(timeLeft);

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

function trimSilenceWithPadding(data, {
  threshold = 0.0015, // Extremely sensitive
  preRoll = 0.2,
  postRoll = 0.2,
  sampleRate = 16000
} = {}) {
  let start = 0;
  let end = data.length - 1;

  // Analytics: Find peak volume
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const val = Math.abs(data[i]);
    if (val > peak) peak = val;
  }
  console.log(`[Trim] Peak volume: ${peak.toFixed(4)} (Threshold: ${threshold})`);

  // Find first speech, skip very short noise blips (< 10ms)
  const minSpeechFrames = Math.floor(0.01 * sampleRate); 
  let tempStart = 0;
  while (tempStart < data.length) {
    if (Math.abs(data[tempStart]) >= threshold) {
        let sustained = 0;
        for (let j = 0; j < minSpeechFrames && (tempStart + j) < data.length; j++) {
            if (Math.abs(data[tempStart + j]) >= threshold * 0.5) sustained++;
        }
        if (sustained > minSpeechFrames * 0.5) {
            start = tempStart;
            break;
        }
        tempStart += minSpeechFrames;
    } else {
        tempStart++;
    }
  }

  if (tempStart >= data.length) start = data.length;

  // Calculate hesitation in ms
  const hesitation = Math.round((start / sampleRate) * 1000);

  // Find last speech
  while (end > start && Math.abs(data[end]) < threshold) {
    end--;
  }

  if (start >= end) {
    console.warn('[Trim] No speech detected');
    return { trimmed: data, pauseCount: 0, hesitation, netDuration: data.length / sampleRate };
  }

  // Phase 1: Count pauses within the bounded speech segment
  let pauseCount = 0;
  let inPause = false;
  let pauseStartFrame = 0;
  const pauseThresholdFrames = Math.floor(0.6 * sampleRate); // 600ms of silence

  for (let i = start; i <= end; i++) {
    if (Math.abs(data[i]) < threshold) {
      if (!inPause) {
        inPause = true;
        pauseStartFrame = i;
      }
    } else {
      if (inPause) {
        const pauseLength = i - pauseStartFrame;
        if (pauseLength >= pauseThresholdFrames) {
          pauseCount++;
          console.log(`[Trim] Internal pause detected at ~${(pauseStartFrame / sampleRate).toFixed(2)}s (Duration: ${(pauseLength / sampleRate).toFixed(2)}s)`);
        }
        inPause = false;
      }
    }
  }

  const finalStart = Math.max(0, start - Math.floor(preRoll * sampleRate));
  const finalEnd = Math.min(data.length - 1, end + Math.floor(postRoll * sampleRate));

  console.log(`[Trim] Summary: start=${(start/sampleRate).toFixed(2)}s, end=${(end/sampleRate).toFixed(2)}s, hesitation=${hesitation}ms, pauses=${pauseCount}`);

  const trimmed = data.slice(finalStart, finalEnd + 1);
  const netDuration = (end - start) / sampleRate; 

  return { trimmed, pauseCount, hesitation, netDuration };
}