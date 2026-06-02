import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import PointLossOverlay from './PointLossOverlay.jsx';
import { appStore } from '../modules/store/store.js';

describe('PointLossOverlay', () => {
    beforeEach(() => {
        appStore.getState().setPointLossAmount(null);
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        document.body.innerHTML = '';
    });

    it('renders nothing when pointLossAmount is null', async () => {
        const container = document.createElement('div');
        const root = createRoot(container);
        root.render(<PointLossOverlay />);
        await vi.waitFor(() => {
            expect(container.innerHTML).toBe('');
        });
        root.unmount();
    });

    it('renders point loss amount when set', async () => {
        appStore.getState().setPointLossAmount(10);
        const container = document.createElement('div');
        const root = createRoot(container);
        root.render(<PointLossOverlay />);
        await vi.waitFor(() => {
            expect(container.textContent).toBe('-10');
        });
        root.unmount();
    });
});
