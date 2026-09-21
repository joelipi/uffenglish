#!/usr/bin/env node
// scripts/generate-captions.mjs
// Generates six-language SRT captions for newly added simpleVideoUrl steps
// (stories/009-auto-caption-simple-videos). Local Whisper transcribes the
// audio (no cloud STT), DeepSeek translates to es/pt/fr/hi/bn, and
// jsonc-parser injects the caption objects into src/config/*.json without
// disturbing existing bytes.
//
// Usage:
//   node scripts/generate-captions.mjs --base <sha> --head <sha> --files "src/config/a.json src/config/b.json"
//   node scripts/generate-captions.mjs --base <sha> --head <sha> --files "src/config/a.json" --dry-run
//
// Requires DEEPSEEK_API_KEY and ffmpeg on PATH. The Whisper model is cached
// under $CAPTION_MODEL_CACHE (or os.tmpdir()/uff-caption-model) so it lives
// outside the repo and is actions/cache-able.

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline, env } from '@huggingface/transformers';
import {
    buildCaptionEdits,
    WHISPER_MODEL,
    DEEPSEEK_MODEL,
    CAPTION_LANGUAGES,
} from './lib/caption-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
// Production R2 media base (src/modules/video/video-url.js:5); hardcoded here
// because video-url.js reads import.meta.env (same precedent as
// scripts/generate-thumbnails.mjs:31).
const CDN_VIDEO_BASE = 'https://r2.ultrafastfluency.com/assets/videos/';
const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';

const HELP = `Generate six-language SRT captions for newly added simpleVideoUrl steps.

Usage:
  node scripts/generate-captions.mjs --base <sha> --head <sha> --files "src/config/a.json src/config/b.json" [--dry-run]

Flags:
  --base <sha>     Before-revision commit for new-video detection
  --head <sha>     After-revision commit (the pushed head)
  --files <list>   Space-separated src/config/*.json paths to process
  --dry-run        Print planned edits without writing any file
  --help, -h       Show this help

Requires DEEPSEEK_API_KEY and ffmpeg on PATH.`;
const USAGE = 'Usage: node scripts/generate-captions.mjs --base <sha> --head <sha> --files "src/config/a.json" [--dry-run]';

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

// Read a file at a revision; null when the file did not exist there (new file).
async function gitShow(rev, file) {
    try {
        return await run('git', ['show', `${rev}:${file}`]);
    } catch {
        return null;
    }
}

async function downloadVideo(slug) {
    const cacheDir = path.join(os.tmpdir(), 'uff-caption-videos');
    await fs.mkdir(cacheDir, { recursive: true });
    const cached = path.join(cacheDir, `${slug}.mp4`);
    try {
        await fs.stat(cached);
        return cached;
    } catch {}
    const url = `${CDN_VIDEO_BASE}${slug}.mp4`;
    console.log(`DOWNLOAD ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download failed HTTP ${res.status} for ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(cached, buf);
    return cached;
}

async function extractPcm(mp4Path) {
    const pcmPath = mp4Path.replace(/\.mp4$/, '.f32');
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4Path, '-vn', '-ar', '16000', '-ac', '1', '-f', 'f32le', pcmPath]);
    return pcmPath;
}

let asrPromise = null;
function getAsr() {
    if (!asrPromise) {
        env.cacheDir = process.env.CAPTION_MODEL_CACHE || path.join(os.tmpdir(), 'uff-caption-model');
        env.allowLocalModels = false;
        asrPromise = pipeline('automatic-speech-recognition', WHISPER_MODEL, {
            dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
        });
    }
    return asrPromise;
}

async function transcribeReal(slug) {
    const mp4 = await downloadVideo(slug);
    const pcm = await extractPcm(mp4);
    const buf = await fs.readFile(pcm);
    const audio = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    const asr = await getAsr();
    const result = await asr(audio, { return_timestamps: true, chunk_length_s: 30 });
    console.log(`TRANSCRIBED ${slug}: ${result.text}`);
    return result.chunks || [];
}

async function translateReal(englishSrt, lang) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error('DEEPSEEK_API_KEY is not set');
    const res = await fetch(DEEPSEEK_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: DEEPSEEK_MODEL,
            response_format: { type: 'json_object' },
            messages: [
                {
                    role: 'system',
                    content:
                        `You translate English subtitle (SRT) files into ${lang}. ` +
                        'Return ONLY a JSON object of the form {"srt": "<translated SRT>"}. ' +
                        'Preserve cue numbers and timestamps exactly; translate only the subtitle text. ' +
                        'Keep the taught English target phrase (e.g. after "Say:", "Di:", "Diga:") in English.',
                },
                { role: 'user', content: englishSrt },
            ],
        }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}: ${text.slice(0, 300)}`);
    const data = JSON.parse(text);
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error(`DeepSeek returned no content: ${text.slice(0, 300)}`);
    const parsed = JSON.parse(content);
    if (!parsed.srt) throw new Error(`DeepSeek response missing "srt" key: ${content.slice(0, 300)}`);
    return parsed.srt;
}

function argValue(args, name) {
    const idx = args.indexOf(name);
    return idx === -1 ? undefined : args[idx + 1];
}

async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) {
        console.log(HELP);
        return;
    }

    const base = argValue(args, '--base');
    const head = argValue(args, '--head');
    const files = argValue(args, '--files');
    const dryRun = args.includes('--dry-run');

    if (!base || !head || !files) {
        console.error(USAGE);
        process.exit(1);
    }
    if (!process.env.DEEPSEEK_API_KEY) {
        console.error('ERROR: DEEPSEEK_API_KEY is not set. Set it before running the caption generator.');
        process.exit(1);
    }

    const fileList = files.split(/\s+/).filter(Boolean);
    for (const file of fileList) {
        const beforeText = await gitShow(base, file);
        const afterText = await fs.readFile(path.join(ROOT, file), 'utf8');
        const { text, generated } = await buildCaptionEdits({
            beforeText,
            afterText,
            transcribe: transcribeReal,
            translate: translateReal,
            languages: CAPTION_LANGUAGES,
        });
        if (dryRun) {
            console.log(`[dry-run] ${file}: ${generated.length ? `captions for ${generated.join(', ')}` : 'no new simple videos'}`);
        } else {
            await fs.writeFile(path.join(ROOT, file), text);
            console.log(`WROTE ${file}: captions for ${generated.join(', ') || 'nothing'}`);
        }
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});