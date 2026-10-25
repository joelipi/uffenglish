// Person guard for the cartoon-preferences course.
//
// The friend-lesson dynamic: the learner asks about THEMSELVES (first person —
// "Am I more like Mickey Mouse or Bugs Bunny?") and the friend answers about the
// learner (second person — "You are more like Bugs Bunny"). A question in the
// second person or an answer in the first person reads as the wrong speaker, so
// this pins the convention on both authoring surfaces: the source (what the
// author edits) and the generated master CSV (what ships).
//
// Raw reads only: the guard asserts on the parsed source text and the CSV cells,
// never on comment-stripped prose of its own. Proven failable by flipping one
// answer back to "I'm" (fails) and restoring (passes).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SOURCE_REL = 'sources/cartoon-preferences.source.txt';
const CSV_REL = 'public/cartoon-preferences.master.csv';

function readSource() {
    const raw = readFileSync(path.join(ROOT, SOURCE_REL), 'utf8');
    const json = raw
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('//'))
        .join('\n');
    return JSON.parse(json);
}

function parseCsv(text) {
    const rows = [];
    let row = [], field = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quoted) {
            if (c === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; }
                else quoted = false;
            } else field += c;
        } else if (c === '"') quoted = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else field += c;
    }
    return rows;
}

function readCsv() {
    return parseCsv(readFileSync(path.join(ROOT, CSV_REL), 'utf8').trim());
}

describe('cartoon-preferences questions ask about the learner (first person)', () => {
    const source = readSource();

    it('levels A2/B1/B2 ask in the first person', () => {
        expect(source.levels.A2.en).toBe('Am I more like X or Y?');
        expect(source.levels.B1.en).toBe("Would you say I'm more like X or Y?");
        expect(source.levels.B2.en).toBe("If someone asked which one I'm more like, would you say X or Y?");
    });

    it('no topic question is in the second person', () => {
        const questions = source.pairs.flatMap((pair) =>
            pair.topics.flatMap((topic) => topic.question.slice(1))
        );
        expect(questions.length).toBeGreaterThan(0);
        for (const question of questions) {
            expect(question, question).not.toMatch(/Are you more like|you're more like|you are more like/);
        }
    });

    it('every topic question is in the first person', () => {
        const questions = source.pairs.flatMap((pair) =>
            pair.topics.flatMap((topic) => topic.question.slice(1))
        );
        for (const question of questions) {
            expect(question, question).toMatch(/Am I more like|I'm more like/);
        }
    });
});

describe('cartoon-preferences answers talk about the learner (second person)', () => {
    const source = readSource();

    it('no answer is in the first person', () => {
        const answers = source.pairs.flatMap((pair) =>
            pair.topics.flatMap((topic) => topic.answers.flat())
        );
        expect(answers.length).toBeGreaterThan(0);
        for (const answer of answers) {
            expect(answer, answer).not.toMatch(/Am I more like|\bI'm more like|I'd say I'm more like/);
        }
    });

    it('every non-bare answer is in the second person', () => {
        const answers = source.pairs.flatMap((pair) =>
            pair.topics.flatMap((topic) => topic.answers.flat())
        ).filter((answer) => !/^[A-Z][\w ]*\.$/.test(answer) || answer.split(' ').length > 3);
        for (const answer of answers) {
            if (/^(Mickey|Bugs|Tom|Jerry|Donald|Daffy|SpongeBob|Patrick|Shrek|Donkey|Simba|Nemo|Elsa|Moana|Woody|Buzz|Homer|Bart)/.test(answer) && !/more like/.test(answer)) continue;
            expect(answer, answer).toMatch(/You're more like|you're more like/);
        }
    });
});

describe('the generated master CSV carries the same speakers', () => {
    const rows = readCsv();
    const header = rows[0];
    const phraseIdx = header.indexOf('phrase');
    const fileIdx = header.indexOf('filename');

    it('question-lesson cells are first person', () => {
        let checked = 0;
        for (let r = 1; r < rows.length; r++) {
            const file = rows[r][fileIdx] || '';
            const phrase = rows[r][phraseIdx] || '';
            if (!phrase || !/cartoon-preferences-[ace]-/.test(file)) continue;
            checked++;
            expect(phrase, file).not.toMatch(/Are you more like|you're more like/i);
        }
        expect(checked).toBeGreaterThan(0);
    });

    it('answer-lesson cells are second person', () => {
        let checked = 0;
        for (let r = 1; r < rows.length; r++) {
            const file = rows[r][fileIdx] || '';
            const phrase = rows[r][phraseIdx] || '';
            if (!phrase || !/cartoon-preferences-[bdf]-/.test(file)) continue;
            checked++;
            expect(phrase, file).not.toMatch(/Am I more like|\bI'm more like|I'd say I'm more like/);
        }
        expect(checked).toBeGreaterThan(0);
    });
});
