// src/components/Preloader.test.jsx
// Story 024: the React loading overlay must point its logo <img> at a bundled
// asset that actually exists on disk. Regression b61b340 hardcoded
// "/logo.png", which is not in public/ and 404s.
//
// Rendering uses createRoot + act + a module-scoped container/root, matching
// the established component-test pattern in this repo
// (src/components/intro-caller-name.test.js, src/components/widgets/MicrophoneToggle.test.jsx).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { appStore } from '../modules/store/store.js';
import Preloader from './Preloader.jsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const renderPreloader = (container, visible) => {
    appStore.getState().setPreloaderVisible(visible);
    const root = createRoot(container);
    act(() => {
        root.render(React.createElement(Preloader));
    });
    return root;
};

describe('Preloader logo points at an existing bundled asset', () => {
    let container;
    let root;

    beforeEach(() => {
        // The Preloader effect calls startProgressPulse(), which installs a
        // module-level setInterval singleton that unmount does not clear.
        // Fake timers keep that pulse from mutating shared store state across
        // tests.
        vi.useFakeTimers();
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        if (root) act(() => root.unmount());
        container.remove();
        vi.useRealTimers();
        root = null;
        container = null;
        // Reset store state so each test starts from the default.
        appStore.getState().setPreloaderVisible(true);
        appStore.getState().setPreloaderProgress(0);
    });

    it('renders a logo img whose src resolves to a file on disk', () => {
        root = renderPreloader(container, true);

        const img = container.querySelector('img');
        expect(img).not.toBeNull();

        const src = img.getAttribute('src');
        expect(typeof src).toBe('string');
        expect(src.length).toBeGreaterThan(0);
        expect(src).not.toBe('/logo.png');

        const rel = src.replace(/^\//, '');
        const candidates = [path.join(ROOT, rel), path.join(ROOT, 'public', rel)];
        expect(candidates.some((candidate) => existsSync(candidate))).toBe(true);
    });

    // Required source-guard AC: Preloader.jsx must reference the bundled asset
    // and must not reintroduce the missing '/logo.png' literal. Mirrors the
    // repo's source-guard pattern (src/components/video-overlay-italic.test.js).
    it('does not reference the missing /logo.png literal in Preloader.jsx', () => {
        const source = readFileSync(path.join(ROOT, 'src/components/Preloader.jsx'), 'utf8');
        expect(source).not.toContain("'/logo.png'");
        expect(source).toContain('u-f-f.png');
    });

    it('renders nothing while the preloader is hidden', () => {
        root = renderPreloader(container, false);

        expect(container.querySelector('img')).toBeNull();
        expect(container.childNodes.length).toBe(0);
    });
});
