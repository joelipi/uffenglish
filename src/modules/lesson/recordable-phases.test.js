import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { RECORDABLE_PHASES, isRecordablePhase } from './recordable-phases.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');

function read(rel) {
    return readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('recordable-phases', () => {
    it('includes the simple-video response decision phase', () => {
        expect(isRecordablePhase('simpleVideo-decisionTime-response')).toBe(true);
    });

    it('preserves the existing recordable phases', () => {
        expect(isRecordablePhase('simpleVideo')).toBe(true);
        expect(isRecordablePhase('firstResponse')).toBe(true);
        expect(isRecordablePhase('interactiveVideo-decisionTime-closedResponse')).toBe(true);
        expect(isRecordablePhase('interactiveVideo-decisionTime-openResponse')).toBe(true);
        expect(isRecordablePhase('interactiveVideo-decisionTime-friendClosedResponse')).toBe(true);
    });

    it('rejects non-recordable phases', () => {
        expect(isRecordablePhase('recording/answering')).toBe(false);
        expect(isRecordablePhase('interactiveVideo+friendClosedResponse')).toBe(false);
        expect(isRecordablePhase(undefined)).toBe(false);
    });

    it('exports the list itself for unit-testability', () => {
        expect(Array.isArray(RECORDABLE_PHASES)).toBe(true);
        expect(RECORDABLE_PHASES).toContain('simpleVideo-decisionTime-response');
    });
});

describe('step-executor-webonly.js onRecordingStart gate', () => {
    const source = read('src/modules/lesson/step-executor-webonly.js');

    it('does not inline the recordable-phase list', () => {
        expect(source).not.toContain('RECORDABLE_PHASES.includes(');
    });

    it('uses the single-sourced isRecordablePhase helper', () => {
        expect(source).toContain('isRecordablePhase(');
    });
});
