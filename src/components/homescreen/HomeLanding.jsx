import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import Strings from '../../data/strings.js';
import LegalFooter from '../legal/LegalFooter.jsx';
import headerLogo from '../../assets/img/uff-logo.png';

// Public homepage: the friend-challenge entry. The only job is to accept a
// friend's share code (or send the visitor into the Would You Rather ask
// lesson). Owns the input value locally; the container owns lookup + error.
export default function HomeLanding({
    lang = 'en',
    isLoggedIn = false,
    error = null,
    loading = false,
    onSubmitCode,
    onNoCode,
    onInputChange,
}) {
    const [code, setCode] = useState('');

    const brandGradient = 'linear-gradient(135deg, #3a8fd5 0%, #00c0d8 100%)';

    const containerStyle = {
        minHeight: '100dvh',
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
        background: 'none',
        border: 'none',
        color: '#00c0d8',
        fontSize: '15px',
        cursor: 'pointer',
        padding: '12px',
        textDecoration: 'underline',
    };

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
                <Link
                    to={isLoggedIn ? '/home' : '/login'}
                    data-testid="landing-account-link"
                    style={{ color: 'white', textDecoration: 'none', fontWeight: 600, fontSize: '16px', padding: '8px' }}
                >
                    {isLoggedIn ? Strings.get('home_home', lang) : Strings.get('sign_in', lang)}
                </Link>
            </div>

            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
                <div style={{ width: '100%', maxWidth: '420px', ...cardStyle }}>
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

                    <div style={{ textAlign: 'center', marginTop: '8px' }}>
                        <button type="button" data-testid="no-code" onClick={onNoCode} style={noCodeBtnStyle}>
                            {Strings.get('home_landing_no_code', lang)}
                        </button>
                    </div>
                </div>
            </div>

            <LegalFooter lang={lang} />
        </div>
    );
}
