// Source-shape guards for the friend/shareCta hesitation suppression.
//
// The suppression spans two untestable-in-jsdom modules: step-executor-webonly.js
// reads browser globals / the app store, and speech-orchestrator.js owns the
// timer. The pure policy is covered by hesitation-logic.test.js and the timer
// gate by the orchestrator test; these guards only prove the two call sites are
// actually wired, so a refactor cannot silently drop the flag.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = resolve(process.cwd(), 'src');
const EXECUTOR = readFileSync(resolve(SRC, 'modules/lesson/step-executor-webonly.js'), 'utf8');
const ORCHESTRATOR = readFileSync(resolve(SRC, 'modules/speech/speech-orchestrator.js'), 'utf8');

describe('hesitation suppression wiring', () => {
    it('step-executor resolves the policy and forwards trackHesitation', () => {
        expect(EXECUTOR).toContain("import { shouldTrackHesitation } from '../speech/hesitation-logic.js'");
        expect(EXECUTOR).toMatch(/shouldTrackHesitation\(\{/);
        expect(EXECUTOR).toMatch(/responseType: step\.responseType/);
        expect(EXECUTOR).toMatch(/recapOverlay: lesson\?\.recapOverlay/);
        expect(EXECUTOR).toMatch(/toggleSpeechRecognition\(\{[\s\S]*?trackHesitation,/);
    });

    it('orchestrator only builds the timer when trackHesitation is on', () => {
        expect(ORCHESTRATOR).toMatch(/trackHesitation = true/);
        expect(ORCHESTRATOR).toMatch(/if \(trackHesitation\) \{/);
    });
});
