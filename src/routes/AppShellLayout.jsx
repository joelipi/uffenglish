// src/routes/AppShellLayout.jsx
// The app shell for every INSIDE page of the app: the shared header on top
// (src/components/layout/AppHeader.web.jsx) and the page in the region below
// it.
//
// The shell owns the frame height, so the pages inside it must NOT claim
// `height: 100dvh` themselves — they are flex children of the region below
// the header (`flex: 1; min-height: 0`) and own their own scrolling.
//
// The public landing page (/) and the lesson player are mounted OUTSIDE this
// layout on purpose: they keep their own chrome (the landing is a marketing
// page, the lesson player has its own top bar). Every other page of the app —
// including the public share-code profile and the 404 — is inside the shell.
import React from 'react';
import { Outlet } from 'react-router-dom';
import AppHeader from '../components/layout/AppHeader.web.jsx';

export default function AppShellLayout() {
    return (
        <div
            data-testid="app-shell"
            style={{
                height: '100dvh',
                display: 'flex',
                flexDirection: 'column',
                backgroundColor: '#0b1a2a',
                color: 'white',
                fontFamily: 'var(--font-body)',
            }}
        >
            <AppHeader />
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                <Outlet />
            </div>
        </div>
    );
}
