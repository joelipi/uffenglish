// transcode.web.js
// Web-only transcode layer for the R2 publish + recap share flows.
//
// Single dependency: mediabunny (Conversion API handles demux + mux + transcode
// in one library — successor to mp4-muxer + webm-muxer).
//
// Contract: callers pass a Blob in, get an mp4 Blob out. Callers (NOT this
// module) handle the Cloudinary fallback — see §6.1 / §8 of the plan.
import {
    Input,
    Output,
    Conversion,
    BufferSource,
    BufferTarget,
    Mp4OutputFormat,
    ALL_FORMATS,
    canEncodeVideo,
    canEncodeAudio,
} from 'mediabunny';

import { uploadWithXHR, toMp4DeliveryUrl, CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET } from './video-share.js';

// ---- Tunables ---------------------------------------------------------------

const VIDEO_BITRATE = 2_500_000;

// ---- Capability gate --------------------------------------------------------

function hasWebCodecs() {
    return !!(
        typeof window !== 'undefined' &&
        window.VideoEncoder &&
        window.VideoDecoder &&
        window.AudioEncoder &&
        window.AudioDecoder
    );
}

// ---- verifyMp4 (safety net) -------------------------------------------------

/**
 * Lightweight "is this blob an mp4-shaped file" check.
 *
 * Confirms the container is ISO-BMFF (the `ftyp` box at offset 4). Catches
 * "definitely not mp4" but does NOT prove the codecs inside are playable on
 * iOS (e.g. HEVC-in-MP4 passes this check). If an iOS playback bug ever
 * traces back to the mp4 fast-path, inspect the `moov`/`stsd` box for
 * `avc1`/`mp4a` codec fourcc as a more thorough verification.
 */
export async function verifyMp4(blob) {
    if (!blob || !blob.type || !blob.type.includes('mp4')) return false;
    try {
        const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
        // bytes 4..7 spell 'ftyp' (0x66 0x74 0x79 0x70)
        return (
            head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70
        );
    } catch {
        return false;
    }
}

// ---- WebCodecs re-encode (webm → mp4 via Mediabunny Conversion) -------------

async function reencodeToMp4(blob) {
    // 1) Read input tracks so we know the dimensions / channels / sample rate
    //    we need to ask the encoder to support.
    const buf = await blob.arrayBuffer();
    const input = new Input({ source: new BufferSource(buf), formats: ALL_FORMATS });
    const videoTrack = await input.getPrimaryVideoTrack();
    const audioTrack = await input.getPrimaryAudioTrack();

    // 2) Encodability check BEFORE committing to the WebCodecs path.
    //    window.AudioEncoder existence does NOT guarantee AAC (Chrome on Linux
    //    without proprietary codecs). Mediabunny exposes canEncodeVideo /
    //    canEncodeAudio as free functions for this.
    const width = videoTrack ? await videoTrack.getCodedWidth() : 0;
    const height = videoTrack ? await videoTrack.getCodedHeight() : 0;
    const numberOfChannels = audioTrack ? await audioTrack.getNumberOfChannels() : 0;
    const sampleRate = audioTrack ? await audioTrack.getSampleRate() : 0;

    const okVideo = videoTrack
        ? await canEncodeVideo('avc', { width, height, bitrate: VIDEO_BITRATE })
        : true;
    const okAudio = audioTrack
        ? await canEncodeAudio('aac', { numberOfChannels, sampleRate })
        : true;
    if (!okVideo || !okAudio) {
        throw new Error('webcodecs-unavailable');
    }

    // 3) Demux + mux + transcode in one shot.
    const outputFormat = new Mp4OutputFormat();
    const output = new Output({ format: outputFormat, target: new BufferTarget() });
    const conversion = await Conversion.init({ input, output });
    await conversion.execute();
    return new Blob([output.target.buffer], { type: 'video/mp4' });
}

// ---- transcodeToMp4 (public entry) ------------------------------------------

/**
 * Returns an mp4 Blob for the given input blob.
 *
 * - If the input is already a valid mp4, returns it unchanged (fast path).
 * - Otherwise re-encodes with WebCodecs via Mediabunny's Conversion API.
 * - Throws `new Error('webcodecs-unavailable')` if the browser cannot
 *   encode H.264/AAC — the caller should then fall back to Cloudinary
 *   (see `uploadWebmToCloudinary` below). This module does NOT fall back
 *   internally; the caller chooses.
 */
export async function transcodeToMp4(blob) {
    if (await verifyMp4(blob)) return blob;
    if (!hasWebCodecs()) throw new Error('webcodecs-unavailable');
    return await reencodeToMp4(blob);
}

// ---- Cloudinary `f_mp4` fallback --------------------------------------------

/**
 * Uploads a webm (or other non-mp4) blob to Cloudinary, asks Cloudinary to
 * transcode it server-side via the `f_mp4` delivery transformation, fetches
 * the resulting mp4 bytes back, and returns them as a Blob.
 *
 * This is the *fallback* path used when WebCodecs cannot encode H.264/AAC
 * (e.g. some Linux Chromium builds, older Safari). It costs money, so it
 * should only be hit on the fallback branch.
 */
export async function uploadWebmToCloudinary(blob) {
    const publicId = await uploadWithXHR(
        `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/video/upload`,
        blob,
        CLOUDINARY_UPLOAD_PRESET,
        'uffenglish.webm'
    );
    if (!publicId.ok) {
        throw new Error(publicId.error || 'Cloudinary upload failed');
    }
    const deliveryUrl = toMp4DeliveryUrl(publicId.data.secure_url);
    const resp = await fetch(deliveryUrl);
    if (!resp.ok) throw new Error(`Cloudinary fetch failed: HTTP ${resp.status}`);
    return new Blob([await resp.arrayBuffer()], { type: 'video/mp4' });
}
