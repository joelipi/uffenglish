// src/components/legal/SignupConsent.jsx
// Legal consent boilerplate for every signup form ("By signing up, I accept
// the Terms of Service and acknowledge the Privacy Policy", localized). The
// sentence is split into prefix/middle/suffix keys around the two policy
// links because word order differs per language. Links open in a new tab:
// the modal forms are store-driven native <dialog>s mounted once in
// RootLayout, so a same-tab navigation would leave the dialog covering the
// legal page and discard the half-filled form (same precedent as
// LegalLinks).
import React from 'react';
import { Link } from 'react-router-dom';
import Strings from '../../data/strings.js';

export default function SignupConsent({ lang = 'en' }) {
    const linkStyle = { color: '#adb5bd', textDecoration: 'underline' };

    return (
        <p
            data-testid="signup-consent"
            className="text-center mt-3"
            style={{ fontSize: '12px', color: '#adb5bd' }}
        >
            {Strings.get('signup_consent_prefix', lang)}{' '}
            <Link to="/terms" target="_blank" rel="noopener noreferrer" style={linkStyle}>
                {Strings.get('legal_terms', lang)}
            </Link>{' '}
            {Strings.get('signup_consent_middle', lang)}{' '}
            <Link to="/privacy" target="_blank" rel="noopener noreferrer" style={linkStyle}>
                {Strings.get('legal_privacy', lang)}
            </Link>
            {Strings.get('signup_consent_suffix', lang)}
        </p>
    );
}
