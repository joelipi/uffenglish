// after-video-player.web.js
// Web-only controller for the display-only after-video loop
// (stories/060-autoplay-share-video). Uses DOM video, fetch, requestAnimationFrame
// and the caller's running AudioContext. React Native replaces this module.
//
// Audibility trick: the tail <video> element stays muted (muted playsInline
// playback needs no user gesture), while sound travels through a looping
// WebAudio buffer on the AudioContext that the "make my video" tap already
// unlocked — the same single-audio-path precedent as the Safari render path in
// video-processor.web.js. A fresh muted play() is OS-allowed; starting a new
// buffer on a running context needs no new gesture.
//
// Exclusion guarantee: this module never touches the MediaRecorder, the
// per-step range hooks, or the R2 export — it only starts after the recorder
// has stopped, so the tail can never enter the shared blob.
//
// Visibility rule: this module registers no visibilitychange/pagehide
// listeners and reads no document.hidden state. The loop pauses only on tap
// (toggleAfterVideo) or teardown (stopAfterVideoLoop / swap).
import { buildAfterVideoUrls } from './after-video-logic.js';
import { VideoRenderPlanner } from './video-processor-logic.js';
import { appStore } from '../store/store.js';

// The single active loop. Module-level by necessity: the loop is started by
// the render handoff (video-processor.web.js), toggled by the canvas
// (SuccessVideoCanvas.jsx) and stopped by unmount/teardown in yet another
// component — no single component owns its lifetime. Start always stops the
// previous loop first, so at most one #afterVideo element exists.
let activeLoop = null;

/**
 * Creates (or reuses) a caller-owned AudioContext inside the "make my video"
 * tap gesture and resumes it immediately. The render and the display-only
 * tail both play audibly on it without a second tap. Caller owns lifecycle:
 * close it on unmount / retry; the processor and the tail loop never close it.
 * Returns null when the browser exposes no AudioContext.
 */
export function createSharedAudioContext(existing = null) {
    let ctx = existing && existing.state !== 'closed' ? existing : null;
    if (!ctx) {
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return null;
            ctx = new AC();
        } catch (e) {
            return null;
        }
    }
    if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
    }
    return ctx;
}

const CANDIDATE_TIMEOUT_MS = 10000;

function createTailVideo() {
    const video = document.createElement('video');
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    // iPad/Safari require the legacy attribute in addition to the property to
    // permit inline (non-fullscreen) playback without a user gesture.
    video.setAttribute('webkit-playsinline', '');
    video.setAttribute('playsinline', '');
    if ('disableRemotePlayback' in video) video.disableRemotePlayback = true;
    video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.body.appendChild(video);
    return video;
}

function awaitVideoReady(video, url, timeoutMs = CANDIDATE_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (fn, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            video.removeEventListener('canplay', onCanPlay);
            video.removeEventListener('error', onError);
            fn(value);
        };
        const onCanPlay = () => finish(resolve);
        const onError = () => finish(reject, new Error(`[AfterVideo] video load failed: ${url}`));
        const timer = setTimeout(
            () => finish(reject, new Error(`[AfterVideo] video load timeout: ${url}`)),
            timeoutMs
        );
        video.addEventListener('canplay', onCanPlay);
        video.addEventListener('error', onError);
        video.src = url;
        video.load();
    });
}

async function decodeUrlToBuffer(url, audioContext) {
    // fetch before decode: a 404 must reject here, not inside decodeAudioData.
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`[AfterVideo] audio fetch failed (${response.status}): ${url}`);
    }
    const data = await response.arrayBuffer();
    return audioContext.decodeAudioData(data);
}

function startBufferSource(loop, offsetSec = 0) {
    const source = loop.audioContext.createBufferSource();
    source.buffer = loop.decoded;
    source.loop = true;
    source.connect(loop.audioContext.destination);
    try {
        source.start(loop.audioContext.currentTime, Math.max(0, offsetSec));
    } catch (e) {
        source.disconnect();
        throw e;
    }
    return source;
}

function stopBufferSource(loop) {
    if (loop.source) {
        try { loop.source.stop(); } catch (e) { /* already stopped */ }
        try { loop.source.disconnect(); } catch (e) { /* already gone */ }
        loop.source = null;
    }
}

function teardownPlayback(loop) {
    if (!loop) return;
    if (loop.rafId != null) {
        try {
            if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(loop.rafId);
        } catch (e) { /* ignore */ }
        loop.rafId = null;
    }
    stopBufferSource(loop);
    try { loop.video.pause(); } catch (e) { /* ignore */ }
    try {
        if (loop.objectUrl) URL.revokeObjectURL(loop.objectUrl);
    } catch (e) { /* ignore */ }
    loop.objectUrl = null;
    try {
        if (loop.video.parentNode) loop.video.parentNode.removeChild(loop.video);
    } catch (e) { /* ignore */ }
    try { loop.video.removeAttribute('id'); } catch (e) { /* ignore */ }
}

function drawLoop() {
    const loop = activeLoop;
    if (!loop || loop.paused) return;
    const { video, canvas } = loop;
    try {
        if (video.readyState >= 2 && video.videoWidth > 0 && canvas.width > 0) {
            const ctx = canvas.getContext('2d');
            if (ctx) {
                const planner = new VideoRenderPlanner();
                const layout = planner.calculateLayout(
                    video.videoWidth, video.videoHeight, canvas.width, canvas.height
                );
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(video, layout.x, layout.y, layout.width, layout.height);
            }
        }
        // Re-lock audio on every video wrap: the element loops itself, so
        // restart the buffer from zero whenever currentTime jumps backwards.
        // Keeps A/V in sync across indefinite loops without drift.
        const now = video.currentTime || 0;
        if (loop.lastTime != null && now < loop.lastTime - 0.25) {
            stopBufferSource(loop);
            try {
                loop.source = startBufferSource(loop, 0);
            } catch (e) {
                console.warn('[AfterVideo] buffer relock failed:', e?.message);
            }
        }
        loop.lastTime = now;
    } catch (e) {
        console.warn('[AfterVideo] draw failed:', e?.message);
    }
    if (activeLoop === loop && !loop.paused && typeof requestAnimationFrame === 'function') {
        loop.rafId = requestAnimationFrame(drawLoop);
    }
}

function beginPlayback(loop) {
    loop.paused = false;
    loop.lastTime = null;
    const play = loop.video.play();
    const started = (play && typeof play.then === 'function' ? play : Promise.resolve());
    return started.then(() => {
        if (activeLoop !== loop) return;
        loop.source = startBufferSource(loop, loop.video.currentTime || 0);
        if (typeof requestAnimationFrame === 'function') {
            loop.rafId = requestAnimationFrame(drawLoop);
        }
    });
}

// Builds (but does not activate) playback for one URL: a muted element that
// reaches canplay plus a decoded buffer on the running context. Throws when
// either half fails, so the caller can try the next candidate — a loop is
// never left muted-only or silent.
async function buildLoopPlayback({ url, canvas, audioContext }) {
    const video = createTailVideo();
    try {
        const [, decoded] = await Promise.all([
            (async () => {
                await awaitVideoReady(video, url);
                return null;
            })(),
            decodeUrlToBuffer(url, audioContext),
        ]);
        return { video, decoded, canvas, audioContext, source: null, rafId: null, objectUrl: null, paused: true, lastTime: null };
    } catch (e) {
        try { video.pause(); } catch (ignored) { /* ignore */ }
        try {
            if (video.parentNode) video.parentNode.removeChild(video);
        } catch (ignored) { /* ignore */ }
        throw e;
    }
}

function activateLoop(loop, base, { guestLang, profileLang }) {
    loop.video.id = 'afterVideo';
    activeLoop = { ...loop, base, guestLang, profileLang };
    try {
        appStore.getState().setAfterVideoActive(base);
    } catch (e) {
        console.warn('[AfterVideo] store flag update failed:', e?.message);
    }
    return beginPlayback(activeLoop);
}

/**
 * Starts the display-only loop, stopping any previous loop first. Tries the
 * language-ordered candidate URLs until one yields both a playable (muted)
 * element and a decoded audio buffer. Throws when every candidate fails —
 * the caller must then run the blob fallback, never a silent loop.
 */
export async function startAfterVideoLoop({ displayCanvas, base, guestLang, profileLang, audioContext }) {
    stopAfterVideoLoop();
    if (!displayCanvas) throw new Error('[AfterVideo] no display canvas');
    if (!audioContext) throw new Error('[AfterVideo] no audio context');
    const urls = buildAfterVideoUrls(base, guestLang, profileLang);
    let lastError = new Error('[AfterVideo] no candidates');
    for (const url of urls) {
        try {
            const loop = await buildLoopPlayback({ url, canvas: displayCanvas, audioContext });
            await activateLoop(loop, base, { guestLang, profileLang });
            console.log('[AfterVideo] loop started:', base, url);
            return base;
        } catch (e) {
            lastError = e;
            console.warn('[AfterVideo] candidate failed, trying next:', e?.message);
        }
    }
    throw lastError;
}

/**
 * Swaps the running loop to a new base (Share tap → aftershare), reusing the
 * loop's canvas and context. Safe no-op (returns null) when no loop is
 * active — Share then works exactly as before. The replacement is built
 * fully before the old loop is torn down, so a total candidate failure keeps
 * the old base playing instead of stranding an empty frame.
 */
export async function swapAfterVideoLoop(base, { guestLang, profileLang } = {}) {
    if (!activeLoop) return null;
    const { canvas, audioContext } = activeLoop;
    const fallbackGuestLang = guestLang ?? activeLoop.guestLang;
    const fallbackProfileLang = profileLang ?? activeLoop.profileLang;
    const urls = buildAfterVideoUrls(base, fallbackGuestLang, fallbackProfileLang);
    for (const url of urls) {
        try {
            const next = await buildLoopPlayback({ url, canvas, audioContext });
            teardownPlayback(activeLoop);
            await activateLoop(next, base, {
                guestLang: fallbackGuestLang,
                profileLang: fallbackProfileLang,
            });
            console.log('[AfterVideo] loop swapped:', base, url);
            return base;
        } catch (e) {
            console.warn('[AfterVideo] swap candidate failed, trying next:', e?.message);
        }
    }
    console.warn('[AfterVideo] swap failed for all candidates; keeping', activeLoop.base);
    return activeLoop.base;
}

/**
 * Toggles pause/resume on the visible canvas tap. Pause stops both the muted
 * element and the buffer; resume (a real user gesture) restarts both audibly.
 * No-op false when no loop is active. Returns the new paused state.
 */
export async function toggleAfterVideo() {
    if (!activeLoop) return false;
    const loop = activeLoop;
    if (!loop.paused) {
        loop.paused = true;
        if (loop.rafId != null && typeof cancelAnimationFrame === 'function') {
            try { cancelAnimationFrame(loop.rafId); } catch (e) { /* ignore */ }
            loop.rafId = null;
        }
        stopBufferSource(loop);
        try { loop.video.pause(); } catch (e) { /* ignore */ }
        return true;
    }
    try {
        await beginPlayback(loop);
        return false;
    } catch (e) {
        console.warn('[AfterVideo] resume failed:', e?.message);
        return true;
    }
}

export function isAfterVideoPaused() {
    return activeLoop ? !!activeLoop.paused : false;
}

export function getActiveAfterVideoBase() {
    return activeLoop ? activeLoop.base : null;
}

/**
 * Stops the loop, revokes URLs and releases the element. Never closes the
 * caller-owned AudioContext — lifecycle owns it (VideoButton unmount). Clears
 * the store flag so the blob preview can mount as fallback.
 */
export function stopAfterVideoLoop() {
    if (!activeLoop) return;
    teardownPlayback(activeLoop);
    activeLoop = null;
    try {
        appStore.getState().setAfterVideoActive(null);
    } catch (e) {
        console.warn('[AfterVideo] store flag clear failed:', e?.message);
    }
}
