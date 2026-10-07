import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// HomeScreen pulls in the Supabase graph, PostHog, the notifications bell and
// the legal footer. Mock the side-effecting ones so the top bar (brand logo) is
// under test without a network or store bootstrap.
vi.mock('../../modules/api/api.js', () => ({
    useAuthStatus: () => ({ data: false }),
    useUserProfile: () => ({ data: null }),
    signOut: vi.fn(),
}));
vi.mock('../../modules/utils/posthog.js', () => ({ trackEvent: vi.fn() }));
vi.mock('./NotificationsBell.web.jsx', () => ({ default: () => null }));
vi.mock('../legal/LegalFooter.jsx', () => ({ default: () => null }));

import HomeScreen from './HomeScreen.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('HomeScreen', () => {
    let container;
    let root;
    let client;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    });

    afterEach(() => {
        if (root) act(() => root.unmount());
        container.remove();
        root = null;
    });

    it('renders the UFF logo image in the top bar instead of the text headline', () => {
        root = createRoot(container);
        act(() => {
            root.render(
                React.createElement(QueryClientProvider, { client },
                    React.createElement(MemoryRouter, null,
                        React.createElement(HomeScreen)
                    )
                )
            );
        });
        const logo = container.querySelector('[data-testid="home-logo"]');
        expect(logo).not.toBeNull();
        expect(logo.tagName).toBe('IMG');
        expect(logo.getAttribute('alt')).toBe('Ultra Fast Fluency');
        expect(container.textContent).not.toContain('Ultra Fast Fluency');
    });
});
