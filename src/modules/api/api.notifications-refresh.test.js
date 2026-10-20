// The in-app notification inbox must refresh ITSELF.
//
// The bell is mounted ONCE by the app shell, so the inbox query lives for the
// whole session. Without a refresh rule a notification that arrives while the
// app is open stays invisible until the page is RELOADED — which is exactly
// what the app did before this policy existed.
//
// These are behaviour tests, not source guards: they render the real hook
// against a stubbed Supabase and watch the clock.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { notifyManager, defaultScheduler } from '@tanstack/query-core';

const server = vi.hoisted(() => ({
    // The rows the stubbed server currently holds — the test mutates this to
    // simulate a friend answering while the page is open.
    rows: [],
    reads: 0,
    filters: [],
}));

vi.mock('./supabase.js', () => {
    const builder = {
        select: () => builder,
        eq: (column, value) => {
            server.filters.push([column, value]);
            return builder;
        },
        order: () => builder,
        limit: () => builder,
        then: (resolve, reject) =>
            Promise.resolve({ data: server.rows.map((r) => ({ ...r })), error: null })
                .then(resolve, reject),
    };
    return {
        getCurrentUser: vi.fn(async () => null),
        getCurrentSession: vi.fn(async () => ({ data: { session: null } })),
        logout: vi.fn(),
        supabase: {
            from: () => {
                server.reads += 1;
                return builder;
            },
        },
    };
});

import { useNotifications } from './api.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const REFRESH_INTERVAL_MS = 5000;

/**
 * Let the microtask queue drain between the timer tick and React's render:
 * the read is a promise chain, and `act` flushes React's work when its scope
 * ends — so the chain has to be finished by then. A real macrotask boundary
 * drains every pending microtask.
 */
const yieldToEventLoop = () =>
    new Promise((resolve) => {
        if (typeof MessageChannel === 'function') {
            const channel = new MessageChannel();
            channel.port1.onmessage = () => resolve();
            channel.port2.postMessage(null);
            return;
        }
        setTimeout(resolve, 0);
    });

/** Advance the clock and let the resulting read settle and render. */
const tick = async (ms) => {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
        await yieldToEventLoop();
    });
};

function Harness({ userId }) {
    const { data } = useNotifications(userId);
    const rows = Array.isArray(data) ? data : [];
    return React.createElement(
        'div',
        { 'data-testid': 'inbox' },
        `${rows.length}:${rows.map((r) => r.id).join(',')}`
    );
}

describe('the in-app notification inbox refreshes itself', () => {
    let container;
    let root;
    const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');

    const render = async (userId) => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false, gcTime: 0 } },
        });
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        await act(async () => {
            root.render(
                React.createElement(
                    QueryClientProvider,
                    { client: queryClient },
                    React.createElement(Harness, { userId })
                )
            );
        });
    };

    const setVisibility = (state) => {
        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => state,
        });
    };

    beforeEach(() => {
        vi.useFakeTimers();
        // TanStack delivers a query result on a scheduled callback; with fake
        // timers that callback would sit in the fake clock and the component
        // would never see the new data. Deliver it synchronously instead.
        notifyManager.setScheduler((callback) => { callback(); });
        server.rows = [];
        server.reads = 0;
        server.filters = [];
    });

    afterEach(async () => {
        notifyManager.setScheduler(defaultScheduler);
        if (root) {
            await act(async () => { root.unmount(); });
            root = null;
        }
        container?.remove();
        container = null;
        if (originalVisibility) {
            Object.defineProperty(document, 'visibilityState', originalVisibility);
        } else {
            delete document.visibilityState;
        }
        vi.useRealTimers();
    });

    it('reads the inbox when the app is opened', async () => {
        await render('u1');
        expect(server.reads).toBe(1);
        // The read is the recipient's own rows — the RLS-scoped select.
        expect(server.filters).toContainEqual(['recipient_id', 'u1']);
    });

    it('re-reads the inbox every few seconds while the page is visible', async () => {
        await render('u1');
        expect(server.reads).toBe(1);

        await tick(REFRESH_INTERVAL_MS);
        expect(server.reads).toBe(2);

        await tick(REFRESH_INTERVAL_MS);
        expect(server.reads).toBe(3);
    });

    it('shows a notification that arrives while the page is open, without a reload', async () => {
        await render('u1');
        expect(container.querySelector('[data-testid="inbox"]').textContent).toBe('0:');

        // A friend answers: the server-side row appears.
        server.rows = [{ id: 'n1', type: 'friend_response', created_at: '2026-09-24T11:00:00.000Z', read_at: null }];

        await tick(REFRESH_INTERVAL_MS);
        expect(container.querySelector('[data-testid="inbox"]').textContent).toBe('1:n1');
    });

    it('stops polling while the page is hidden (a backgrounded phone)', async () => {
        await render('u1');
        expect(server.reads).toBe(1);

        setVisibility('hidden');
        await tick(REFRESH_INTERVAL_MS * 3);
        expect(server.reads).toBe(1);

        // Visible again: the focus refetch brings the inbox up to date.
        setVisibility('visible');
        await act(async () => {
            window.dispatchEvent(new Event('visibilitychange'));
            await yieldToEventLoop();
        });
        expect(server.reads).toBe(2);
    });

    it('never reads the inbox for a guest', async () => {
        await render('guest');
        expect(server.reads).toBe(0);

        await tick(REFRESH_INTERVAL_MS * 3);
        expect(server.reads).toBe(0);
        expect(server.filters).toHaveLength(0);
    });
});
