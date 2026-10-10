import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import Strings from '../../data/strings.js';
import LegalFooter from '../legal/LegalFooter.jsx';
import ConversationCarousel from './ConversationCarousel.jsx';
import { HOME_LANGUAGES } from '../../data/languages.js';
import headerLogo from '../../assets/img/uff-logo.png';
import teacherPhoto from '../../assets/img/teacherprofile.webp';

// The teacher is a proper noun, so its name is a module constant, not a
// strings.js key (the hi/bn script guard would fail on a Latin-only entry).
const TEACHER_NAME = 'Joe Walsh';

// Public homepage: the friend-challenge entry plus short marketing sections.
// The only job of the hero is to accept a friend's share code (or send the
// visitor into the Would You Rather ask lesson). Owns the input value locally;
// the container owns lookup + error + the language-change handler.
export default function HomeLanding({
    lang = 'en',
    isLoggedIn = false,
    error = null,
    loading = false,
    onSubmitCode,
    onNoCode,
    onInputChange,
    onLanguageChange,
    showcaseVideos = [],
}) {
    const [code, setCode] = useState('');

    const brandGradient = 'linear-gradient(135deg, #3a8fd5 0%, #00c0d8 100%)';

    const languageCode = String(lang).toUpperCase();
    const selectedLanguage = HOME_LANGUAGES.some((l) => l.value === languageCode) ? languageCode : 'EN';

    const containerStyle = {
        height: '100dvh',
        overflowY: 'auto',
        backgroundColor: '#0b1a2a',
        color: 'white',
        fontFamily: "'Inter', 'Plus Jakarta Sans', sans-serif",
        display: 'flex',
        flexDirection: 'column',
    };

    const topBarStyle = {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px',
        background: brandGradient,
    };

    const topBarRightStyle = {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
    };

    const contentStyle = {
        width: '100%',
        maxWidth: '480px',
        margin: '0 auto',
        padding: '24px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
    };

    const cardStyle = {
        backgroundColor: '#1a3a5a',
        borderRadius: '12px',
        padding: '24px',
        border: '1px solid #2a4a6a',
    };

    const inputStyle = {
        width: '100%',
        padding: '14px',
        borderRadius: '8px',
        border: '1px solid #2a4a6a',
        backgroundColor: '#0b1a2a',
        color: 'white',
        fontSize: '16px',
        outline: 'none',
        marginBottom: '12px',
    };

    const goBtnStyle = {
        width: '100%',
        padding: '14px',
        background: brandGradient,
        color: 'white',
        border: 'none',
        borderRadius: '8px',
        fontSize: '16px',
        fontWeight: 600,
        cursor: loading ? 'default' : 'pointer',
        opacity: loading ? 0.6 : 1,
    };

    const noCodeBtnStyle = {
        width: '100%',
        padding: '14px',
        background: 'transparent',
        borderWidth: '1px',
        borderStyle: 'solid',
        borderColor: '#00c0d8',
        color: '#00c0d8',
        borderRadius: '8px',
        fontSize: '16px',
        fontWeight: 600,
        cursor: 'pointer',
        textDecoration: 'none',
    };

    const howListStyle = {
        listStyle: 'none',
        padding: 0,
        margin: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
    };

    const howItemStyle = {
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
    };

    const howItems = [
        'home_landing_how_1',
        'home_landing_how_2',
        'home_landing_how_3',
        'home_landing_how_4',
        'home_landing_how_5',
    ];

    function handleSubmit(e) {
        e.preventDefault();
        onSubmitCode?.(code);
    }

    function handleChange(e) {
        setCode(e.target.value);
        onInputChange?.();
    }

    return (
        <div style={containerStyle}>
            <div style={topBarStyle}>
                <img
                    src={headerLogo}
                    alt={Strings.get('home_title', lang)}
                    data-testid="home-logo"
                    style={{ height: '40px', width: 'auto', display: 'block', filter: 'drop-shadow(0 1px 1.5px rgba(0,0,0,0.35))' }}
                />
                <div style={topBarRightStyle}>
                    <select
                        data-testid="landing-language-select"
                        className="form-select bg-dark border-secondary"
                        aria-label={Strings.get('home_landing_language_label', lang)}
                        value={selectedLanguage}
                        onChange={(e) => onLanguageChange?.(e.target.value)}
                        style={{ width: 'auto', maxWidth: '150px', padding: '6px 28px 6px 10px', fontSize: '13px' }}
                    >
                        {HOME_LANGUAGES.map((l) => (
                            <option key={l.value} value={l.value}>{l.label}</option>
                        ))}
                    </select>
                    <Link
                        to={isLoggedIn ? '/home' : '/login'}
                        data-testid="landing-account-link"
                        style={{ color: 'white', textDecoration: 'none', fontWeight: 600, fontSize: '16px', padding: '8px' }}
                    >
                        {isLoggedIn ? Strings.get('home_home', lang) : Strings.get('sign_in', lang)}
                    </Link>
                </div>
            </div>

            <div style={contentStyle}>
                <div style={cardStyle}>
                    <h1 data-testid="share-code-headline" style={{ fontSize: '24px', fontWeight: 700, marginBottom: '8px' }}>
                        {Strings.get('home_landing_headline', lang)}
                    </h1>
                    <p data-testid="share-code-subheadline" style={{ color: '#adb5bd', marginBottom: '20px', fontSize: '16px' }}>
                        {Strings.get('home_landing_subheadline', lang)}
                    </p>

                    <form onSubmit={handleSubmit}>
                        <input
                            data-testid="share-code-input"
                            type="text"
                            value={code}
                            onChange={handleChange}
                            placeholder={Strings.get('home_landing_code_placeholder', lang)}
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                            style={inputStyle}
                        />
                        {error !== null && (
                            <div
                                data-testid="share-code-error"
                                role="alert"
                                style={{ color: '#ff6b6b', fontSize: '14px', marginBottom: '12px' }}
                            >
                                {error}
                            </div>
                        )}
                        <button type="submit" data-testid="share-code-go" disabled={loading} style={goBtnStyle}>
                            {Strings.get('home_landing_go', lang)}
                        </button>
                    </form>

                    <div style={{ marginTop: '12px' }}>
                        <button type="button" data-testid="no-code" onClick={onNoCode} style={noCodeBtnStyle}>
                            {Strings.get('home_landing_no_code', lang)}
                        </button>
                    </div>
                </div>

                <section data-testid="how-it-works" style={cardStyle}>
                    <h2 data-testid="how-it-works-heading" style={{ fontSize: '20px', fontWeight: 700, margin: '0 0 16px' }}>
                        {Strings.get('home_landing_how_heading', lang)}
                    </h2>
                    <ul data-testid="how-it-works-list" style={howListStyle}>
                        {howItems.map((key, i) => (
                            <li key={key} data-testid={`how-it-works-item-${i + 1}`} style={howItemStyle}>
                                <i
                                    className="bi bi-check-circle-fill"
                                    aria-hidden="true"
                                    style={{ color: '#00c0d8', fontSize: '20px', flexShrink: 0 }}
                                />
                                <span>{Strings.get(key, lang)}</span>
                            </li>
                        ))}
                    </ul>
                </section>

                <ConversationCarousel lang={lang} videos={showcaseVideos} />

                <section data-testid="about-teacher" style={cardStyle}>
                    <h2 data-testid="about-teacher-heading" style={{ fontSize: '20px', fontWeight: 700, margin: '0 0 16px' }}>
                        {Strings.get('home_landing_about_heading', lang)}
                    </h2>
                    <img
                        data-testid="about-teacher-photo"
                        src={teacherPhoto}
                        alt={TEACHER_NAME}
                        style={{ width: '96px', height: '96px', borderRadius: '50%', objectFit: 'cover', border: '3px solid #00c0d8', display: 'block', marginBottom: '12px' }}
                    />
                    <p data-testid="about-teacher-name" style={{ fontSize: '20px', fontWeight: 700, margin: '0 0 8px' }}>
                        {TEACHER_NAME}
                    </p>
                    <p data-testid="about-teacher-credentials" style={{ color: '#e9ecef', fontSize: '15px', lineHeight: 1.5, margin: 0 }}>
                        {Strings.get('home_landing_about_credentials', lang)}
                    </p>
                </section>
            </div>

            <LegalFooter lang={lang} />
        </div>
    );
}
