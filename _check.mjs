import { readFileSync } from 'fs';

const src = readFileSync('js/modules/answer-pipeline.js', 'utf8');
const lines = src.split('\n');
const targets = lines.filter(l => l.includes('bilingual-display'));
console.log('--- answer-pipeline.js imports ---');
targets.forEach(l => console.log(' ', l.trim()));

const bd = readFileSync('js/modules/bilingual-display.js', 'utf8');
const bdLines = bd.split('\n');
console.log('\n--- bilingual-display.js:72-86 ---');
bdLines.slice(71, 86).forEach((l, i) => console.log(String(i + 72).padStart(3) + ': ' + l));

const sw = readFileSync('js/components/step-loader.web.js', 'utf8');
const swLines = sw.split('\n');
console.log('\n--- step-loader.web.js:325-340 ---');
swLines.slice(324, 340).forEach((l, i) => console.log(String(i + 325).padStart(3) + ': ' + l));
