// src/routes/RootLayout.friend-code.test.js
// Story 033: RootLayout mirrors the current URL's ?shareCode= into
// appStore.friendCode on every query-string change, using the shared
// getShareCodeFromSearch parser. The URL is authoritative; the store is a live
// mirror. Rendered with createRoot + act (repo pattern), inside a MemoryRouter.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';

// RootLayout's heavy children pull in the api/supabase graph and are irrelevant
// here; the guard and analytics are stubbed too.
vi.mock('../components/modals/GuestLoginModal.web.jsx', () => ({ default: () => null }));
vi.mock('../components/modals/SaveClipsModal.web.jsx', () => ({ default: () => null }));
vi.mock('../components/Preloader.jsx', () => ({ default: () => null }));
vi.mock('../hooks/use-guest-modal-guard.js', () => ({ useGuestModalGuard: () => {} }));
vi.mock('../modules/utils/posthog.js', () => ({ trackEvent: vi.fn() }));

import { appStore } from '../modules/store/store.js';
import RootLayout from './RootLayout.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = React.createElement;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_SOURCE = readFileSync(path.join(__dirname, 'RootLayout.jsx'), 'utf8');

function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
}

let navigateTo = null;
function NavCapture() {
    navigateTo = useNavigate();
    return null;
}

describe('RootLayout friendCode URL sync (story 033)', () => {
    let container;
    let root;

    const renderAt = (initialPath) => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        act(() => {
            root.render(
                h(MemoryRouter, { initialEntries: [initialPath] },
                    h(NavCapture),
                    h(Routes, null,
                        h(Route, { element: h(RootLayout) },
                            h(Route, { path: '*', element: h('div') })
                        )
                    )
                )
            );
        });
    };

    beforeEach(() => {
        navigateTo = null;
        appStore.getState().setFriendCode(null);
    });

    afterEach(() => {
        if (root) act(() => root.unmount());
        if (container) container.remove();
        root = null;
        container = null;
    });

    it('mirrors a friend lesson shareCode, trimmed and lowercased', () => {
        renderAt('/course/friend/lesson/b?shareCode=Ab12');
        expect(appStore.getState().friendCode).toBe('ab12');
    });

    it('reads the shareCode key case-insensitively', () => {
        renderAt('/?SHARECODE=Ab12');
        expect(appStore.getState().friendCode).toBe('ab12');
    });

    it('maps an empty shareCode value to null', () => {
        renderAt('/?shareCode=');
        expect(appStore.getState().friendCode).toBeNull();
    });

    it('maps an absent shareCode to null on the home route', () => {
        renderAt('/');
        expect(appStore.getState().friendCode).toBeNull();
    });

    it('maps a friend lesson without a shareCode to null', () => {
        renderAt('/course/friend/lesson/b');
        expect(appStore.getState().friendCode).toBeNull();
    });

    it('clears the code when the same mounted RootLayout navigates to a shareCode-less URL', () => {
        renderAt('/?shareCode=ab12');
        expect(appStore.getState().friendCode).toBe('ab12');

        act(() => {
            navigateTo('/');
        });

        expect(appStore.getState().friendCode).toBeNull();
    });

    it('derives friendCode from location.search via the shared parser', () => {
        const source = stripComments(ROOT_SOURCE);
        expect(source).toContain("from '../modules/user/friend-lesson-detection.js'");
        expect(source).toContain('getShareCodeFromSearch');
        expect(source).toContain("from '../modules/store/store.js'");
        expect(source).toContain('getShareCodeFromSearch(location.search)');
        expect(source).toContain('setFriendCode(');
        expect(source).toContain('[location.search]');
    });
});
