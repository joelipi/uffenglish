import React from 'react';
import { Outlet } from 'react-router-dom';

export default function AuthLayout() {
    return (
        <div style={{ flex: 1, minHeight: 0, backgroundColor: '#0b1a2a', overflowY: 'auto' }}>
            {/* The app shell (src/routes/AppShellLayout.jsx) provides the header
                above this page — the brand bar with the UFF logo — so the auth
                pages do NOT carry a second one of their own. */}
            <div style={{ minHeight: '100%', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '2rem 1rem 4rem' }}>
                <div style={{
                    backgroundColor: '#1a3a5a',
                    padding: '2rem',
                    borderRadius: '12px',
                    boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5)',
                    width: '100%',
                    maxWidth: '420px',
                    color: 'white',
                    fontFamily: 'var(--font-body)',
                }}>
                    <Outlet />
                </div>
            </div>
        </div>
    );
}
