import { readFileSync } from 'fs';

const sw = readFileSync('js/components/step-loader.web.js', 'utf8');
const lines = sw.split('\n');
console.log('Lines 326-344:');
lines.slice(325, 344).forEach((l, i) => console.log(String(i + 326).padStart(3) + ': ' + l));
