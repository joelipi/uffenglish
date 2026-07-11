#!/usr/bin/env node
// @web-only
//
// Fixes iOS A/V desync caused by AAC encoder priming delay in authored MP4s
// (simpleVideo / interactiveVideo assets). iOS Safari honors the per-stream
// start offset strictly while desktop browsers auto-correct it, so only iOS
// shows the drift. Webcam (MediaRecorder) clips have aligned starts and sync.
//
// For every .mp4 in <inputDir>, this script:
//   1. Probes the audio and video stream start_time with ffprobe.
//   2. Computes the offset = audioStart - videoStart.
//   3. If the offset exceeds a small threshold, re-encodes the audio (trimming
//      the leading priming) and remuxes the (already iOS-safe) video stream,
//      writing a new file where both streams start at 0.
//
// Usage:
//   node scripts/fix-video-sync.mjs <inputDir> [outputDir]
//
// Requires ffmpeg + ffprobe on PATH.

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const INPUT_DIR = process.argv[2];
const OUTPUT_DIR = process.argv[3] || path.join(process.cwd(), 'fixed-videos');

// Offsets smaller than this (seconds) are within tolerance; skip re-encode.
const OFFSET_THRESHOLD = 0.005;

function run(bin, args) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        return reject(err);
      }
      resolve(stdout);
    });
  });
}

async function probe(file) {
  const out = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'stream=index,codec_type,start_time',
    '-of', 'json',
    file,
  ]);
  const data = JSON.parse(out);
  let videoStart = 0;
  let audioStart = null;
  for (const s of data.streams || []) {
    const t = s.start_time != null ? parseFloat(s.start_time) : 0;
    if (s.codec_type === 'video') videoStart = t || 0;
    else if (s.codec_type === 'audio') audioStart = t || 0;
  }
  return { videoStart, audioStart };
}

async function collectMp4s(dir) {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await collectMp4s(full)));
    else if (e.isFile() && e.name.toLowerCase().endsWith('.mp4')) out.push(full);
  }
  return out;
}

async function fixOne(file, dest) {
  const { videoStart, audioStart } = await probe(file);
  if (audioStart == null) {
    console.log(`SKIP  ${path.basename(file)} (no audio stream)`);
    return;
  }
  const offset = audioStart - videoStart;
  if (Math.abs(offset) <= OFFSET_THRESHOLD) {
    console.log(`OK    ${path.basename(file)} (offset ${offset.toFixed(4)}s <= threshold)`);
    return;
  }

  // Build an audio filter that aligns the audio start to the video start.
  let filter;
  if (offset > 0) {
    // Audio starts late -> drop the leading priming samples.
    filter = `atrim=${offset},asetpts=N/SR/TB`;
  } else {
    // Audio starts early -> delay it to match the video.
    const ms = Math.round(-offset * 1000);
    filter = `adelay=${ms}|${ms},asetpts=N/SR/TB`;
  }

  console.log(`FIX   ${path.basename(file)} (offset ${offset.toFixed(4)}s)`);
  await run('ffmpeg', [
    '-y', '-i', file,
    '-c:v', 'copy',                 // video is already iOS-safe (H.264/yuv420p/CFR)
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
    '-af', filter,
    '-movflags', '+faststart',
    '-map_metadata', '-1',
    dest,
  ]);
}

async function main() {
  if (!INPUT_DIR) {
    console.error('Usage: node scripts/fix-video-sync.mjs <inputDir> [outputDir]');
    process.exit(1);
  }
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const files = await collectMp4s(INPUT_DIR);
  console.log(`Found ${files.length} .mp4 file(s) in ${INPUT_DIR}`);
  console.log(`Output -> ${OUTPUT_DIR}\n`);
  for (const f of files) {
    const dest = path.join(OUTPUT_DIR, path.basename(f));
    try {
      await fixOne(f, dest);
    } catch (e) {
      console.error(`ERROR ${path.basename(f)}:`, e.message);
      if (e.stderr) console.error(e.stderr);
    }
  }
  console.log('\nDone.');
}

main();
