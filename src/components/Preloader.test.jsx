// src/components/Preloader.test.jsx
// Story 024: the React loading overlay must point its logo <img> at a bundled
// asset that actually exists on disk. Regression b61b340 hardcoded
// "/logo.png", which is not in public/ and 404s. We assert the rendered src
// resolves to a real file and source-guard against the bad literal returning.
import { describe, it, expect, afterEach } from 'vitest';
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

describe('Preloader logo points at an existing bundled asset', () => {
    let container;
    let root;

    const renderPreloader = (visible) => {
        appStore.getState().setPreloaderVisible(visible);
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        act(() => {
            root.render(React.createElement(Preloader));
        });
    };

    afterEach(() => {
        if (root) act(() => root.unmount());
        if (container) container.remove();
        root = null;
        container = null;
        // Reset store state so the next test starts from the default and the
        // module-level progress pulse cannot keep the overlay mounted.
        appStore.getState().setPreloaderVisible(true);
        appStore.getState().setPreloaderProgress(0);
    });

    it('renders a logo img whose src resolves to a file on disk', () => {
        renderPreloader(true);

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

    it('does not reference the missing /logo.png literal in source', () => {
        const source = readFileSync(path.join(ROOT, 'src/components/Preloader.jsx'), 'utf8');
        expect(source).not.toContain("'/logo.png'");
        expect(source).toContain('u-f-f.png');
    });

    it('renders nothing while the preloader is hidden', () => {
        renderPreloader(false);

        expect(container.querySelector('img')).toBeNull();
        expect(container.childNodes.length).toBe(0);
    });
});
