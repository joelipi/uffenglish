import React, { useState, useEffect } from 'react';
import Strings from '../../data/strings.js';
import {
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

    const url = buildFriendLessonLink({
        courseId: entry.courseId,
        lessonId: entry.lessonId,
        shareCode: entry.shareCode,
    });

    // Label with the next lesson's title when we have one; the title was
    // captured at export time, so it is already in the exporter's language.
    const hasTitle = typeof entry.lessonTitle === 'string' && entry.lessonTitle !== '';
    const label = hasTitle
        ? Strings.get('profile_friend_lesson_link_titled', lang, { title: entry.lessonTitle })
        : Strings.get('profile_friend_lesson_link', lang);

    return (
        <div style={cardStyle}>
            <a
                data-testid="friend-lesson-link"
                href={toFriendLessonHref(url)}
                style={{ fontSize: '32px', fontWeight: 800, color: '#ffffff', textDecoration: 'underline', lineHeight: 1.2, display: 'inline-block' }}
            >
                {label}
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
    const [now, setNow] = useState(() => Date.now());
    const active = listActiveFriendLinks(friendLinks, now);
    const isTicking = active.length > 0;

    // Tick only while at least one link is still live; once the last one
    // expires the effect stops and the section renders nothing.
    useEffect(() => {
        if (!isTicking) return undefined;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [isTicking]);

    if (active.length === 0) return null;

    return (
        <div
            data-testid="friend-lesson-links"
            style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}
        >
            {active.map((entry) => (
                <FriendLessonLink key={`${entry.courseId}:${entry.lessonId}`} entry={entry} lang={lang} now={now} />
            ))}
        </div>
    );
}
