// audio-guard-wiring.test.js
// Source guards for the lesson-video audio guard and the capture release
// (stories/075-fix-android-silent-video-start).
//
// Guard discipline (docs/learnings.md): every slice runs from its
// function/export start to the NEXT real marker (never EOF); sequenced calls
// assert index order, not co-presence; the "the call is inside the block"
// assertions are made against the SLICE, so an import or a destructuring
// cannot satisfy them; absence assertions use comment-stripped source so the
// guard's own prose cannot false-positive.
//
// Fail-proof note: proven able to fail by temporarily (a) deleting
// `audioGuardRef.current?.start();` from handlePlay, (b) removing the
// `loadedElementRef` guard around `video.load()`, and (c) replacing
// `releaseSpeechCam()` with `setWebcamStream(null)` in the step executor.
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

const simpleRaw = readFileSync(path.join(ROOT, 'src/components/SimpleVideoPlayer.web.jsx'), 'utf8');
const interactiveRaw = readFileSync(path.join(ROOT, 'src/components/InteractiveVideoPlayer.web.jsx'), 'utf8');
const stepExecutorRaw = readFileSync(path.join(ROOT, 'src/modules/lesson/step-executor-webonly.js'), 'utf8');
const speechRaw = readFileSync(path.join(ROOT, 'src/modules/speech/speech.web.js'), 'utf8');
const stepLoaderRaw = readFileSync(path.join(ROOT, 'src/components/step-loader.web.js'), 'utf8');

describe('SimpleVideoPlayer audio guard', () => {
    const guardCreation = sliceBetween(
        simpleRaw,
        'const guard = createAudioGuard({',
        'audioGuardRef.current = guard;'
    );

    it('imports the guard from the video module (raw: the path contains slashes)', () => {
        expect(simpleRaw).toContain("import { createAudioGuard } from '../modules/video/audio-guard.js';");
    });

    it('creates the guard inside the effect, watching the video element', () => {
        expect(guardCreation).toContain('createAudioGuard({');
        expect(guardCreation).toContain('getElement: () => videoRef.current');
        expect(guardCreation).toContain('isExpectedAudible: () => true');
    });

    it('starts the guard when the clip starts playing', () => {
        const handlePlay = sliceBetween(
            simpleRaw,
            'const handlePlay = useCallback(() => {',
            '\n    }, []);'
        );
        expect(handlePlay).toContain('audioGuardRef.current?.start();');
    });

    it('stops the guard when the clip pauses and when it ends', () => {
        const handlePause = sliceBetween(
            simpleRaw,
            'const handlePause = useCallback(() => {',
            '\n    }, []);'
        );
        const handleEnded = sliceBetween(
            simpleRaw,
            'const handleEnded = useCallback(() => {',
            '\n    }, []);'
        );
        expect(handlePause).toContain('audioGuardRef.current?.stop();');
        expect(handleEnded).toContain('audioGuardRef.current?.stop();');
    });
});

describe('InteractiveVideoPlayer audio guard', () => {
    const guardCreation = sliceBetween(
        interactiveRaw,
        'const guard = createAudioGuard({',
        'audioGuardRef.current = guard;'
    );

    it('imports the guard from the video module (raw: the path contains slashes)', () => {
        expect(interactiveRaw).toContain("import { createAudioGuard } from '../modules/video/audio-guard.js';");
    });

    it('creates the guard inside the effect, watching the video element', () => {
        expect(guardCreation).toContain('createAudioGuard({');
        expect(guardCreation).toContain('getElement: () => videoRef.current');
    });

    it('starts the guard on play and stops it on pause and on ended', () => {
        const onPlay = sliceBetween(interactiveRaw, 'const onPlay = useCallback(() => {', '\n    }, [handleVideoPlay]);');
        const onPause = sliceBetween(interactiveRaw, 'const onPause = useCallback(() => {', '\n    }, [handlePause]);');
        const onEnded = sliceBetween(interactiveRaw, 'const onEnded = useCallback(() => {', '\n    }, [handleLoop]);');
        expect(onPlay).toContain('audioGuardRef.current?.start();');
        expect(onPause).toContain('audioGuardRef.current?.stop();');
        expect(onEnded).toContain('audioGuardRef.current?.stop();');
    });
});

describe('the media is loaded once per element and source', () => {
    it('SimpleVideoPlayer guards video.load() and keeps the guard check before it', () => {
        const attempt = sliceBetween(simpleRaw, 'const attemptAutoplay = () => {', '\n        };');
        expect(attempt).toContain('loadedElementRef.current?.element !== video');
        expect(attempt).toContain('video.load();');
        expect(attempt.indexOf('loadedElementRef.current?.element !== video'))
            .toBeLessThan(attempt.indexOf('video.load();'));
    });

    it('InteractiveVideoPlayer guards video.load() and keeps the guard check before it', () => {
        const attempt = sliceBetween(interactiveRaw, 'const attemptAutoplay = () => {', '\n        };');
        expect(attempt).toContain('loadedElementRef.current?.element !== video');
        expect(attempt).toContain('video.load();');
        expect(attempt.indexOf('loadedElementRef.current?.element !== video'))
            .toBeLessThan(attempt.indexOf('video.load();'));
    });
});

describe('the muted autoplay fallback restores the audio', () => {
    it('SimpleVideoPlayer unmutes and re-issues play()', () => {
        const tryPlay = sliceBetween(simpleRaw, 'const tryPlay = () => {', '\n        };');
        expect(tryPlay).toContain('video.muted = true;');
        expect(tryPlay).toContain('video.muted = false;');
        const mute = tryPlay.indexOf('video.muted = true;');
        const unmute = tryPlay.indexOf('video.muted = false;');
        expect(mute).toBeGreaterThan(-1);
        expect(unmute).toBeGreaterThan(mute);
        // The re-issued play() must come AFTER the unmute — re-issuing it
        // while the element is still muted would not re-open the audio output.
        expect(unmute).toBeLessThan(tryPlay.lastIndexOf('video.play()'));
    });

    it('InteractiveVideoPlayer unmutes and re-issues play()', () => {
        const tryPlay = sliceBetween(interactiveRaw, 'const tryPlay = () => {', '\n        };');
        expect(tryPlay).toContain('video.muted = true;');
        expect(tryPlay).toContain('video.muted = false;');
        const mute = tryPlay.indexOf('video.muted = true;');
        const unmute = tryPlay.indexOf('video.muted = false;');
        expect(mute).toBeGreaterThan(-1);
        expect(unmute).toBeGreaterThan(mute);
        expect(unmute).toBeLessThan(tryPlay.lastIndexOf('video.play()'));
    });
});

describe('the capture is released at the step boundary', () => {
    it('releaseSpeechCamStream clears the store reference AND stops the tracks', () => {
        const release = sliceBetween(
            speechRaw,
            'export function releaseSpeechCamStream() {',
            '\n}'
        );
        expect(release).toContain('setWebcamStream(null)');
        expect(release).toContain('safelyStopStream()');
    });

    it('the step executor releases the capture on a step that plays a video', () => {
        const onStepLoaded = sliceBetween(
            stepExecutorRaw,
            'const onStepLoaded = (step, lesson, fluencyData) => {',
            '\n    };'
        );
        expect(onStepLoaded).toContain('releaseSpeechCam()');
        // The injected release must be preferred over the store-only clear.
        expect(onStepLoaded.indexOf("typeof releaseSpeechCam === 'function'"))
            .toBeLessThan(onStepLoaded.indexOf('releaseSpeechCam();'));
    });

    it('the step executor takes releaseSpeechCam as an injected dependency', () => {
        const deps = sliceBetween(
            stepExecutorRaw,
            'export function createLoadStep(deps) {',
            '\n    }'
        );
        expect(deps).toContain('releaseSpeechCam,');
    });

    it('the web step loader wires the real capture release', () => {
        expect(stepLoaderRaw).toContain('releaseSpeechCam: () => releaseSpeechCamStream(),');
    });

    it('the step executor no longer clears the webcam stream on its own', () => {
        // Comment-stripped: the guard's own prose must not satisfy the check.
        const stripped = stripComments(stepExecutorRaw);
        const onStepLoaded = sliceBetween(
            stripped,
            'const onStepLoaded = (step, lesson, fluencyData) => {',
            '\n    };'
        );
        // The store-only clear survives only as the fallback when no release
        // dependency was injected.
        const fallback = onStepLoaded.indexOf('setWebcamStream(null)');
        const release = onStepLoaded.indexOf('releaseSpeechCam();');
        expect(fallback).toBeGreaterThan(-1);
        expect(release).toBeGreaterThan(-1);
        expect(fallback).toBeGreaterThan(release);
    });
});
