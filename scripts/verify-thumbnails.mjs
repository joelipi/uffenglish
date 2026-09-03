#!/usr/bin/env node
// Verifies that every INTRO lesson (first step is lessonIntro with an
// introBackgroundVideoUrl) has a generated poster locally and (optionally) on
// R2. Lessons without an intro need no poster, so they are skipped.
// Usage: node scripts/verify-thumbnails.mjs [--remote]

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MODEL_PATH = path.join(ROOT, 'src/config/model.json');
const POSTERS_DIR = path.join(ROOT, 'public/assets/posters');
const GENERATED_PATH = path.join(ROOT, 'src/generated/poster-lqips.js');

function introLessons(lessons) {
  return lessons.filter(l => l.steps?.[0]?.introBackgroundVideoUrl);
}

async function main() {
  const checkRemote = process.argv.includes('--remote');
  const model = JSON.parse(await fs.readFile(MODEL_PATH, 'utf8'));
  const lessons = introLessons(model.lessons || []);
  let missing = 0;
  for (const l of lessons) {
    const jp = path.join(POSTERS_DIR, `${l.lessonId}.jpg`);
    try { await fs.stat(jp); } catch { console.error(`MISSING local poster ${l.lessonId}.jpg (intro: ${l.steps[0].introBackgroundVideoUrl})`); missing++; }
  }
  try {
    await fs.stat(GENERATED_PATH);
    const txt = await fs.readFile(GENERATED_PATH, 'utf8');
    for (const l of lessons) {
      if (!txt.includes(`"${l.lessonId}"`) && !txt.includes(`'${l.lessonId}'`)) { console.error(`MISSING LQIP for ${l.lessonId}`); missing++; }
    }
  } catch { console.error('Missing src/generated/poster-lqips.js'); missing++; }
  if (checkRemote) {
    for (const l of lessons) {
      const url = `https://r2.ultrafastfluency.com/assets/posters/${l.lessonId}.jpg`;
      try {
        const res = await fetch(url, { method: 'HEAD' });
        if (!res.ok) { console.error(`REMOTE missing ${l.lessonId}: HTTP ${res.status}`); missing++; }
      } catch (e) { console.error(`REMOTE fetch failed ${l.lessonId}:`, e.message); missing++; }
    }
  }
  if (missing) { console.error(`verify failed: ${missing} issue(s). Run \`node scripts/generate-thumbnails.mjs\` then \`--upload\`.`); process.exit(1); }
  console.log(`verify OK: ${lessons.length} intro lessons`);
}
main().catch(e => { console.error(e); process.exit(1); });
