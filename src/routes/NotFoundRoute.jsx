// src/routes/NotFoundRoute.jsx
// The real 404 page. Rendered for the `*` catch-all (multi-segment typos) and
// by PublicProfileRoute for single-segment URLs that cannot be share codes.
// Styled to match PublicProfile's "User not found" treatment so the two read
// as one family instead of two unrelated screens.
import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import Strings from '../data/strings.js';
import { useNativeLanguage } from '../hooks/use-native-language.js';
import { usePreloader } from '../hooks/usePreloader.js';

export default function NotFoundRoute() {
    const { finishPreloader } = usePreloader();
    const lang = useNativeLanguage();

    // Same contract as every other route: without this the app sits behind the
    // preloader on a page the visitor can never leave.
    useEffect(() => { finishPreloader(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const containerStyle = {
        // The app shell (src/routes/AppShellLayout.jsx) owns the frame height
        // and the shared header, so the 404 is a flex child of the region
        // below the header — it must not claim a height of its own.
        flex: 1,
        minHeight: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#0b1a2a',
        color: 'white',
        fontFamily: 'var(--font-body)',
        padding: '24px 16px',
    };

    const cardStyle = {
        width: '100%',
        maxWidth: '420px',
        backgroundColor: '#1a3a5a',
        borderRadius: '12px',
        padding: '32px 24px',
        border: '1px solid #2a4a6a',
        textAlign: 'center',
    };

    const actionsStyle = {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        marginTop: '24px',
    };

    return (
        <div data-testid="not-found-route" style={containerStyle}>
            <div style={cardStyle}>
                <i
                    className="bi bi-exclamation-triangle-fill"
                    style={{ fontSize: '32px', color: '#ff6b6b', display: 'block', marginBottom: '12px' }}
                ></i>
                <h1 data-testid="not-found-heading" style={{ fontSize: '22px', marginBottom: '8px' }}>
                    {Strings.get('not_found_heading', lang)}
                </h1>
                <p data-testid="not-found-body" style={{ color: '#adb5bd', margin: 0 }}>
                    {Strings.get('not_found_body', lang)}
                </p>
                <div style={actionsStyle}>
                    <Link
                        to="/courses"
                        data-testid="not-found-courses-link"
                        className="btn btn-primary"
                    >
                        {Strings.get('not_found_courses', lang)}
                    </Link>
                    <Link
                        to="/"
                        data-testid="not-found-home-link"
                        className="btn btn-outline-light"
                    >
                        {Strings.get('not_found_home', lang)}
                    </Link>
                </div>
            </div>
        </div>
    );
}
