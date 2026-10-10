// modules/video/showcase-videos.js
// Pure data/logic for the public homepage's concatenated-conversation carousel.
// The slugs point at permanent `assets/videos/<slug>.mp4` objects (with a sibling
// `.jpg` poster), copied out of the temporary `videos/` 48h namespace by an
// operator. This module is the single place to edit the curated list.
import { getVideoUrl, getPosterUrl } from './video-url.js';

// Curated concatenated conversations shown on the public homepage. Each slug
// exists permanently on R2 as assets/videos/<slug>.mp4 with a sibling
// assets/videos/<slug>.jpg poster (already uploaded; see the story Notes for the
// copy step). A slug must NOT end in "-response-NN" (that resolves to the
// temporary UGC namespace).
export const SHOWCASE_VIDEO_SLUGS = [
    'exrwr-wouldyourather-b-complete',
    'pwspi-wouldyourather-b-complete',
    'exycy-wouldyourather-b-complete',
];

// slug -> { slug, videoUrl, posterUrl }. Injectable for tests.
export function buildShowcaseVideos(slugs = SHOWCASE_VIDEO_SLUGS) {
    if (!Array.isArray(slugs)) return [];
    return slugs
        .filter((s) => typeof s === 'string' && s.trim() !== '')
        .map((slug) => ({ slug, videoUrl: getVideoUrl(slug), posterUrl: getPosterUrl(slug) }));
}
