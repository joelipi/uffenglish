// Guards for the success clip's autoplay (stories/094).
//
// On iPad the success video needed a tap before it played: `SuccessVideo` used
// `video.play().catch(() => {})` in a plain effect — an unmuted play() outside a
// gesture, a swallowed `undefined` return, and no readiness wait. It now uses the
// same ladder as the recorded take, so these guards keep the two in step.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');

function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function sliceBetween(source, startToken, endToken) {
    const start = source.indexOf(startToken);
    if (start === -1) throw new Error(`start token missing: ${startToken}`);
    const end = source.indexOf(endToken, start + startToken.length);
    if (end === -1) throw new Error(`end token missing: ${endToken}`);
    return source.slice(start, end);
}

const raw = readFileSync(path.join(ROOT, 'src/components/widgets/SuccessVideo.jsx'), 'utf8');
const stripped = stripComments(raw);
const blobEffect = sliceBetween(raw, 'useEffect(() => {', '}, [blob]);');

describe('the success clip uses the shared start rules', () => {
    it('imports them from the video module', () => {
        expect(raw).toContain('playSafely,');
        expect(raw).toContain('setElementMuted,');
        expect(raw).toContain('shouldStartMuted,');
        expect(raw).toContain('shouldRetryStart,');
        expect(raw).toContain('shouldWaitForReadiness,');
        expect(raw).toContain("from '../../modules/video/playback-start-logic.js';");
    });

    it('never calls .play().catch( directly (the WebKit undefined-return crash)', () => {
        expect(stripped).not.toContain('.play().catch(');
        expect(stripped).not.toContain('?.play().catch(');
    });
});

describe('the success clip walks the same ladder', () => {
    it('waits for readiness before asking to play', () => {
        expect(blobEffect).toContain('shouldWaitForReadiness(el.readyState)');
        expect(blobEffect.indexOf('shouldWaitForReadiness(el.readyState)'))
            .toBeLessThan(blobEffect.indexOf('playSafely(el)'));
    });

    it('asks for the only start iPadOS allows, then retries muted', () => {
        expect(blobEffect).toContain('preferMutedStart: isIOS');
        expect(blobEffect).toContain('setElementMuted(el, muted)');
        // The mute must be applied BEFORE play() is asked for.
        expect(blobEffect.indexOf('setElementMuted(el, muted)'))
            .toBeLessThan(blobEffect.indexOf('playSafely(el)'));
    });

    it('retries a refusal through the shared gate and re-opens the audio', () => {
        expect(blobEffect).toContain('shouldRetryStart({ attempt, errorName: name })');
        expect(blobEffect).toContain('retryDelayMs(attempt)');
        expect(blobEffect).toContain('setElementMuted(current, false)');
        expect(blobEffect.indexOf('setElementMuted(current, false)'))
            .toBeLessThan(blobEffect.lastIndexOf('playSafely(current)'));
    });

    it('reports the attempts to the console and the ?diag panel', () => {
        expect(blobEffect).toContain("takeDiagnostics.push('success start attempt'");
        expect(blobEffect).toContain("takeDiagnostics.push('success play refused'");
    });

    it('clears its timers and the object url on unmount', () => {
        expect(blobEffect).toContain('cancelled = true;');
        expect(blobEffect).toContain('clearTimeout(retryTimer);');
        expect(blobEffect).toContain('clearTimeout(readyTimer);');
        expect(blobEffect).toContain('clearTimeout(unmuteTimer);');
        expect(blobEffect).toContain('URL.revokeObjectURL(url);');
    });
});
