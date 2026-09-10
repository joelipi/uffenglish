#!/usr/bin/env node
// Generates mock lesson videos (mp4) for local/staging testing — real browsers
// need real H.264+AAC files, and there are no teacher videos committed to the
// repo. Each video gets:
//   - a solid-color placeholder background with the spoken text overlaid (drawtext)
//   - TTS audio via ffmpeg's built-in `flite` filter (kal16 voice)
//   - H.264 video + AAC audio, TikTok portrait 1080x1920 (9:16), faststart
//   - duration auto-set to the spoken audio length (+1s padding) so scripts are never cut off
//
// Usage:
//   node scripts/generate-mock-videos.mjs                # generate all slugs below into public/assets/videos/
//   node scripts/generate-mock-videos.mjs --slug=testvideo01 --text="..."
//   node scripts/generate-mock-videos.mjs --upload       # upload all to R2 (needs CLOUDFLARE_API_TOKEN + ACCOUNT_ID + R2 Edit)
//
// After generating, test on localhost:3000 or push to main and it deploys to s.
// (gitignore covers these committed mp4s in public/assets/videos/.)

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'public/assets/videos');
const WIDTH = 1080;
const HEIGHT = 1920;
const FONT = '/usr/share/fonts/truetype/freefont/FreeSans.ttf';
const WRAP_CHARS = 40; // conservative wrap for 1080px at fontsize 44

// slug -> spoken text. Add any slug you need; scripts match src/config/model.json.
const SLUGS = {
  // Grocery lesson slugs (existing model.json)
  do_you_have_rolls_too: 'Do you have rolls, too?',
  do_you_have_dark_chocolate: 'Do you have dark chocolate?',
  do_you_have_very_bitter_dark_chocolate: 'Do you have very bitter dark chocolate?',
  where_is_the_bread_aisle: 'Where is the bread aisle?',
  'gtests-1-0': 'Grocery test one point zero',
  'gtests-1-1': 'Grocery test one point one',
  'gtests-1-2': 'Grocery test one point two',
  'gtests-1-3': 'Grocery test one point three',
  'gtests-0-1-1': 'Grocery test zero point one point one',
  success: 'Success! Great job today.',

  // Would-You-Rather lesson (lessonId "w") — word-for-word scripts
  testvideo01: 'Now you will record yourself asking your friends 3 questions using the phrase Would you rather... You will repeat each question exactly. Press the button below to continue.',
  testvideo02: 'Would you rather have a million dollars or live five years longer?',
  testvideo03: 'Would you rather have a meal with great food or a meal with great conversation?',
  testvideo04: 'Would you rather travel to the beach, the mountains, or the countryside?',
  testvideo05: 'Say: I would rather have a million dollars. OR I would rather live five years longer.',
  testvideo06: 'Say: I would rather have a meal with great conversation. OR I would rather have a meal with great food.',
  testvideo07: 'Say: I would rather travel to the beach. OR I would rather travel to the mountains. OR I would rather travel to the countryside.',
  testvideo08: 'Great! Now share your link with friends or family so they can practice with you free. They have 48 hours to respond.',
};

function run(bin, args) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 256 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) { err.stderr = stderr; return reject(err); }
      resolve(stdout);
    });
  });
}

// Wrap text to WRAP_CHARS per line (word-boundary aware) so drawtext fits 1080px.
function wrapText(text, max = WRAP_CHARS) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = (cur + ' ' + w).trim();
    }
  }
  if (cur) lines.push(cur);
  return lines.join('\n');
}

async function getAudioDuration(file) {
  const out = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file]);
  return parseFloat(out.trim()) || 3;
}

async function generateOne(slug, text) {
  const out = path.join(OUT_DIR, `${slug}.mp4`);
  const tmp = path.join(os.tmpdir(), `uff-mock-${slug}`);
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.mkdir(tmp, { recursive: true });

  const wrapped = wrapText(text || slug.replace(/[-_]/g, ' '));
  const textFile = path.join(tmp, 'overlay.txt');
  const wavFile = path.join(tmp, 'speech.wav');
  await fs.writeFile(textFile, wrapped, 'utf8');

  // 1) TTS audio (flite). Escape filter-graph special chars: ':' is the option
  // separator in lavfi filtergraph syntax, so a literal colon must be '\:'.
  const fliteText = (text || slug.replace(/[-_]/g, ' ')).replace(/:/g, '\\:').replace(/'/g, "\\'");
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `flite=text='${fliteText}':voice=kal16`, '-c:a', 'pcm_s16le', wavFile]);

  // 2) duration = speech + 1.2s padding
  const dur = Math.ceil((await getAudioDuration(wavFile)) + 1.2);

  // 3) video: solid color + wrapped text overlay + speech audio, muxed
  const vf = [
    `drawbox=x=0:y=0:w=iw:h=ih:color=0x2b5aa7@1:t=fill`,
    `drawtext=textfile='${textFile}':fontcolor=white:fontsize=44:line_spacing=26:x=(w-text_w)/2:y=(h-text_h)/2:fontfile=${FONT}`,
  ].join(',');
  const vsrc = `color=c=0x2b5aa7:s=${WIDTH}x${HEIGHT}:d=${dur}:r=30`;

  await run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', vsrc,
    '-i', wavFile,
    '-vf', vf,
    '-t', String(dur),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    out,
  ]);
  console.log(`GEN ${slug}.mp4  (${dur}s)  (${text})`);
  return out;
}

async function uploadAll() {
  const major = await run('npx', ['wrangler', '--version']).then(o => {
    const m = /(\d+)\./.exec(o); return m ? parseInt(m[1], 10) : 0;
  }).catch(() => 0);
  const remoteArg = major >= 4 ? '--remote' : null;
  let failed = 0;
  for (const slug of Object.keys(SLUGS)) {
    const file = path.join(OUT_DIR, `${slug}.mp4`);
    try { await fs.stat(file); } catch { console.error(`UPLOAD FAIL ${slug}: not generated`); failed++; continue; }
    try {
      const args = ['wrangler', 'r2', 'object', 'put'];
      if (remoteArg) args.push(remoteArg);
      args.push(`uff/assets/videos/${slug}.mp4`, '--file', file, '--content-type', 'video/mp4');
      await run('npx', args);
      console.log(`UPLOAD ${slug}.mp4`);
    } catch (e) {
      console.error(`UPLOAD FAIL ${slug}:`, e.message); failed++;
    }
  }
  if (failed) {
    console.warn(`--upload: ${failed}/${Object.keys(SLUGS).length} failed. ` +
      'Set CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID (needs Account > Workers R2 Storage > Edit).');
  }
}

async function main() {
  const upload = process.argv.includes('--upload');
  if (upload) { await uploadAll(); return; }

  const slugArg = process.argv.find(a => a.startsWith('--slug='));
  if (slugArg) {
    const slug = slugArg.split('=')[1];
    const textArg = process.argv.find(a => a.startsWith('--text='));
    const text = textArg ? textArg.split('=').slice(1).join('=') : SLUGS[slug] || slug.replace(/[-_]/g, ' ');
    await generateOne(slug, text);
    console.log(`\nDone: ${path.join(OUT_DIR, `${slug}.mp4`)}`);
    return;
  }

  console.log(`Generating ${Object.keys(SLUGS).length} mock videos → ${OUT_DIR}`);
  for (const [slug, text] of Object.entries(SLUGS)) {
    try { await generateOne(slug, text); } catch (e) { console.error(`ERR ${slug}:`, e.message); }
  }
  console.log('\nUpload to R2 (for staging/prod): node scripts/generate-mock-videos.mjs --upload');
  console.log('Test locally first: npm run dev then http://localhost:3000/course/model/lesson/g');
}

main().catch(e => { console.error(e); process.exit(1); });