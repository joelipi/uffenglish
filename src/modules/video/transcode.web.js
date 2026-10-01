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
    BlobSource,
    BufferTarget,
    Mp4OutputFormat,
    ALL_FORMATS,
    canEncodeVideo,
    canEncodeAudio,
} from 'mediabunny';

import { uploadWithXHR, toMp4DeliveryUrl, deleteFromCloudinary, CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET } from './video-share.js';

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

// ---- Container duration probe (recap fallback) ------------------------------

/**
 * Reads a clip's true container duration in seconds via Mediabunny, without
 * decoding. Used by the recap renderer when the `<video>` element's
 * `duration` stays non-finite (e.g. an iPad MediaRecorder WebM blob) so the
 * segment can advance on its real length instead of its net speaking time.
 *
 * Returns a positive finite number of seconds, or `null` if the blob is
 * missing or its container cannot be read. Never throws.
 */
export async function probeClipDurationSec(blob) {
    if (!blob) return null;
    let input = null;
    try {
        input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
        // Cheap path first: the duration stored in the container header
        // (WebM Segment Info / MP4 mvhd), no packet scan. Usually a few ms.
        // skipLiveWait prevents a MediaRecorder blob flagged as "live" from
        // blocking on a stream that has already ended.
        const fromMetadata = await input.getDurationFromMetadata(undefined, { skipLiveWait: true });
        if (Number.isFinite(fromMetadata) && fromMetadata > 0) return fromMetadata;
        // Accurate path: scan to the last packet. Bounded because the source is
        // a finite, in-memory Blob and `skipLiveWait` avoids waiting for a live
        // stream that has already ended.
        const duration = await input.computeDuration(undefined, { skipLiveWait: true });
        return Number.isFinite(duration) && duration > 0 ? duration : null;
    } catch (e) {
        console.warn('[Transcode] probeClipDurationSec failed:', e?.message || e);
        return null;
    } finally {
        input?.dispose();
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

// ---- Trim a time range out of a recording (per-segment R2 clips) -------------

/**
 * Cuts `[startSec, endSec)` out of `sourceBlob` and re-encodes it to an mp4
 * Blob, using Mediabunny's `Conversion` trim. The per-segment R2 clips are
 * produced from the single stitched lesson recording this way, so no second
 * render/playback pass is needed.
 *
 * Uses `BlobSource` (not `BufferSource(await blob.arrayBuffer())`) so the whole
 * source recording is not copied into memory. Throws `webcodecs-unavailable`
 * when the browser cannot encode H.264/AAC — the caller falls back to the
 * re-render path. Output is an mp4 Blob (`Mp4OutputFormat`).
 */
export async function transcodeRangeToMp4(sourceBlob, startSec, endSec) {
    if (!sourceBlob) throw new Error('no-source-blob');
    if (!(Number.isFinite(startSec) && Number.isFinite(endSec) && endSec > startSec)) {
        throw new Error('invalid-range');
    }
    if (!hasWebCodecs()) throw new Error('webcodecs-unavailable');

    const input = new Input({ source: new BlobSource(sourceBlob), formats: ALL_FORMATS });
    try {
        const videoTrack = await input.getPrimaryVideoTrack();
        const audioTrack = await input.getPrimaryAudioTrack();

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
        if (!okVideo || !okAudio) throw new Error('webcodecs-unavailable');

        const outputFormat = new Mp4OutputFormat();
        const output = new Output({ format: outputFormat, target: new BufferTarget() });
        const conversion = await Conversion.init({
            input,
            output,
            trim: { start: startSec, end: endSec },
        });
        await conversion.execute();
        return new Blob([output.target.buffer], { type: 'video/mp4' });
    } finally {
        input.dispose();
    }
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
 *
 * The temporary Cloudinary upload is deleted (fire-and-forget) after the
 * mp4 bytes are fetched, so Cloudinary storage doesn't accumulate.
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
    const mp4Blob = new Blob([await resp.arrayBuffer()], { type: 'video/mp4' });
    // Fire-and-forget cleanup of the temporary Cloudinary upload.
    if (publicId.data?.delete_token) {
        deleteFromCloudinary(publicId.data.delete_token);
    }
    return mp4Blob;
}
