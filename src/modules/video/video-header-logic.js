import { HEADER_BAND_RATIO } from './video-processor-logic.js';

// The total header area burned into a user-generated video (a recorded segment
// or the end-of-lesson recap): the localized `video-header-*.png` banner, drawn
// below a `HEADER_TOP_MARGIN_RATIO` top margin that the renderer fills with the
// banner's own gradient. On the portrait frames the app uses the banner is
// width-limited, so the whole header (margin + banner) lands within the top
// `HEADER_BAND_RATIO` of the frame. The lesson's top-overlay blur is sized to
// exactly this band so it hides that burned-in header without spilling into the
// video body. This is the single variable that ties the two together: the
// renderer sizes the band with `HEADER_BAND_RATIO`, and the blur layer's height
// is `VIDEO_HEADER_RATIO * 100%` of the frame.
export const VIDEO_HEADER_RATIO = HEADER_BAND_RATIO;

// The blur only has something to hide while a video is behind the header; the
// chat phase has no video and its own header must stay sharp.
export function isVideoHeaderBlurVisible(mediaState) {
    return mediaState !== 'chat';
}

// Style object for the blur layer: the CSS custom property the stylesheet turns
// into the blur height (`calc(var(--video-header-ratio) * 100%)`).
export function videoHeaderBlurStyle() {
    return { '--video-header-ratio': VIDEO_HEADER_RATIO };
}
