import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import MicrophoneToggle from './MicrophoneToggle.web.jsx';
import { appStore } from '../../modules/store/store.js';
import { setSpeechInputToggleCallback } from '../../modules/lesson/step-loader-callbacks.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('MicrophoneToggle — correction card dismissal', () => {
    let container;
    let root;

    beforeEach(() => {
        // jsdom does not implement Web Animations API; the component calls
        // ring.animate() when the mic is active.
        Element.prototype.animate = vi.fn(() => ({ cancel: vi.fn() }));
        container = document.createElement('div');
        document.body.appendChild(container);
        appStore.setState({
            bottomState: 'micActiveOrAnswerInput',
            hintsVisible: true,
            isMicActive: false,
            isTextMode: false,
            textInputVisible: false,
            micBounceTrigger: 0,
        });
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
        setSpeechInputToggleCallback(null);
        vi.clearAllMocks();
    });

    const render = () => {
        act(() => {
            root.render(<MicrophoneToggle />);
        });
    };

    it('hides the correction card and invokes the speech callback when #micBtn is pressed', () => {
        const cb = vi.fn();
        setSpeechInputToggleCallback(cb);
        render();

        const micBtn = container.querySelector('#micBtn');
        expect(micBtn).not.toBeNull();

        act(() => {
            micBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        expect(appStore.getState().hintsVisible).toBe(false);
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('keeps hintsVisible false and still invokes the callback when no card is shown', () => {
        appStore.setState({ hintsVisible: false });
        const cb = vi.fn();
        setSpeechInputToggleCallback(cb);
        render();

        const micBtn = container.querySelector('#micBtn');
        act(() => {
            micBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        expect(appStore.getState().hintsVisible).toBe(false);
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('does not clear the correction card when #txtBtn is pressed', () => {
        appStore.setState({ isTextMode: true });
        render();

        const txtBtn = container.querySelector('#txtBtn');
        expect(txtBtn).not.toBeNull();

        act(() => {
            txtBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        expect(appStore.getState().hintsVisible).toBe(true);
    });
});
