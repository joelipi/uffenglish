// success-continue-wiring.test.js
// Static guards for the friend-row delayed Continue (story 061, Task 4):
// the timer, the delay decision, and the friend-row render gate live in
// modules — the components only wire them. Asserted on raw source, never
// comment-stripped.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const buttons = readFileSync(path.join(__dirname, 'SuccessButtons.jsx'), 'utf8');
const screen = readFileSync(path.join(__dirname, 'SuccessScreen.jsx'), 'utf8');

describe('delayed Continue wiring', () => {
    it('creates no timers and decides no overlay rules inside SuccessButtons', () => {
        expect(buttons).toContain('success-continue-logic');
        expect(buttons).not.toContain('setTimeout');
        expect(buttons).not.toContain('recapOverlay ===');
    });

    it('keeps Repeat friend-gated while Continue renders on every row', () => {
        expect(screen).toContain('!isFriendLesson && <RepeatButton');
        expect(screen).not.toContain('!isFriendLesson && <ContinueButton');
        expect(screen).toContain('<ContinueButton onLoadNextLesson');
    });
});
