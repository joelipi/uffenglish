const fs = require('fs');
const t = fs.readFileSync('js/modules/answer-pipeline.js', 'utf8');
const lines = t.split('\n');

console.log('Lines 16-25:');
lines.slice(15, 26).forEach((line, i) => {
    console.log(String(i + 16).padStart(3) + ': ' + line.substring(0, 120));
});

console.log('\nImport of bilingual-display appearances:');
lines.forEach((line, i) => {
    if (line.includes('bilingual-display')) {
        console.log('  Line ' + (i + 1) + ': ' + line.trim());
    }
});

console.log('\nDouble-check bilingual-display.js:');
const bd = fs.readFileSync('js/modules/bilingual-display.js', 'utf8').split('\n');
console.log('Line 82: ' + bd[81]);
console.log('Line 83: ' + bd[82]);
console.log('Line 84: ' + bd[83]);
console.log('Line 85: ' + bd[84]);
console.log('Line 86: ' + bd[85]);
