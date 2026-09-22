import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.join(__dirname, '../../config');

const RECAP_SOURCES = ['system', 'friend', 'none'];
const RECAP_OVERLAYS = ['fluency', 'shareCta', 'none'];

function loadConfig(name) {
    return JSON.parse(readFileSync(path.join(CONFIG_DIR, name), 'utf8'));
}

describe('model.json recap flags', () => {
    const model = loadConfig('model.json');

    it('sets recapSources/recapOverlay on the friend-challenge lessons', () => {
        const expected = {
            w: { recapSources: 'none', recapOverlay: 'shareCta' },
            wf: { recapSources: 'none', recapOverlay: 'shareCta' },
            wa: { recapSources: 'friend', recapOverlay: 'shareCta' },
            wfa: { recapSources: 'friend', recapOverlay: 'shareCta' },
        };
        for (const [lessonId, flags] of Object.entries(expected)) {
            const lesson = model.lessons.find(l => l.lessonId === lessonId);
            expect(lesson, `lesson ${lessonId} should exist`).toBeDefined();
            expect(lesson.recapSources).toBe(flags.recapSources);
            expect(lesson.recapOverlay).toBe(flags.recapOverlay);
        }
    });

    it('leaves recapSources/recapOverlay unset on every other lesson', () => {
        const flagged = model.lessons
            .filter(l => l.recapSources !== undefined || l.recapOverlay !== undefined)
            .map(l => l.lessonId);

        expect(flagged.sort()).toEqual(['w', 'wa', 'wf', 'wfa']);
    });

    it('removes webcamOnly from every lesson', () => {
        const flagged = model.lessons
            .filter(l => l.webcamOnly !== undefined)
            .map(l => l.lessonId);

        expect(flagged).toEqual([]);
    });
});

describe('friend.json recap flags', () => {
    const friend = loadConfig('friend.json');

    it('sets recapSources/recapOverlay on lessons a and b', () => {
        const a = friend.lessons.find(l => l.lessonId === 'a');
        const b = friend.lessons.find(l => l.lessonId === 'b');
        expect(a).toBeDefined();
        expect(b).toBeDefined();
        expect(a.recapSources).toBe('none');
        expect(a.recapOverlay).toBe('shareCta');
        expect(b.recapSources).toBe('friend');
        expect(b.recapOverlay).toBe('shareCta');
    });

    it('removes webcamOnly from every lesson', () => {
        const flagged = friend.lessons
            .filter(l => l.webcamOnly !== undefined)
            .map(l => l.lessonId);

        expect(flagged).toEqual([]);
    });
});

describe('recap flag values are valid', () => {
    it('every recapSources value is one of system|friend|none', () => {
        for (const name of ['model.json', 'friend.json']) {
            const config = loadConfig(name);
            for (const lesson of config.lessons) {
                if (lesson.recapSources !== undefined) {
                    expect(RECAP_SOURCES).toContain(lesson.recapSources);
                }
            }
        }
    });

    it('every recapOverlay value is one of fluency|shareCta|none', () => {
        for (const name of ['model.json', 'friend.json']) {
            const config = loadConfig(name);
            for (const lesson of config.lessons) {
                if (lesson.recapOverlay !== undefined) {
                    expect(RECAP_OVERLAYS).toContain(lesson.recapOverlay);
                }
            }
        }
    });
});