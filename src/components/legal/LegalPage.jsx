// src/components/legal/LegalPage.jsx
// Shared shell for the static legal pages: a back bar plus the rendered
// document, styled to match the rest of the dark UFF UI.
import React from 'react';
import { Link } from 'react-router-dom';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';
import Strings from '../../data/strings.js';
import LegalDocument from './LegalDocument.jsx';

export default function LegalPage({ markdown, titleKey }) {
    const guestLang = useStore(appStore, (state) => state.guestNativeLanguage);
    const userLang = useStore(appStore, (state) => state.userData?.native_language);
    const lang = guestLang || userLang || 'en';

    const containerStyle = {
        height: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        // body/html are overflow:hidden in index.html (full-screen app shell),
        // so the page owns its scrolling through the region below.
        overflow: 'hidden',
        backgroundColor: '#0b1a2a',
        color: 'white',
        fontFamily: "'Inter', 'Plus Jakarta Sans', sans-serif",
    };

    const topBarStyle = {
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px',
        background: 'linear-gradient(135deg, #3a8fd5 0%, #00c0d8 100%)',
    };

    const scrollStyle = {
        flex: 1,
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
    };

    const articleStyle = {
        maxWidth: '760px',
        margin: '0 auto',
        padding: '24px 20px 64px',
    };

    return (
        <div style={containerStyle}>
            <div style={topBarStyle}>
                <Link
                    to="/"
                    data-testid="legal-back"
                    aria-label={Strings.get('legal_back', lang)}
                    style={{ color: 'white', fontSize: '20px', padding: '4px 10px', textDecoration: 'none' }}
                >
                    <i className="bi bi-arrow-left"></i>
                </Link>
                <span style={{ fontSize: '18px', fontWeight: 600 }}>{Strings.get(titleKey, lang)}</span>
                <div style={{ width: '40px' }} />
            </div>

            <div data-testid="legal-scroll" style={scrollStyle}>
                <article
                    data-testid="legal-document"
                    style={articleStyle}
                >
                    <LegalDocument markdown={markdown} />
                </article>
            </div>
        </div>
    );
}
