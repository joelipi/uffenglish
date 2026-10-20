import React from 'react';
import { Link } from 'react-router-dom';
import Strings from '../../data/strings.js';
import { buildTagHref } from '../../modules/courses/course-tags-logic.js';
import { courseTagTranslation } from '../../modules/courses/course-tag-labels.js';
import { BilingualText } from '../BilingualText.jsx';

// The welcome page (`/welcome`): "choose your topic", one big button per tag.
//
// Presentational only: the container loads the course configs and hands over
// the tag list. The tag buttons are react-router links so the move to a tag
// page is a client-side navigation — a full page load would reset the guest
// language in the store and re-open the guest language/login modal.
export default function WelcomePage({ lang = 'en', tags = [], isLoading = false, isError = false }) {
    const containerStyle = {
        // The app shell (src/routes/AppShellLayout.jsx) owns the frame height
        // and the shared header, so the page is a flex child of the region
        // below the header — it must not claim a height of its own.
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backgroundColor: '#0b1a2a',
        color: 'white',
        fontFamily: 'var(--font-body)',
    };

    const headerStyle = {
        flexShrink: 0,
        padding: '20px 16px 8px',
    };

    const headingStyle = {
        fontSize: '26px',
        fontWeight: 800,
        lineHeight: 1.25,
        margin: 0,
    };

    const scrollStyle = {
        flex: 1,
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        padding: '8px 16px 40px',
    };

    const tagButtonStyle = {
        display: 'block',
        width: '100%',
        padding: '20px 16px',
        marginBottom: '14px',
        borderRadius: '12px',
        background: 'var(--uff-btn-bg)',
        color: 'var(--uff-btn-fg)',
        border: 'var(--uff-btn-border)',
        boxShadow: 'var(--uff-btn-shadow)',
        fontSize: '20px',
        fontWeight: 700,
        textAlign: 'center',
        textDecoration: 'none',
    };

    const messageStyle = {
        color: '#adb5bd',
        textAlign: 'center',
        padding: '24px 0',
    };

    const errorStyle = {
        color: '#ff6b6b',
        textAlign: 'center',
        padding: '24px 0',
    };

    return (
        <div style={containerStyle} data-testid="welcome-page">
            <div style={headerStyle}>
                <h1 data-testid="welcome-heading" style={headingStyle}>
                    {Strings.get('welcome_heading', lang)}
                </h1>
            </div>

            <div data-testid="welcome-scroll" style={scrollStyle}>
                {isLoading && (
                    <div data-testid="welcome-loading" style={{ textAlign: 'center', padding: '32px 0' }}>
                        <div className="spinner-border" role="status" style={{ width: '3rem', height: '3rem' }}>
                            <span className="visually-hidden">Loading...</span>
                        </div>
                    </div>
                )}

                {isError && (
                    <div data-testid="welcome-error" style={errorStyle}>
                        {Strings.get('welcome_load_error', lang)}
                    </div>
                )}

                {!isLoading && !isError && tags.length === 0 && (
                    <div data-testid="welcome-empty" style={messageStyle}>
                        {Strings.get('welcome_empty', lang)}
                    </div>
                )}

                {!isLoading && !isError && tags.length > 0 && (
                    <div data-testid="welcome-tags">
                        {tags.map((tag) => (
                            <Link
                                key={tag.key}
                                to={buildTagHref(tag.tag)}
                                data-testid="welcome-tag-button"
                                style={tagButtonStyle}
                            >
                                {/* The English word first, the learner's language
                                    after it: a learner still learning English may
                                    not know what the topic means in English. */}
                                <span className="course-tag-label">
                                    <BilingualText
                                        translationData={courseTagTranslation(tag.tag) || tag.tag}
                                        userLang={lang}
                                        spanPrefix=" "
                                    />
                                </span>
                            </Link>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
