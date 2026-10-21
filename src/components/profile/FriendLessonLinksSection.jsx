import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Strings from '../../data/strings.js';
import {
    buildFriendLessonPath,
    getFriendLinkRemainingMs,
    formatFriendLinkRemaining,
    buildVisitorPracticeView,
} from '../../modules/user/friend-lesson-link-logic.js';
import { COURSE_LISTINGS_PATH } from '../../modules/courses/friend-courses-logic.js';

const cardStyle = {
    backgroundColor: '#1a3a5a',
    borderRadius: '12px',
    padding: '20px',
    border: '1px solid #2a4a6a',
};

// One link. Purely presentational; `now` is supplied by the section's ticking
// clock so the link disappears the moment the 48h window passes. The label is
// the lesson's POSITION in the course chain ("Lesson 3 of 6"), read from the
// config at render time; the stored title is only the fallback for a config
// that has not loaded (or a legacy entry with no title at all).
function FriendLessonLink({ entry, lang, now, ordinal }) {
    const remainingMs = getFriendLinkRemainingMs(new Date(entry.addedAt).getTime(), now);
    const completedTogether = entry.completedTogether === true;

    // The link is an IN-APP link, rendered with react-router's <Link>: the
    // click is a CLIENT-SIDE navigation, so the browser never loads a new
    // document for it. A document load (a plain <a href>) is the only thing in
    // the app that can end in a browser-level "This site can't be reached /
    // ERR_FAILED" page, and it also threw away the in-memory guest language,
    // so the lesson re-opened the language modal on every visit.
    const path = buildFriendLessonPath({
        courseId: entry.courseId,
        lessonId: entry.lessonId,
        shareCode: entry.shareCode,
    });

    const ordinalLabel = ordinal
        ? Strings.get('profile_friend_lesson_number', lang, { n: ordinal.n, total: ordinal.total })
        : null;
    const label = ordinalLabel
        || ((typeof entry.lessonTitle === 'string' && entry.lessonTitle !== '')
            ? entry.lessonTitle
            : Strings.get('profile_friend_lesson_link', lang));

    return (
        <li style={{ color: '#ffffff', marginBottom: '12px' }}>
            <Link
                data-testid="friend-lesson-link"
                to={path}
                style={{
                    fontSize: '24px',
                    fontWeight: 700,
                    color: '#ffffff',
                    // A lesson the visitor already did with this person is
                    // struck through: they don't need to do it again.
                    textDecoration: completedTogether ? 'underline line-through' : 'underline',
                    lineHeight: 1.3,
                    display: 'inline-block',
                }}
            >
                {label}
            </Link>
            <p data-testid="friend-lesson-link-countdown" style={{ color: '#ffffff', fontSize: '14px', margin: '4px 0 0' }}>
                {Strings.get('profile_friend_link_available', lang, { time: formatFriendLinkRemaining(remainingMs) })}
            </p>
            {completedTogether && (
                <p data-testid="friend-lesson-link-completed" style={{ color: '#8ce99a', fontSize: '14px', fontWeight: 600, margin: '4px 0 0' }}>
                    {Strings.get('profile_completed_together', lang)}
                </p>
            )}
        </li>
    );
}

// Logged-out visitor invite. The first line links to login (returning to this
// profile via the existing `?redirect=` contract); the second line is plain
// text — it points the visitor at the links below it, so it is not a link
// itself. Only rendered in active mode: there must be something to anchor to.
function VisitorLoginBanner({ shareCode, lang }) {
    return (
        <div data-testid="visitor-login-banner" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <a
                data-testid="visitor-login-link"
                href={`/login?redirect=${encodeURIComponent('/' + shareCode)}`}
                style={{ color: '#ffffff', fontSize: '15px', fontWeight: 600, textDecoration: 'underline' }}
            >
                {Strings.get('profile_login_to_see_together', lang)}
            </a>
            <p
                data-testid="visitor-guest-note"
                style={{ color: '#ffffff', fontSize: '15px', margin: 0 }}
            >
                {Strings.get('profile_guest_start_free', lang)}
            </p>
        </div>
    );
}

// Public-profile friend-practice area. Lists the friend-challenge links that
// are still inside the 48h R2 clip window, grouped by course, under a
// "Practice English with Me Free" invitation. When nothing is active (nothing
// recorded, or every entry aged past 48h) the course area is replaced by an
// explanation and a link into the public course listings.
//
// Visitor awareness (all read-time): a logged-out visitor sees every recorded
// link plus the login/guest banner; a logged-in visitor sees the links they
// took part in first, with joint completions badged and struck through. When
// EVERY open link is already badged for this visitor there is nothing left to
// answer, so the area shows the "no open lessons right now" variant (start a
// brand new lesson) instead of a list of finished links.
// `viewer` is null for logged-out visitors.
export default function FriendLessonLinksSection({ friendLinks, lang = 'en', shareCode, viewer = null, userName = '', name, ownerName, displayName, profileName, lessonOrdinals = {} }) {
    const resolvedName = userName || name || ownerName || displayName || profileName || '';
    const [now, setNow] = useState(() => Date.now());
    const { mode, groups, isTicking } = buildVisitorPracticeView({ friendLinks, nowMs: now, viewer });

    // Tick only while at least one link is still live; once the last one
    // expires the effect stops and the expired state renders.
    useEffect(() => {
        if (!isTicking) return undefined;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [isTicking]);

    if (mode === 'expired') {
        return (
            <div
                id="friend-lesson-links"
                data-testid="friend-lessons-expired"
                style={{ ...cardStyle, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', marginBottom: '24px' }}
            >
                <p data-testid="friend-lessons-expired-message" style={{ color: '#ffffff', fontSize: '16px', lineHeight: 1.5, margin: 0 }}>
                    {Strings.get('profile_friend_lessons_expired', lang)}
                </p>
                <a
                    data-testid="friend-lessons-practice-free"
                    href={COURSE_LISTINGS_PATH}
                    style={{ fontSize: '28px', fontWeight: 800, color: '#ffffff', textDecoration: 'underline', lineHeight: 1.2 }}
                >
                    {Strings.get('profile_friend_start_here', lang)}
                </a>
            </div>
        );
    }

    // Every OPEN link is one this visitor already completed with the owner:
    // there is nothing left to answer. Show a variant of the expired-state
    // message that points at a brand new lesson, not a list of finished links.
    if (mode === 'all-completed') {
        return (
            <div
                id="friend-lesson-links"
                data-testid="friend-lessons-all-completed"
                style={{ ...cardStyle, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', marginBottom: '24px' }}
            >
                <p data-testid="friend-lessons-all-completed-message" style={{ color: '#ffffff', fontSize: '16px', lineHeight: 1.5, margin: 0 }}>
                    {Strings.get('profile_friend_lessons_all_completed', lang)}
                </p>
                <Link
                    data-testid="friend-lessons-practice-free"
                    to={COURSE_LISTINGS_PATH}
                    style={{ fontSize: '28px', fontWeight: 800, color: '#ffffff', textDecoration: 'underline', lineHeight: 1.2 }}
                >
                    {Strings.get('profile_friend_start_here', lang)}
                </Link>
            </div>
        );
    }

    return (
        <div
            id="friend-lesson-links"
            data-testid="friend-lesson-links"
            style={{ display: 'flex', flexDirection: 'column', gap: '24px', marginBottom: '24px' }}
        >
            {viewer === null && <VisitorLoginBanner shareCode={shareCode} lang={lang} />}

            <div>
                <h2 data-testid="friend-lesson-links-heading" style={{ color: '#ffffff', fontSize: '28px', fontWeight: 700, margin: 0 }}>
                    {Strings.get('profile_friend_links_heading', lang, { name: resolvedName })}
                </h2>
                <p data-testid="friend-lesson-links-subheading" style={{ color: '#ffffff', fontSize: '15px', margin: '4px 0 0' }}>
                    {Strings.get('profile_friend_links_subheading', lang, { name: resolvedName })}
                </p>
            </div>

            {groups.map((group) => (
                <div
                    key={group.courseId}
                    data-testid="friend-lesson-link-group"
                    style={cardStyle}
                >
                    <h3
                        data-testid="friend-lesson-link-group-heading"
                        style={{ color: '#ffffff', fontSize: '26px', fontWeight: 800, margin: 0, marginBottom: '12px' }}
                    >
                        {group.courseName}
                    </h3>
                    <ul
                        data-testid="friend-lesson-link-list"
                        style={{ listStyleType: 'disc', paddingLeft: '1.5rem', margin: 0 }}
                    >
                        {group.entries.map((entry) => (
                            <FriendLessonLink
                                key={`${entry.courseId}:${entry.recordedLessonId || entry.lessonId}`}
                                entry={entry}
                                lang={lang}
                                now={now}
                                ordinal={lessonOrdinals[`${entry.courseId}:${entry.recordedLessonId}`]}
                            />
                        ))}
                    </ul>
                </div>
            ))}
        </div>
    );
}
