// src/components/legal/LegalLinks.jsx
// Privacy Policy / Terms of Service links for sign-up surfaces (modal footers
// and the standalone /signup form). Mirrors LegalFooter's markup but opens in a
// new tab: the modals are store-driven native <dialog>s mounted once in
// RootLayout, so a same-tab navigation would leave the dialog covering the
// legal page and discard the half-filled form.
import React from 'react';
import { Link } from 'react-router-dom';
import Strings from '../../data/strings.js';

export default function LegalLinks({ lang = 'en' }) {
    const containerStyle = {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px',
        marginTop: '12px',
        fontSize: '12px',
        color: '#adb5bd',
    };
    const linkStyle = { color: '#adb5bd', textDecoration: 'underline' };

    return (
        <div data-testid="legal-links" style={containerStyle}>
            <Link to="/privacy" target="_blank" rel="noopener noreferrer" style={linkStyle}>
                {Strings.get('legal_privacy', lang)}
            </Link>
            <span aria-hidden="true">·</span>
            <Link to="/terms" target="_blank" rel="noopener noreferrer" style={linkStyle}>
                {Strings.get('legal_terms', lang)}
            </Link>
        </div>
    );
}
