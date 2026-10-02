// Regression guard for the bilingual "Transcribing" caption shown above the
// waveform while Whisper is transcribing. The English word must stay on the
// same line as the localized translation, and the caption must slowly blink.
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { appStore } from '../../modules/store/store.js';
import WaveformCanvas from './WaveformCanvas.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appCss = readFileSync(path.join(__dirname, '../../assets/css/app.css'), 'utf8');

const PEAKS = { peaks: [0.4, 0.8, 0.3], durationMs: 1200 };

function renderWaveform(container) {
    const root = createRoot(container);
    act(() => {
        root.render(React.createElement(WaveformCanvas));
    });
    return root;
}

describe('WaveformCanvas transcribing caption', () => {
    let container;
    let root;

    beforeAll(() => {
        const gradient = { addColorStop: vi.fn() };
        const ctx = {
            clearRect: vi.fn(),
            scale: vi.fn(),
            createLinearGradient: vi.fn(() => gradient),
            fillRect: vi.fn(),
            beginPath: vi.fn(),
            moveTo: vi.fn(),
            lineTo: vi.fn(),
            stroke: vi.fn(),
        };
        vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
        // The canvas paint loop keeps scheduling frames; disable it so the
        // static caption can be asserted without a live animation loop.
        vi.stubGlobal('requestAnimationFrame', () => 0);
        vi.stubGlobal('cancelAnimationFrame', () => {});
    });

    afterAll(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        appStore.setState({
            recordedAudioPeaks: PEAKS,
            guestNativeLanguage: 'HI',
            userData: null,
        });
    });

    afterEach(() => {
        if (root) act(() => root.unmount());
        container.remove();
        root = null;
        container = null;
        appStore.setState({ recordedAudioPeaks: null, guestNativeLanguage: null });
    });

    it('shows English and the localized translation on the same caption row', () => {
        root = renderWaveform(container);

        const label = container.querySelector('.waveform-transcribing-label');
        expect(label).not.toBeNull();
        expect(label.textContent).toContain('Transcribing');
        expect(label.textContent).toContain('ट्रांसक्राइब हो रहा है');

        const localized = label.querySelector('.waveform-transcribing-localized');
        expect(localized).not.toBeNull();
        expect(localized.getAttribute('lang')).toBe('hi');
    });

    it('renders the caption above the canvas', () => {
        root = renderWaveform(container);

        const label = container.querySelector('.waveform-transcribing-label');
        const canvas = container.querySelector('.waveform-canvas');
        expect(label).not.toBeNull();
        expect(canvas).not.toBeNull();
        // label precedes canvas in document order
        const position = label.compareDocumentPosition(canvas);
        expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('falls back to English only when the language is English', () => {
        appStore.setState({ guestNativeLanguage: 'EN' });
        root = renderWaveform(container);

        const label = container.querySelector('.waveform-transcribing-label');
        expect(label.textContent).toContain('Transcribing');
        expect(label.querySelector('.waveform-transcribing-localized')).toBeNull();
    });

    it('renders nothing when there are no recorded peaks', () => {
        appStore.setState({ recordedAudioPeaks: null });
        root = renderWaveform(container);
        expect(container.querySelector('.waveform-container')).toBeNull();
    });

    it('ships a slow blink animation that honours reduced motion', () => {
        const block = appCss.slice(
            appCss.indexOf('.waveform-transcribing-label'),
            appCss.indexOf('.waveform-transcribing-label') + 600,
        );
        expect(block).toContain('animation: blink-text');
        expect(appCss).toContain('@keyframes blink-text');
        expect(appCss).toContain('prefers-reduced-motion');
    });
});
