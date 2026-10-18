// Source guard for story 073: SimpleVideoPlayer auto-play must reset
// currentTime to 0 before play() so a container with a non-zero initial
// audio composition time does not skip the first ~1 s of audio.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = resolve(process.cwd(), 'src/components/SimpleVideoPlayer.web.jsx');
const source = readFileSync(SRC, 'utf8');

function tryPlayBody(src) {
    const start = src.indexOf('const tryPlay = () => {');
    if (start === -1) return '';
    const rest = src.slice(start);
    const next = rest.search(/\n        \};\s*$/m);
    return next === -1 ? rest : rest.slice(0, next);
}

describe('SimpleVideoPlayer autoplay seek-to-zero (story 073)', () => {
    it('resets currentTime to 0 inside tryPlay before play()', () => {
        const body = tryPlayBody(source);
        expect(body).not.toBe('');
        expect(body).toMatch(/video\.currentTime\s*=\s*0/);
        // The seek must precede the play() call.
        const seekAt = body.indexOf('video.currentTime');
        const playAt = body.indexOf('video.play()');
        expect(seekAt).toBeGreaterThan(-1);
        expect(playAt).toBeGreaterThan(seekAt);
    });
});
