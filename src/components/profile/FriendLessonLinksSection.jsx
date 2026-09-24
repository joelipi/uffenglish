import React, { useState, useEffect } from 'react';
import Strings from '../../data/strings.js';
import {
    ANSWER_LESSON_ID,
    buildFriendLessonLink,
    toFriendLessonHref,
    getFriendLinkRemainingMs,
    formatFriendLinkRemaining,
    listActiveFriendLinks,
} from '../../modules/user/friend-lesson-link-logic.js';

const cardStyle = {
    backgroundColor: '#1a3a5a',
    borderRadius: '12px',
    padding: '20px',
    border: '1px solid #2a4a6a',
};

// One link. Purely presentational; `now` is supplied by the section's ticking
// clock so the link disappears the moment the 48h window passes.
function FriendLessonLink({ entry, lang, now }) {
    const remainingMs = getFriendLinkRemainingMs(new Date(entry.addedAt).getTime(), now);
    if (!(remainingMs > 0)) return null;

    const url = buildFriendLessonLink({
        courseId: entry.courseId,
        lessonId: ANSWER_LESSON_ID,
        shareCode: entry.shareCode,
    });

    return (
        <div style={cardStyle}>
            <a
                data-testid="friend-lesson-link"
                href={toFriendLessonHref(url)}
                style={{ fontSize: '32px', fontWeight: 800, color: '#4da3ff', textDecoration: 'none', lineHeight: 1.2, display: 'inline-block' }}
            >
                {Strings.get('profile_friend_lesson_link', lang)}
            </a>
            <p data-testid="friend-lesson-link-countdown" style={{ color: '#adb5bd', fontSize: '14px', margin: '8px 0 0' }}>
                {Strings.get('profile_friend_link_available', lang, { time: formatFriendLinkRemaining(remainingMs) })}
            </p>
        </div>
    );
}

// Public-profile section listing the friend-challenge answer-lesson links that
// are still inside the 48h R2 clip window. Renders nothing when none are active.
export default function FriendLessonLinksSection({ friendLinks, lang = 'en' }) {
    const hasCandidates = !!friendLinks
        && typeof friendLinks === 'object'
        && !Array.isArray(friendLinks)
        && Object.keys(friendLinks).length > 0;
    const [now, setNow] = useState(() => Date.now());

    // Only tick while there is something that could expire.
    useEffect(() => {
        if (!hasCandidates) return undefined;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [hasCandidates]);

    const active = hasCandidates ? listActiveFriendLinks(friendLinks, now) : [];
    if (active.length === 0) return null;

    return (
        <div
            data-testid="friend-lesson-links"
            style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}
        >
            {active.map((entry) => (
                <FriendLessonLink key={entry.courseId} entry={entry} lang={lang} now={now} />
            ))}
        </div>
    );
}
