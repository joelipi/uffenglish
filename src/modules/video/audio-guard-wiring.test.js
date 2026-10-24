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
const playbackRaw = readFileSync(path.join(ROOT, 'src/components/PlaybackVideo.jsx'), 'utf8');
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

describe('PlaybackVideo audio guard', () => {
    // The recorded-take playback is the third player: it had no guard at all,
    // so a clip that lost its audio stayed silent for the rest of its run.
    const guardCreation = sliceBetween(
        playbackRaw,
        'const guard = createAudioGuard({',
        'audioGuardRef.current = guard;'
    );

    it('imports the guard from the video module (raw: the path contains slashes)', () => {
        expect(playbackRaw).toContain("import { createAudioGuard } from '../modules/video/audio-guard.js';");
    });

    it('creates the guard inside the effect, watching the video element', () => {
        expect(guardCreation).toContain('createAudioGuard({');
        expect(guardCreation).toContain('getElement: () => videoRef.current');
        // The guard must stand down when the clip is meant to be silent.
        expect(guardCreation).toContain('isExpectedAudible: () => !muteIntentRef.current');
    });

    it('starts the guard on play and stops it on pause', () => {
        // Scoped to the <video> element: an import or a destructuring cannot
        // satisfy these assertions.
        const videoElement = sliceBetween(playbackRaw, '<video ref={videoRef}', "style={{ cursor: 'pointer' }} />");
        expect(videoElement).toContain('onPlay={() => audioGuardRef.current?.start()}');
        expect(videoElement).toContain('onPause={() => audioGuardRef.current?.stop()}');
    });

    it('records the learner\'s own mute so the guard does not fight it', () => {
        const handleTap = sliceBetween(playbackRaw, 'const handleTakeTap = () => {', '\n    };');
        expect(handleTap).toContain('muteIntentRef.current = next;');
        // The intent must be recorded BEFORE the element is muted, so a guard
        // tick that lands in between already sees the intent.
        expect(handleTap.indexOf('muteIntentRef.current = next;'))
            .toBeLessThan(handleTap.indexOf('setElementMuted(video, next);'));
    });

    it('records the silent loop as an intentional mute before it replays', () => {
        const handleEnded = sliceBetween(playbackRaw, 'const handleVideoEnded = () => {', '\n    };');
        expect(handleEnded).toContain('muteIntentRef.current = true;');
        // The intent has to be set before the replay, otherwise the guard's
        // first tick would unmute the intentionally silent loop.
        expect(handleEnded.indexOf('muteIntentRef.current = true;'))
            .toBeLessThan(handleEnded.indexOf('playSafely(video)'));
    });

    it('restores the audio when the autoplay with sound was blocked', () => {
        // The muted fallback is a rung of the start ladder (stories/094), and
        // the unmute that follows it lives in unmuteAfterStart.
        const handleBlocked = sliceBetween(playbackRaw, 'const handleBlockedStart = (attempt, error) => {', '\n    };');
        expect(handleBlocked).toContain('scheduleRetry(attempt);');
        const unmute = sliceBetween(playbackRaw, 'const unmuteAfterStart = () => {', '\n    };');
        expect(unmute).toContain('setElementMuted(el, false)');
        // The re-issued play() must come AFTER the unmute — re-issuing it
        // while the element is still muted would not re-open the audio output.
        expect(unmute.indexOf('setElementMuted(el, false)'))
            .toBeLessThan(unmute.lastIndexOf('playSafely(el)'));
    });

    it('does not write the technical fallback mute into the learner\'s mute intent', () => {
        // Comment-stripped: the guard's own prose must not satisfy the check.
        // Scoped to the whole start path, so a mute written from any rung of the
        // ladder is caught (the earlier slice pointed at loadedmetadata, which no
        // longer holds the start code and would have passed vacuously).
        const startPath = [
            sliceBetween(playbackRaw, 'const attemptStart = (attempt = 0) => {', '\n    };'),
            sliceBetween(playbackRaw, 'const handleBlockedStart = (attempt, error) => {', '\n    };'),
            sliceBetween(playbackRaw, 'const unmuteAfterStart = () => {', '\n    };'),
            sliceBetween(playbackRaw, 'const scheduleRetry = (attempt) => {', '\n    };'),
        ].join('\n');
        const stripped = stripComments(startPath);
        // A blocked autoplay is a technical state, not the learner asking for
        // silence — it must not be mirrored into the store's mute flag.
        expect(stripped).not.toContain('setPlaybackMuted(true)');
        // The one legitimate store write is the fresh clip's audible state.
        expect(stripped).toContain('setPlaybackMuted(false)');
    });

    it('resets the mute intent when a new clip arrives', () => {
        const blobEffect = sliceBetween(playbackRaw, '// Blob URL management', '// Clear trigger');
        expect(blobEffect).toContain('muteIntentRef.current = false;');
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
