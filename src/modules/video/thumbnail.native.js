// thumbnail.native.js — Native stub mirroring thumbnail.web.js
// Web uses offscreen <video> + canvas. Native uses expo-video-thumbnails or FFmpegKit.
// Currently native upload is disabled (r2-upload.native.jsx throws, exportSegmentsToR2 no-op),
// so this is a forward-compatible no-op. When native publishing is enabled,
// replace with: import * as VideoThumbnails from 'expo-video-thumbnails';

export async function generateThumbFromBlob() {
    // no-op on native until publishing is enabled
    console.warn('[Thumbnail.native] generateThumbFromBlob not implemented — no-op');
    return null;
}
