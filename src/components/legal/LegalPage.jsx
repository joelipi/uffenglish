// src/components/legal/LegalPage.jsx
// Shared shell for the static legal pages: a back bar plus the rendered
// document, styled to match the rest of the dark UFF UI.
import React from 'react';
import { Link } from 'react-router-dom';
import Strings from '../../data/strings.js';
import { useNativeLanguage } from '../../hooks/use-native-language.js';
import LegalDocument from './LegalDocument.jsx';

export default function LegalPage({ markdown, titleKey }) {
    const lang = useNativeLanguage();

    const containerStyle = {
        // The app shell (src/routes/AppShellLayout.jsx) owns the frame height
        // and the shared header, so the page is a flex child of the region
        // below the header — it must not claim a height of its own.
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        // body/html are overflow:hidden in index.html (full-screen app shell),
        // so the page owns its scrolling through the region below.
        overflow: 'hidden',
        backgroundColor: '#0b1a2a',
        color: 'white',
        fontFamily: 'var(--font-body)',
    };

    // The page title row. It is NOT a second header: the shared app header
    // (the brand bar) is already above it, so this row is a plain title strip
    // in the same style the other inside pages use — never a second gradient
    // bar stacked under the header's.
    const titleRowStyle = {
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        borderBottom: '1px solid #1a3a5a',
        gap: '12px',
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
            <div style={titleRowStyle}>
                <span style={{ fontSize: '25px', fontWeight: 600, textAlign: 'center', width: '100%' }}>{Strings.get(titleKey, lang)}</span>
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
