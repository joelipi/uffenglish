// Source guards for the on-screen diagnostics panel (stories/094).
//
// The panel exists because the iPad field reports come from a device where
// copying the console is impractical: if the wiring silently stops pushing, the
// panel shows an empty box and the next report is another round trip.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');

function read(rel) {
    return readFileSync(path.join(ROOT, rel), 'utf8');
}

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

const overlay = read('src/components/widgets/TakeDiagnosticsOverlay.jsx');
const lessonContainer = read('src/components/LessonContainer.jsx');
const playback = read('src/components/PlaybackVideo.jsx');
const speech = read('src/modules/speech/speech.web.js');

describe('the diagnostics panel is mounted and gated', () => {
    it('LessonContainer mounts the overlay once', () => {
        expect(lessonContainer).toContain("import TakeDiagnosticsOverlay from './widgets/TakeDiagnosticsOverlay.jsx';");
        expect(lessonContainer).toContain('<TakeDiagnosticsOverlay />');
    });

    it('renders nothing unless the URL asks for it', () => {
        expect(overlay).toContain('shouldShowDiagnostics(window.location.search)');
        expect(overlay).toContain('if (!enabled) return null;');
        // The gate must be decided BEFORE the panel is returned.
        expect(overlay.indexOf('shouldShowDiagnostics(window.location.search)'))
            .toBeLessThan(overlay.indexOf('if (!enabled) return null;'));
    });

    it('subscribes to the log and unsubscribes on unmount', () => {
        const effect = sliceBetween(overlay, 'useEffect(() => {', '}, [enabled]);');
        expect(effect).toContain('takeDiagnostics.entries()');
        expect(effect).toContain('takeDiagnostics.subscribe(');
        // The subscription's clean-up is what React calls on unmount.
        expect(effect).toContain('return takeDiagnostics.subscribe(');
    });

    it('exposes selectable text and a copy affordance', () => {
        expect(overlay).toContain('id="takeDiagnosticsText"');
        expect(overlay).toContain('userSelect:');
        expect(overlay).toContain('id="takeDiagnosticsCopy"');
        expect(overlay).toContain('copyDiagnostics(text)');
    });
});

describe('every take diagnostic reaches the log', () => {
    it('the player pushes the start attempts and the media samples', () => {
        expect(playback).toContain("import { takeDiagnostics } from '../modules/diagnostics/take-diagnostics.js';");
        const startAttempt = sliceBetween(playback, 'const attemptStart = (attempt = 0, { fromGesture = false } = {}) => {', '\n    };');
        expect(startAttempt).toContain("takeDiagnostics.push('start attempt '");
        const playing = sliceBetween(playback, 'const handleVideoPlaying = () => {', '\n    };');
        expect(playing).toContain("takeDiagnostics.push('playback sample'");
        const metadata = sliceBetween(playback, 'const handleLoadedMetadata = () => {', '\n    };');
        expect(metadata).toContain("takeDiagnostics.push('take media'");
        const unmute = sliceBetween(playback, 'const unmuteAfterStart = () => {', '\n    };');
        expect(unmute).toContain("takeDiagnostics.push('unmuted after muted start')");
    });

    it('the recorder pushes the capture and the recorded blob', () => {
        expect(speech).toContain("import { takeDiagnostics } from '../diagnostics/take-diagnostics.js';");
        const start = sliceBetween(speech, 'speechCamTakeIndex += 1;', 'speechCamRecorder = new MediaRecorder');
        expect(start).toContain("takeDiagnostics.push('capture take '");
        const blob = sliceBetween(speech, 'const blobDiagnostics = describeRecordingBlob(', "takeDiagnostics.push('blob take '");
        expect(blob).toContain('take: speechCamTakeIndex');
    });

    it('the pushes are comment-free code, not prose in a comment', () => {
        // Comment-stripped: the guard's own description must not satisfy it.
        const strippedPlayback = stripComments(playback);
        expect(strippedPlayback).toContain("takeDiagnostics.push('take media'");
        expect(strippedPlayback).toContain("takeDiagnostics.push('playback sample'");
        const strippedSpeech = stripComments(speech);
        expect(strippedSpeech).toContain("takeDiagnostics.push('blob take '");
    });
});
