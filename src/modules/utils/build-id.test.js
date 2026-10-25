import { describe, it, expect } from 'vitest';
import { resolveBuildId, formatBuildLog } from './build-id.js';

describe('resolveBuildId', () => {
    it('reads the entry chunk name out of the built URL', () => {
        expect(resolveBuildId('https://uff.test/assets/main-DZoXePXi.js')).toBe('main-DZoXePXi.js');
        expect(resolveBuildId('/assets/main-EaQp0egg.js')).toBe('main-EaQp0egg.js');
    });

    it('reports the dev server as dev, not as a build', () => {
        expect(resolveBuildId('http://localhost:5329/src/main.jsx?t=123')).toBe('dev');
    });

    it('never throws on junk', () => {
        expect(resolveBuildId('')).toBe('unknown');
        expect(resolveBuildId(undefined)).toBe('unknown');
        expect(resolveBuildId('/')).toBe('unknown');
    });

    it('formats a single boot log line', () => {
        expect(formatBuildLog('https://uff.test/assets/main-abc123.js')).toBe('[Build] main-abc123.js');
    });
});
