import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import LookControls from './LookControls.jsx';
import { appStore } from '../../modules/store/store.js';
import { emptySelection, emptyTuning } from '../../modules/looks/recording-looks-logic.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('emoji overlay picker', () => {
    let container;
    let root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        appStore.setState({
            awaitingRecordingStart: true,
            lookOpenDrawer: 'emoji',
            lookSelection: emptySelection(),
            lookTuning: emptyTuning(),
            lookActiveSlot: 'emoji',
        });
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        appStore.setState({ awaitingRecordingStart: false, lookOpenDrawer: null, lookSelection: emptySelection(), lookTuning: emptyTuning() });
    });

    it('loads the generated collection and selects a Twemoji slug', async () => {
        await act(async () => { root.render(<LookControls />); });
        let button = null;
        await vi.waitFor(() => {
            button = container.querySelector('[data-testid="look-emoji-1f600"]');
            expect(button).toBeTruthy();
        }, { timeout: 8000 });
        await act(async () => {
            button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        expect(appStore.getState().lookSelection.slots.emoji).toBe('twemoji:1f600');
        expect(appStore.getState().lookActiveSlot).toBe('emoji');
    });
});
