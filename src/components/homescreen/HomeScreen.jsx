import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useStore } from 'zustand';
import { useQuery, useQueries } from '@tanstack/react-query';
import { appStore } from '../../modules/store/store.js';
import { useAuthStatus, useUserProfile, useNotifications, fetchUserByShareCode, signOut } from '../../modules/api/api.js';
import Strings from '../../data/strings.js';
import { trackEvent } from '../../modules/utils/posthog.js';
import { loadConfigEntries, resolveCourseHeroImage } from '../../modules/courses/friend-course-configs.js';
import { listFriendCourses } from '../../modules/courses/friend-courses-logic.js';
import {
    resolveContinueTarget,
    collectFriendActorCodes,
    buildFriendLinksMaps,
} from '../../modules/home/continue-logic.js';
import FriendCoursesView from '../courses/FriendCoursesView.jsx';
import NotificationsBell from './NotificationsBell.web.jsx';
import LegalFooter from '../legal/LegalFooter.jsx';
import PWAInstallButton from '../pwa/PWAInstallButton.web.jsx';
import headerLogo from '../../assets/img/uff-logo.png';

export default function HomeScreen() {
    const navigate = useNavigate();
    const [menuOpen, setMenuOpen] = useState(false);
    const courseId = useStore(appStore, state => state.courseId);
    const activeLessonId = useStore(appStore, state => state.activeLessonId);
    const guestLang = useStore(appStore, state => state.guestNativeLanguage);
    const userDataLang = useStore(appStore, state => state.userData?.native_language);
    const lang = guestLang || userDataLang || 'en';

    const { data: isLoggedIn } = useAuthStatus();
    const { data: profile } = useUserProfile();
    const viewerId = profile?.$id;

    // Single-flight config loader shared by both queries below: concurrent
    // mounts await one `loadConfigEntries()` promise per HomeScreen mount
    // (Vite caches the chunks across mounts anyway).
    const entriesRequestRef = useRef(null);
    const getConfigEntries = () => {
        if (!entriesRequestRef.current) entriesRequestRef.current = loadConfigEntries();
        return entriesRequestRef.current;
    };
    const { data: courses, isLoading: coursesLoading, isError: coursesError } = useQuery({
        queryKey: ['friend-courses'],
        queryFn: async () => {
            const courses = listFriendCourses(await getConfigEntries());
            return courses.map((c) => ({ ...c, heroImage: resolveCourseHeroImage(c.heroImage) }));
        },
        staleTime: Infinity,
    });

    // Friend-aware Continue target (story 061). Raw config entries classify
    // the resume; the inbox plus the actors' public link maps feed the
    // friend branch. This container only passes data into the pure
    // resolver — every gate, branch, and URL build lives there.
    // `['config-entries']` is deliberately separate from the shared
    // `['friend-courses']` cache (same payload shape as /courses must keep).
    const { data: configEntries } = useQuery({
        queryKey: ['config-entries'],
        queryFn: () => getConfigEntries(),
        staleTime: Infinity,
    });
    const { data: notifications } = useNotifications(viewerId);
    const selfShareCode = profile?.shareCode || profile?.share_code;
    const actorCodes = useMemo(
        () => collectFriendActorCodes(notifications, selfShareCode),
        [notifications, selfShareCode]);
    // One cached read per friend actor, reusing the exact public-profile
    // cache keys (`['user', 'profile', 'shareCode', code]`). `staleTime:
    // Infinity` matches the shared profile cache (no refetch per mount);
    // `retry: false` is fail-open (an offline friend resolves to an error
    // state, then skipped, without retries delaying the fallback).
    const friendMapsQueries = useQueries({
        queries: actorCodes.map((code) => ({
            queryKey: ['user', 'profile', 'shareCode', code],
            queryFn: () => fetchUserByShareCode(code),
            staleTime: Infinity,
            retry: false,
        })),
    });
    // Content signatures, not identities: `useQueries` returns a fresh array
    // every render, which must not retrigger resolution — the button never
    // changes targets across re-renders with identical inputs. Each
    // signature moves only when its underlying data actually resolves.
    const actorCodesKey = actorCodes.join(',');
    const friendDataSignature = friendMapsQueries
        .map((q) => `${q.dataUpdatedAt}:${q.status}`)
        .join('|');
    const friendLinksMaps = useMemo(
        () => buildFriendLinksMaps(actorCodes, friendMapsQueries.map((q) => q.data)),
        // Deps are the content signatures above, not the fresh-per-render
        // query array (`react-hooks/exhaustive-deps` is off repo-wide).
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [actorCodesKey, friendDataSignature]);
    const courseProgressText = profile?.course_progress;
    const countedLessons = profile?.counted_lessons;
    // Hourly invalidation bucket: the memo below must re-resolve
    // periodically so a link that ages past 48h eventually drops out, but
    // re-renders within the hour reuse the cached target (no random
    // re-roll). The expiry DECISION always uses the true current time —
    // the bucket only controls when re-resolution may happen (on top of
    // genuine input changes and query refetches on mount/focus).
    const nowBucket = Math.floor(Date.now() / 3600000);
    // Memoized on primitives so re-renders with identical inputs reuse the
    // cached target; re-resolves on real input changes or hour rollover.
    const continueTarget = useMemo(
        () => resolveContinueTarget({
            courseId,
            activeLessonId,
            configEntries,
            courseProgressText,
            countedLessons,
            friendLinksMaps,
            nowMs: Date.now(),
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [courseId, activeLessonId, configEntries, courseProgressText, countedLessons, friendLinksMaps, nowBucket]);
    // Navigation-time refresh: the rendered target stays stable (it never
    // retargets while displayed), but the tap resolves just-in-time so a
    // link that aged past 48h since render still falls through correctly.
    // A null fresh resolution navigates nowhere: null means "no valid
    // target right now", and the stale rendered target is exactly the
    // expired link the resolver just rejected — navigating to it would
    // violate the never-resume-expired invariant (the button hides on the
    // next resolve).
    const handleContinueNavigate = () => {
        const fresh = resolveContinueTarget({
            courseId,
            activeLessonId,
            configEntries,
            courseProgressText,
            countedLessons,
            friendLinksMaps,
            nowMs: Date.now(),
        });
        if (fresh) navigate(fresh);
    };

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

    // The menu's Install entry is a <button>, not a <Link>, so it needs the
    // link styling plus button resets (no default chrome, full-width hit area).
    const installBtnStyle = {
        ...linkStyle,
        width: '100%',
        background: 'none',
        border: 'none',
        textAlign: 'left',
        cursor: 'pointer',
        fontFamily: 'inherit',
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

    const bottomBarStyle = {
        padding: '16px',
        borderTop: '1px solid #1a3a5a',
        backgroundColor: '#0b1a2a',
    };

    const continueBtnStyle = {
        width: '100%',
        padding: '14px',
        background: 'var(--uff-btn-bg)',
        color: 'var(--uff-btn-fg)',
        border: 'var(--uff-btn-border)',
        borderRadius: '8px',
        fontSize: '16px',
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'opacity 0.15s, transform 0.15s',
        boxShadow: 'var(--uff-btn-shadow)',
    };

    return (
        <div style={containerStyle}>
            <div style={topBarStyle}>
                <button onClick={() => setMenuOpen(true)} style={iconBtnStyle}>
                    <i className="bi bi-list"></i>
                </button>
                <img
                    src={headerLogo}
                    alt={Strings.get('home_title', lang)}
                    data-testid="home-logo"
                    style={{ height: '40px', width: 'auto', display: 'block', filter: 'drop-shadow(0 1px 1.5px rgba(0,0,0,0.35))' }}
                />
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
                            <Link to="/home" onClick={closeMenu} style={{ ...linkStyle, borderLeft: '3px solid transparent' }}
                                  onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#1a3a5a'; e.currentTarget.style.borderLeftColor = '#00c0d8'; }}
                                  onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.borderLeftColor = 'transparent'; }}>
                                <i className="bi bi-house-fill"></i> {Strings.get('home_home', lang)}
                            </Link>
                            <Link to="/profile" onClick={closeMenu} style={{ ...linkStyle, borderLeft: '3px solid transparent' }}
                                  onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#1a3a5a'; e.currentTarget.style.borderLeftColor = '#00c0d8'; }}
                                  onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.borderLeftColor = 'transparent'; }}>
                                <i className="bi bi-person-fill"></i> {Strings.get('home_profile', lang)}
                            </Link>
                            <Link to="/privacy" onClick={closeMenu} style={{ ...linkStyle, borderLeft: '3px solid transparent' }}
                                  onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#1a3a5a'; e.currentTarget.style.borderLeftColor = '#00c0d8'; }}
                                  onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.borderLeftColor = 'transparent'; }}>
                                <i className="bi bi-shield-lock"></i> {Strings.get('legal_privacy', lang)}
                            </Link>
                            <Link to="/terms" onClick={closeMenu} style={{ ...linkStyle, borderLeft: '3px solid transparent' }}
                                  onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#1a3a5a'; e.currentTarget.style.borderLeftColor = '#00c0d8'; }}
                                  onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.borderLeftColor = 'transparent'; }}>
                                <i className="bi bi-file-earmark-text"></i> {Strings.get('legal_terms', lang)}
                            </Link>
                            <PWAInstallButton
                                label={Strings.get('pwa_install_cta', lang)}
                                style={installBtnStyle}
                                onBeforeOpen={closeMenu}
                            />
                        </nav>
                        <div style={{ flex: 1 }} />
                        {isLoggedIn ? (
                            <button onClick={handleSignOut} style={{ background: 'none', border: '1px solid #dc3545', color: '#dc3545', padding: '12px', borderRadius: '8px', cursor: 'pointer', fontSize: '16px' }}>
                                <i className="bi bi-box-arrow-right" style={{ marginRight: '8px' }}></i> {Strings.get('sign_out', lang)}
                            </button>
                        ) : (
                            <Link to="/login" onClick={closeMenu} style={{ background: 'var(--uff-btn-bg)', color: 'var(--uff-btn-fg)', border: 'var(--uff-btn-border)', textDecoration: 'none', padding: '12px', borderRadius: '8px', textAlign: 'center', fontSize: '16px', fontWeight: 600, display: 'block', boxShadow: 'var(--uff-btn-shadow)' }}>
                                {Strings.get('sign_in', lang)}
                            </Link>
                        )}
                    </div>
                </div>
            )}

            <div style={{ flex: 1, overflowY: 'auto' }}>
                <FriendCoursesView
                    lang={lang}
                    courses={courses}
                    isLoading={coursesLoading}
                    isError={coursesError}
                />
            </div>

            {continueTarget && (
                <div style={bottomBarStyle}>
                    <button data-testid="home-continue" onClick={handleContinueNavigate} style={continueBtnStyle}
                            onMouseEnter={e => { e.currentTarget.style.opacity = '0.9'; e.currentTarget.style.transform = 'scale(1.02)'; }}
                            onMouseLeave={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'scale(1)'; }}>
                        {Strings.get('home_continue', lang)} <i className="bi bi-arrow-right"></i>
                    </button>
                </div>
            )}

            <LegalFooter lang={lang} />
        </div>
    );
}
