// src/components/NotFoundPage.jsx
// The "page not found" card. Presentational: it renders the copy and the two
// ways out (the course list and the homepage) and nothing else.
//
// Two callers render it:
// - `src/routes/NotFoundRoute.jsx` — the app's 404 route (inside the shell);
// - the lesson route (`src/routes/AppLayout.jsx`, `src/components/LessonContainer.jsx`)
//   — a dead course/lesson link, which is a 404 too: the course was retired or
//   the lesson id is gone.
//
// The card fills its parent so it looks the same in both places: inside the
// shell it is a flex child of the region below the header, and inside the
// lesson player's 9:16 frame it is a plain block whose parent has a definite
// height. `height: '100%'` covers the second case; the shell's own flex rule
// (`flex: 1`) wins there and keeps the layout unchanged.
import React from 'react';
import { Link } from 'react-router-dom';
import Strings from '../data/strings.js';

export default function NotFoundPage({ lang = 'en' }) {
    const containerStyle = {
        // The app shell (src/routes/AppShellLayout.jsx) owns the frame height
        // and the shared header, so the 404 is a flex child of the region
        // below the header — it must not claim a height of its own. The
        // lesson player has no shell, so the height comes from the frame.
        flex: 1,
        minHeight: 0,
        height: '100%',
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
                <p data-testid="not-found-body" style={{ color: '#ffffff', margin: 0 }}>
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
