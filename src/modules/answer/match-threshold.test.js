import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    resolveMatchThreshold,
    isMatchAtThreshold,
    SHORT_CUE_MAX_LENGTH,
    SHORT_CUE_THRESHOLD,
    LONG_CUE_THRESHOLD
} from './match-threshold.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ANSWERS_SRC = fs.readFileSync(path.join(HERE, 'answers.js'), 'utf8');

// Bounded slice of a function body: from its own declaration up to the next
// top-level marker. Never to EOF — a function appended later would join the
// slice and satisfy a token search that is not in the target function.
function sliceBetween(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    if (start === -1 || end === -1 || end <= start) {
        throw new Error(`slice markers not found: ${startMarker} … ${endMarker}`);
    }
    return source.slice(start, end);
}

// True only when BOTH closed-response call sites judge each candidate with the
// length-dependent threshold. A hard-coded single threshold (the old 95) fails.
function detectsLengthTieredThreshold(source) {
    const evaluate = sliceBetween(
        source,
        'async function evaluateClosedResponse(',
        'export async function findMatchingCueText('
    );
    const findCue = sliceBetween(
        source,
        'export async function findMatchingCueText(',
        '* Expands a template string'
    );
    return evaluate.includes('isMatchAtThreshold(')
        && evaluate.includes('resolveMatchThreshold(')
        && findCue.includes('isMatchAtThreshold(');
}

describe('match-threshold', () => {
    it('pins the tiers the product decided on', () => {
        expect(SHORT_CUE_MAX_LENGTH).toBe(60);
        expect(SHORT_CUE_THRESHOLD).toBe(85);
        expect(LONG_CUE_THRESHOLD).toBe(90);
    });

    it('uses the short tier at and below the breakpoint', () => {
        expect(resolveMatchThreshold(0)).toBe(85);
        expect(resolveMatchThreshold(1)).toBe(85);
        expect(resolveMatchThreshold(20)).toBe(85);
        expect(resolveMatchThreshold(SHORT_CUE_MAX_LENGTH)).toBe(85);
    });

    it('uses the long tier one character past the breakpoint', () => {
        expect(resolveMatchThreshold(SHORT_CUE_MAX_LENGTH + 1)).toBe(90);
        expect(resolveMatchThreshold(120)).toBe(90);
        expect(resolveMatchThreshold(179)).toBe(90);
    });

    it('treats a missing or non-numeric length as the short tier', () => {
        expect(resolveMatchThreshold(undefined)).toBe(85);
        expect(resolveMatchThreshold(null)).toBe(85);
        expect(resolveMatchThreshold(NaN)).toBe(85);
    });

    it('is inclusive at each tier boundary', () => {
        expect(isMatchAtThreshold(85, 20)).toBe(true);
        expect(isMatchAtThreshold(84.9, 20)).toBe(false);
        expect(isMatchAtThreshold(90, 91)).toBe(true);
        expect(isMatchAtThreshold(89.9, 91)).toBe(false);
    });

    it('puts the same score on different sides of the two tiers', () => {
        expect(isMatchAtThreshold(87, 60)).toBe(true);
        expect(isMatchAtThreshold(87, 61)).toBe(false);
    });
});

describe('answers.js uses the length-dependent threshold (source guard)', () => {
    it('detects the wiring in the real source', () => {
        expect(detectsLengthTieredThreshold(ANSWERS_SRC)).toBe(true);
    });

    it('has no single hard-coded threshold left', () => {
        expect(ANSWERS_SRC).not.toMatch(/threshold\s*=\s*95/);
        expect(ANSWERS_SRC).not.toContain('>= 95');
    });

    it('goes red when the per-candidate check is replaced by a constant', () => {
        // Each call site is mutated on its OWN shape: the two functions call the
        // module with different arguments, so a mutation of one would leave the
        // other's blind spot untested.
        const evaluateMutated = ANSWERS_SRC.replace(
            'isMatchAtThreshold(sim, candidate.length)',
            'true'
        );
        expect(evaluateMutated).not.toBe(ANSWERS_SRC);
        expect(detectsLengthTieredThreshold(evaluateMutated)).toBe(false);

        const findCueMutated = ANSWERS_SRC.replace(
            'isMatchAtThreshold(sim, normalized.length)',
            'true'
        );
        expect(findCueMutated).not.toBe(ANSWERS_SRC);
        expect(detectsLengthTieredThreshold(findCueMutated)).toBe(false);
    });
});
