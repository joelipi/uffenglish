// Android Chrome does not keep a pointer sequence alive when the target is the
// <video> element, so the overlay drag handlers must live on the wrapper div.
// A regression here makes every overlay move only a few pixels per drag.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(HERE, 'WebcamPreview.jsx'), 'utf8');

describe('overlay drag wiring', () => {
    it('puts the pointer handlers on the wrapper, not the video', () => {
        const wrapperStart = source.indexOf('id="pip-wrapper"');
        expect(wrapperStart).toBeGreaterThan(-1);
        const videoStart = source.indexOf('<video\n', wrapperStart);
        expect(videoStart).toBeGreaterThan(wrapperStart);
        const wrapperBlock = source.slice(wrapperStart, videoStart);
        expect(wrapperBlock).toContain('onPointerDown={handlePointerDown}');
        expect(wrapperBlock).toContain('onPointerMove={handlePointerMove}');
        expect(wrapperBlock).toContain('onPointerUp={handlePointerUp}');
        expect(wrapperBlock).toContain('onPointerCancel={handlePointerUp}');

        const videoEnd = source.indexOf('</video>', videoStart);
        const videoBlock = source.slice(videoStart, videoEnd);
        expect(videoBlock).not.toContain('onPointerDown');
        expect(videoBlock).not.toContain('onPointerMove');
    });

    it('disables touch panning on the wrapper while the look controls are live', () => {
        const wrapperStart = source.indexOf('id="pip-wrapper"');
        const videoStart = source.indexOf('<video\n', wrapperStart);
        const wrapperBlock = source.slice(wrapperStart, videoStart);
        expect(wrapperBlock).toMatch(/lookControlsVisible\s*\?\s*\{\s*touchAction:\s*'none'\s*\}\s*:\s*null/);
    });
});
