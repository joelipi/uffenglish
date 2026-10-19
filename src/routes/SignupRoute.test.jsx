// Story 070 — `/signup` is closed by redirect, not by deletion.
//
// The render test is the behavioural half (it navigates for real inside a
// MemoryRouter and asserts where it lands); `routes.test.js` holds the raw-source
// half (the route and its component stay resident). Rendered with react-dom/client
// createRoot + act, the repo convention — no testing-library is installed.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

import SignupRoute from './SignupRoute.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('SignupRoute (closed)', () => {
    let container;
    let root;
    let landedAt;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        landedAt = null;
    });

    afterEach(() => {
        if (root) act(() => root.unmount());
        container.remove();
        root = null;
        container = null;
    });

    /** Mount /signup next to a probe route that records the location it lands on. */
    function mountAt(path) {
        // A second `createRoot` on the same container logs a React error, which
        // this repo treats as a failure, and the `?redirect=` case mounts twice.
        // Tear the previous host down and start from a fresh one.
        if (root) {
            act(() => root.unmount());
            root = null;
        }
        container.remove();
        container = document.createElement('div');
        document.body.appendChild(container);

        function Probe() {
            landedAt = useLocation().pathname;
            return null;
        }
        root = createRoot(container);
        act(() => {
            root.render(
                React.createElement(
                    MemoryRouter,
                    { initialEntries: [path] },
                    React.createElement(
                        Routes,
                        null,
                        React.createElement(Route, { path: '/signup', element: React.createElement(SignupRoute) }),
                        React.createElement(Route, { path: '*', element: React.createElement(Probe) }),
                    ),
                ),
            );
        });
        return landedAt;
    }

    it('redirects /signup to /courses', () => {
        expect(mountAt('/signup')).toBe('/courses');
    });

    it('redirects a stale ?redirect= link to /courses too', () => {
        // The guest modal, login page and guest profile used to append
        // ?redirect=<current url>. A bookmark or an old message carrying one must
        // not reach a form, and must not dead-end either.
        expect(mountAt('/signup?redirect=%2Fhome')).toBe('/courses');
        expect(mountAt('/signup?redirect=%2Fcourse%2Fmodel%2Flesson%2Fm-g')).toBe('/courses');
    });

    it('renders no signup form — no email, name or submit control', () => {
        mountAt('/signup');
        expect(container.querySelector('form')).toBeNull();
        for (const id of ['email', 'first-name', 'last-name', 'signup-submit']) {
            expect(container.querySelector(`#${id}`), `#${id} is still reachable`).toBeNull();
        }
        expect(container.querySelector('input')).toBeNull();
        expect(container.textContent).toBe('');
    });
});
