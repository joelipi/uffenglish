import React from 'react';
import Strings from '../../data/strings.js';
import FriendCoursesView from './FriendCoursesView.jsx';
import PWAInstallBanner from '../pwa/PWAInstallBanner.web.jsx';
import PushNotificationsOptIn from '../notifications/PushNotificationsOptIn.web.jsx';
import { isGuestViewer, buildCoursesSignInHref } from '../../modules/courses/guest-viewer-logic.js';

// Public course-listings page (`/courses`). Purely presentational; the
// container loads the friend courses. Uses plain `<a href>` (not `<Link>`) for
// the course cards so full-page navigation needs no Router context, matching
// the profile page's anchors.
//
// This page serves both audiences: signed-in users get the install banner and
// the notification prompt, guests get the signed-out notice. Both gates read
// `isGuestViewer` so they can never disagree about who is signed in. The notice
// waits for the profile query (`isResolving`) before claiming either way; the
// banners mount immediately and self-gate on `userId` internally.
export default function CourseListings({ lang = 'en', courses, isLoading = false, isError = false, userId = null, isResolving = false, onBack }) {
    // `isResolving` is the profile query still loading: the viewer is unknown,
    // so neither the guest notice nor the signed-in banners render yet. Gating
    // both off one predicate keeps them from disagreeing about who is here.
    const isGuest = isGuestViewer(userId, { isResolving });
    const containerStyle = {
        // The app shell (src/routes/AppShellLayout.jsx) owns the frame height
        // and the shared header, so the page is a flex child of the region
        // below the header — it must not claim a height of its own.
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        // index.html hides overflow on html/body (full-screen app shell) and #root is
        // the 9:16 .video-frame (overflow: hidden), so this page must own its
        // scrolling — same contract as LegalPage. `minHeight` alone grows the shell
        // past the frame and leaves it clipped with no scroller.
        overflow: 'hidden',
        backgroundColor: '#0b1a2a',
        color: 'white',
        fontFamily: 'var(--font-body)',
    };

    const headerStyle = {
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        padding: '16px',
        borderBottom: '1px solid #1a3a5a',
        gap: '12px',
    };

    const scrollStyle = {
        flex: 1,
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        paddingBottom: '40px',
    };

    // flexShrink: 0 so the notice holds its place instead of being squeezed to
    // nothing by the flexible scroll region below it.
    const noticeStyle = {
        flexShrink: 0,
        padding: '14px 16px',
        borderBottom: '1px solid #1a3a5a',
        backgroundColor: '#12283d',
    };

    const noticeTitleStyle = { fontWeight: 600, marginBottom: '4px' };

    const noticeBodyStyle = { fontSize: '14px', opacity: 0.85, marginBottom: '10px', lineHeight: 1.5 };

    const noticeLinkStyle = {
        display: 'inline-block',
        padding: '8px 16px',
        borderRadius: '8px',
        backgroundColor: '#3a8fd5',
        color: 'white',
        textDecoration: 'none',
        fontSize: '14px',
        fontWeight: 600,
    };

    return (
        <div style={containerStyle}>
            <div style={headerStyle}>
                <button
                    type="button"
                    data-testid="friend-courses-back"
                    onClick={onBack}
                    style={{ background: 'none', border: 'none', color: 'white', fontSize: '20px', cursor: 'pointer' }}
                >
                    <i className="bi bi-arrow-left"></i>
                </button>
                <span style={{ fontSize: '18px', fontWeight: 600 }}>{Strings.get('home_courses', lang)}</span>
            </div>

            {/* Signed-out notice (story 070). Sits OUTSIDE the scroll region so
                it does not scroll away, and OUTSIDE the signed-in-only banner
                block below: a guest sees neither of those but must see this. */}
            {isGuest && (
                <div data-testid="courses-guest-notice" style={noticeStyle}>
                    <div style={noticeTitleStyle}>{Strings.get('courses_guest_notice_title', lang)}</div>
                    <div style={noticeBodyStyle}>{Strings.get('courses_guest_notice_body', lang)}</div>
                    <a
                        data-testid="courses-guest-signin"
                        href={buildCoursesSignInHref()}
                        style={noticeLinkStyle}
                    >
                        {Strings.get('sign_in', lang)}
                    </a>
                </div>
            )}

            <div data-testid="friend-courses-scroll" style={scrollStyle}>
                {/* Renders immediately: `isGuest` is false while the profile query
                    resolves, so the banners show right away, but each of them
                    self-gates on `userId` internally and renders nothing for an
                    unknown/anonymous viewer. */}
                {!isGuest && (
                    <>
                        <PWAInstallBanner lang={lang} userId={userId} />
                        <PushNotificationsOptIn lang={lang} variant="prompt" userId={userId} />
                    </>
                )}
                <FriendCoursesView lang={lang} courses={courses} isLoading={isLoading} isError={isError} />
            </div>
        </div>
    );
}
