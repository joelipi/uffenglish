import { HEADER_BAND_RATIO, HEADER_TOP_MARGIN_RATIO } from './video-processor-logic.js';

// video-header-*.png is 1600×300 and the recorded/recap video is 9:16, so when
// the banner bleeds the full frame width (the portrait case the app records)
// its drawn height is (300/1600) × (9/16) of the frame height — never more than
// the HEADER_BAND_RATIO cap.
const HEADER_BANNER_ASPECT = 300 / 1600; // height / width
const VIDEO_ASPECT = 9 / 16;             // width / height

// The total header area burned into a user-generated video (a recorded segment
// or the end-of-lesson recap): the localized `video-header-*.png` banner plus
// the `HEADER_TOP_MARGIN_RATIO` margin above it that the renderer fills with the
// banner's own gradient. The lesson's top-overlay blur is sized to exactly this
// band so it hides that burned-in header without spilling into the video body.
// This is the single variable that ties the two together: the renderer lays the
// header out with the same constants, and the blur layer's height is
// `VIDEO_HEADER_RATIO * 100%` of the frame. The banner is never drawn taller
// than the HEADER_BAND_RATIO cap, so the width-limited height is clamped to it
// (defensive only — on the 9:16 frames the app records the width-limited height
// is the smaller of the two).
const headerBannerFraction = Math.min(HEADER_BAND_RATIO, HEADER_BANNER_ASPECT * VIDEO_ASPECT);
export const VIDEO_HEADER_RATIO = HEADER_TOP_MARGIN_RATIO + headerBannerFraction;

// The blur is hidden during the chat phase, where the overlay would otherwise
// blur the chat window and there is no video behind it. Other phases keep it;
// where no video is visible it is a harmless no-op.
export function isVideoHeaderBlurVisible(mediaState) {
    return mediaState !== 'chat';
}

// Style object for the blur layer: the CSS custom property the stylesheet turns
// into the blur height (`calc(var(--video-header-ratio) * 100%)`).
export function videoHeaderBlurStyle() {
    return { '--video-header-ratio': VIDEO_HEADER_RATIO };
}
