import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useStore } from 'zustand';
import { useQuery } from '@tanstack/react-query';
import { appStore } from '../../modules/store/store.js';
import { useAuthStatus, useUserProfile, signOut } from '../../modules/api/api.js';
import Strings from '../../data/strings.js';
import { trackEvent } from '../../modules/utils/posthog.js';
import NotificationsBell from './NotificationsBell.web.jsx';

export default function HomeScreen() {
    const navigate = useNavigate();
    const [menuOpen, setMenuOpen] = useState(false);
    const courseId = useStore(appStore, state => state.courseId);
    const activeLessonId = useStore(appStore, state => state.activeLessonId);
    const canContinue = !!courseId && !!activeLessonId;
    const guestLang = useStore(appStore, state => state.guestNativeLanguage);
    const userDataLang = useStore(appStore, state => state.userData?.native_language);
    const lang = guestLang || userDataLang || 'en';

    const { data: isLoggedIn } = useAuthStatus();
    const { data: profile } = useUserProfile();
    const viewerId = profile?.$id;

    const { data: config, isLoading, isError } = useQuery({
        queryKey: ['config', 'model'],
        queryFn: async () => {
            const res = await fetch('/src/config/model.json');
            if (!res.ok) throw new Error(`Failed to load config: ${res.status}`);
            return res.json();
        },
        staleTime: Infinity,
    });

    function closeMenu() { setMenuOpen(false); }

    async function handleSignOut() {
        closeMenu();
        trackEvent('sign_out');
        await signOut();
        navigate('/');
    }

    useEffect(() => {
        if (!menuOpen) return;
        function onKeyDown(e) {
            if (e.key === 'Escape') closeMenu();
        }
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [menuOpen]);

    const brandGradient = 'linear-gradient(135deg, #3a8fd5 0%, #00c0d8 100%)';

    const linkStyle = {
        color: 'white',
        textDecoration: 'none',
        padding: '12px',
        borderRadius: '8px',
        fontSize: '16px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
    };

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

    const iconBtnStyle = {
        background: 'none',
        border: 'none',
        color: 'white',
        fontSize: '28px',
        cursor: 'pointer',
        padding: '8px',
    };

    const courseCardStyle = {
        backgroundColor: '#1a3a5a',
        borderRadius: '12px',
        padding: '20px',
        cursor: 'pointer',
        marginBottom: '16px',
        border: '1px solid #2a4a6a',
        transition: 'transform 0.15s, box-shadow 0.15s',
    };

    const bottomBarStyle = {
        padding: '16px',
        borderTop: '1px solid #1a3a5a',
        backgroundColor: '#0b1a2a',
    };

    const continueBtnStyle = {
        width: '100%',
        padding: '14px',
        background: brandGradient,
        color: 'white',
        border: 'none',
        borderRadius: '8px',
        fontSize: '16px',
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'opacity 0.15s, transform 0.15s',
    };

    return (
        <div style={containerStyle}>
            <div style={topBarStyle}>
                <button onClick={() => setMenuOpen(true)} style={iconBtnStyle}>
                    <i className="bi bi-list"></i>
                </button>
                <span style={{ fontSize: '18px', fontWeight: 600 }}>{Strings.get('home_title', lang)}</span>
                {isLoggedIn && viewerId && viewerId !== 'guest'
                    ? <NotificationsBell userId={viewerId} lang={lang} />
                    : <div style={{ width: '44px' }} />}
            </div>

            {menuOpen && (
                <div onClick={closeMenu} style={{ position: 'fixed', inset: 0, zIndex: 1000, backgroundColor: 'rgba(0,0,0,0.5)' }}>
                    <div onClick={e => e.stopPropagation()} style={{ position: 'fixed', top: 0, left: 0, bottom: 0, width: '280px', backgroundColor: '#0b1a2a', borderRight: '1px solid #1a3a5a', padding: '24px', zIndex: 1001, display: 'flex', flexDirection: 'column' }}>
                        <div style={{ background: brandGradient, margin: '-24px -24px 24px -24px', padding: '24px', borderBottom: 'none' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: '20px', fontWeight: 600 }}>{Strings.get('home_menu', lang)}</span>
                                <button onClick={closeMenu} style={{ background: 'none', border: 'none', color: 'white', fontSize: '24px', cursor: 'pointer' }}>
                                    <i className="bi bi-x-lg"></i>
                                </button>
                            </div>
                        </div>
                        <nav style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <Link to="/" onClick={closeMenu} style={{ ...linkStyle, borderLeft: '3px solid transparent' }}
                                  onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#1a3a5a'; e.currentTarget.style.borderLeftColor = '#00c0d8'; }}
                                  onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.borderLeftColor = 'transparent'; }}>
                                <i className="bi bi-house-fill"></i> {Strings.get('home_home', lang)}
                            </Link>
                            <Link to="/profile" onClick={closeMenu} style={{ ...linkStyle, borderLeft: '3px solid transparent' }}
                                  onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#1a3a5a'; e.currentTarget.style.borderLeftColor = '#00c0d8'; }}
                                  onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.borderLeftColor = 'transparent'; }}>
                                <i className="bi bi-person-fill"></i> {Strings.get('home_profile', lang)}
                            </Link>
                        </nav>
                        <div style={{ flex: 1 }} />
                        {isLoggedIn ? (
                            <button onClick={handleSignOut} style={{ background: 'none', border: '1px solid #dc3545', color: '#dc3545', padding: '12px', borderRadius: '8px', cursor: 'pointer', fontSize: '16px' }}>
                                <i className="bi bi-box-arrow-right" style={{ marginRight: '8px' }}></i> {Strings.get('sign_out', lang)}
                            </button>
                        ) : (
                            <Link to="/login" onClick={closeMenu} style={{ background: brandGradient, color: 'white', textDecoration: 'none', padding: '12px', borderRadius: '8px', textAlign: 'center', fontSize: '16px', fontWeight: 600, display: 'block' }}>
                                {Strings.get('sign_in', lang)}
                            </Link>
                        )}
                    </div>
                </div>
            )}

            <div style={{ flex: 1, padding: '24px 16px', overflowY: 'auto' }}>
                <h2 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '20px' }}>{Strings.get('home_courses', lang)}</h2>

                {isLoading && (
                    <div style={{ textAlign: 'center', padding: '40px', color: '#6c757d' }}>
                        <div className="spinner-border" role="status" style={{ width: '3rem', height: '3rem' }}>
                            <span className="visually-hidden">Loading...</span>
                        </div>
                    </div>
                )}

                {isError && (
                    <div style={{ padding: '20px', backgroundColor: '#1a3a5a', borderRadius: '12px', color: '#ff6b6b', textAlign: 'center' }}>
                        <i className="bi bi-exclamation-triangle-fill" style={{ fontSize: '24px', marginBottom: '8px', display: 'block' }}></i>
                        {Strings.get('home_courses_load_error', lang)}
                    </div>
                )}

                {config && (
                    <div onClick={() => navigate('/course/model/lesson/g')}
                         style={courseCardStyle}
                         onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(58, 143, 213, 0.3)'; }}
                         onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                            <h3 style={{ fontSize: '20px', fontWeight: 600, margin: 0 }}>{config.courseName || 'Grocery Shopping'}</h3>
                            <span style={{ background: brandGradient, padding: '4px 12px', borderRadius: '20px', fontSize: '13px', fontWeight: 600 }}>{config.courseLevel || 'A0'}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#adb5bd', fontSize: '14px' }}>
                            <i className="bi bi-journal-text"></i>
                            <span>{config.lessons ? `${config.lessons.length} lessons` : '4 lessons'}</span>
                        </div>
                    </div>
                )}
            </div>

            {canContinue && (
                <div style={bottomBarStyle}>
                    <button onClick={() => navigate(`/course/${courseId}/lesson/${activeLessonId}`)} style={continueBtnStyle}
                            onMouseEnter={e => { e.currentTarget.style.opacity = '0.9'; e.currentTarget.style.transform = 'scale(1.02)'; }}
                            onMouseLeave={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'scale(1)'; }}>
                        {Strings.get('home_continue', lang)} <i className="bi bi-arrow-right"></i>
                    </button>
                </div>
            )}
        </div>
    );
}
