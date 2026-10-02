// Source-shape guards for the repeated-use resource fixes (story 038).
//
// These assert on the source text rather than runtime behavior because the
// modules involved import browser globals (`speech.web.js` reads `navigator`
// at module load) and so cannot be imported in jsdom. They stop the exact
// regressions the story fixed from silently reappearing.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(process.cwd(), 'src');

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) {
            walk(full, out);
        } else if (full.endsWith('.js') || full.endsWith('.jsx')) {
            out.push(full);
        }
    }
    return out;
}

function read(path) {
    return readFileSync(resolve(SRC, path), 'utf8');
}

describe('resource retention guards', () => {
    it('retains no playbackSpeechCamChunks reference in non-test src', () => {
        const offenders = walk(SRC)
            .filter((f) => !f.endsWith('.test.js'))
            .filter((f) => readFileSync(f, 'utf8').includes('playbackSpeechCamChunks'));
        expect(offenders).toEqual([]);
    });

    it('calls setPlaybackBlob with exactly two arguments from speech.web.js', () => {
        const source = read('modules/speech/speech.web.js');
        const calls = source.match(/setPlaybackBlob\([^)]*\)/g) || [];
        expect(calls.length).toBeGreaterThan(0);
        for (const call of calls) {
            const args = call.slice('setPlaybackBlob('.length, -1);
            // Count top-level commas: two arguments => exactly one comma and no
            // nested commas beyond the blob/autoplay identifiers.
            expect(args).toBe('blob, autoplay');
        }
    });

    it('tracks the readiness poll on listeningState in the orchestrator', () => {
        const source = read('modules/speech/speech-orchestrator.js');
        expect(source).toMatch(/readyPoll:\s*null/);
        expect(source).toMatch(/listeningState\.readyPoll\s*=\s*setInterval/);
        expect(source).toMatch(/clearInterval\(listeningState\.readyPoll\)/);
    });

    it('clears listeningState.readyPoll in the step reset', () => {
        const source = read('modules/lesson/step-executor-webonly.js');
        expect(source).toMatch(/listeningState\.readyPoll/);
        expect(source).toMatch(/clearInterval\(listeningState\.readyPoll\)/);
    });

    it('does not change the recording key in storage.web.js', () => {
        const source = read('modules/storage/storage.web.js');
        // Deliberate per-attempt recording key must remain (story 038 out of scope).
        expect(source).toMatch(/uffvideo_\$\{lessonId\}_\$\{stepIndex\}_\$\{timestamp\}_\$\{seq\}/);
    });
});
