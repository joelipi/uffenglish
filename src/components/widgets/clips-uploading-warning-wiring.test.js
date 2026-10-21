// src/components/widgets/clips-uploading-warning-wiring.test.js
// Source guard for the "keep this tab open while clips upload" warning. The
// publish path needs MediaRecorder/WebCodecs and cannot run in vitest, so the
// wiring is asserted as text (same convention as the other *-wiring guards).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(__dirname, rel), 'utf8');

const buttons = read('./SuccessButtons.jsx');
const screen = read('./SuccessScreen.jsx');
const strings = read('../../data/strings.js');
const store = read('../../modules/store/store.js');

// Slices a region between two real markers. A slice that runs to EOF would
// swallow whatever is appended later, so every region is bounded explicitly.
function sliceBetween(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    expect(start, `missing start marker: ${startMarker}`).toBeGreaterThan(-1);
    const end = source.indexOf(endMarker, start + startMarker.length);
    expect(end, `missing end marker: ${endMarker}`).toBeGreaterThan(start);
    return source.slice(start, end);
}

describe('clips-uploading warning wiring', () => {
    it('flags clipsPublishing around the export', () => {
        const setTrue = buttons.indexOf('setClipsPublishing(true)');
        const exportAt = buttons.indexOf('await exportSegmentsToR2(');
        const setFalse = buttons.indexOf('setClipsPublishing(false)');
        expect(setTrue).toBeGreaterThan(-1);
        expect(exportAt).toBeGreaterThan(setTrue);
        expect(setFalse).toBeGreaterThan(exportAt);
        // Cleared in a finally so a publish failure still hides the warning.
        expect(buttons).toMatch(/finally\s*\{\s*appStore\.getState\(\)\.setClipsPublishing\(false\)/);
    });

    it('renders the warning from the flag and guards beforeunload', () => {
        expect(screen).toMatch(/clipsPublishing/);
        expect(screen).toMatch(/id="clipsUploadingWarning"/);
        // A real alert (background + role), localized to a single language.
        expect(screen).toMatch(/role="alert"/);
        expect(screen).toMatch(/background: '#ffc107'/);
        expect(screen).toMatch(/Strings\.get\('clips_uploading_warning'/);
        expect(screen).toMatch(/window\.addEventListener\('beforeunload'/);
        expect(screen).toMatch(/window\.removeEventListener\('beforeunload'/);
    });

    it('ships the warning copy in en + hi + bn', () => {
        const block = strings.match(/'clips_uploading_warning':\s*\{([\s\S]*?)\n\s*\},/);
        expect(block).toBeTruthy();
        expect(block[1]).toMatch(/\ben:/);
        expect(block[1]).toMatch(/\bhi:/);
        expect(block[1]).toMatch(/\bbn:/);
    });

    it('exposes the store flag + setter', () => {
        expect(store).toMatch(/clipsPublishing:\s*false/);
        expect(store).toMatch(/setClipsPublishing:\s*\(publishing\)\s*=>/);
    });
});

// The Continue button must not appear while this warning is on screen: the
// learner would leave the lesson and abort the upload the warning is about.
describe('Continue is gated on the clip upload', () => {
    it('the warning and the Continue button read the same flag', () => {
        // The warning (SuccessScreen) and the button (SuccessButtons) must
        // both follow `clipsPublishing` — two different flags would let the
        // button appear while the warning is up.
        expect(screen).toMatch(/useStore\(appStore,\s*state\s*=>\s*state\.clipsPublishing\)/);
        expect(buttons).toMatch(/useStore\(appStore,\s*state\s*=>\s*state\.clipsPublishing\)/);
    });

    it('the Continue button renders only through the shared gate', () => {
        const continueButton = sliceBetween(
            buttons,
            'export function ContinueButton(',
            'export function VideoButton('
        );
        // The decision is the pure predicate, not an inline check in JSX.
        expect(continueButton).toMatch(/shouldShowSuccessContinue\(\{\s*visible:\s*button\.visible,\s*clipsPublishing\s*\}\)/);
        // A raw visibility check would bypass the upload gate.
        expect(continueButton).not.toMatch(/if\s*\(\s*!button\.visible\s*\)\s*return null/);
    });

    it('the publish gate is raised before the Continue reveal', () => {
        const runProcessing = sliceBetween(
            buttons,
            'const runProcessing = useCallback(',
            'if (!button.visible) return null;'
        );
        const gateUp = runProcessing.indexOf('setClipsPublishing(true)');
        const reveal = runProcessing.indexOf('setContinueVisible(true)');
        expect(gateUp).toBeGreaterThan(-1);
        expect(reveal).toBeGreaterThan(-1);
        // The upload gate goes up first, so the reveal can never land while
        // the clips are still uploading.
        expect(gateUp).toBeLessThan(reveal);
        // ...and it comes down again before the reveal (the finally).
        expect(runProcessing.indexOf('setClipsPublishing(false)')).toBeLessThan(reveal);
    });
});
