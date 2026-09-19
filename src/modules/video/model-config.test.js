import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL_PATH = path.join(__dirname, '../../config/model.json');

const model = JSON.parse(readFileSync(MODEL_PATH, 'utf8'));

describe('model.json webcamOnly flag', () => {
    it('sets webcamOnly on the friend-challenge Ask lessons w and wf', () => {
        for (const lessonId of ['w', 'wf']) {
            const lesson = model.lessons.find(l => l.lessonId === lessonId);
            expect(lesson, `lesson ${lessonId} should exist`).toBeDefined();
            expect(lesson.webcamOnly).toBe(true);
        }
    });

    it('leaves webcamOnly unset on every other lesson', () => {
        const flagged = model.lessons
            .filter(l => l.webcamOnly !== undefined)
            .map(l => l.lessonId);

        expect(flagged.sort()).toEqual(['w', 'wf']);
    });
});
