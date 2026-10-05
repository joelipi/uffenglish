// src/components/legal/LegalFooter.jsx
// Privacy Policy / Terms of Service links for the homepage footer.
import React from 'react';
import { Link } from 'react-router-dom';
import Strings from '../../data/strings.js';

export default function LegalFooter({ lang = 'en' }) {
    const footerStyle = {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        padding: '16px',
        borderTop: '1px solid #1a3a5a',
        fontSize: '13px',
        color: '#adb5bd',
    };

    const linkStyle = { color: '#adb5bd', textDecoration: 'underline' };

    return (
        <footer data-testid="legal-footer" style={footerStyle}>
            <Link to="/privacy" style={linkStyle}>{Strings.get('legal_privacy', lang)}</Link>
            <span aria-hidden="true">·</span>
            <Link to="/terms" style={linkStyle}>{Strings.get('legal_terms', lang)}</Link>
        </footer>
    );
}
