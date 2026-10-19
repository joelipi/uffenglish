// src/modules/video/video-speed-logic.js
// Pure rules for the video-speed toggle. No React, no DOM, no store:
// the cycle steps, label formatting, toggle view model and the element
// write all live here so every video surface shares one speed contract.
//
// The toggle cycles 1x -> 0.8x -> 0.6x -> 1x. InteractiveVideoPlayer owns its
// own scoring-coupled playbackRate (interactive-video-controller.js) and is
// deliberately excluded — this module never touches that controller.

export const VIDEO_SPEED_STEPS = [1, 0.8, 0.6];

export const VIDEO_SPEED_TOGGLE_TESTID = 'video-speed-toggle';

export function nextVideoSpeed(current) {
    const idx = VIDEO_SPEED_STEPS.findIndex((s) => Math.abs(s - Number(current)) < 1e-9);
    if (idx === -1) return VIDEO_SPEED_STEPS[0];
    return VIDEO_SPEED_STEPS[(idx + 1) % VIDEO_SPEED_STEPS.length];
}

export function formatVideoSpeedLabel(rate) {
    const n = Number(rate);
    if (Math.abs(n - 1) < 1e-9) return '1x';
    return `${n}x`;
}

export function buildVideoSpeedToggleView({ rate } = {}) {
    const current = Number(rate) || 1;
    const normalized = VIDEO_SPEED_STEPS.some((s) => Math.abs(s - current) < 1e-9)
        ? current
        : 1;
    const next = nextVideoSpeed(normalized);
    const slowed = Math.abs(normalized - 1) >= 1e-9;
    return {
        rate: normalized,
        label: formatVideoSpeedLabel(normalized),
        next,
        nextLabel: formatVideoSpeedLabel(next),
        slowed,
        testId: VIDEO_SPEED_TOGGLE_TESTID,
        ariaLabel: `Video speed ${formatVideoSpeedLabel(normalized)} — activate for ${formatVideoSpeedLabel(next)}`,
    };
}

export function applyVideoSpeed(video, rate) {
    const n = Number(rate);
    if (!video || Number.isNaN(n)) return n;
    try {
        video.playbackRate = n;
        console.log(`[VideoSpeed] playbackRate set to ${n}x`);
    } catch (e) {
        console.warn(`[VideoSpeed] failed to set playbackRate to ${n}x:`, e?.message);
    }
    return n;
}
