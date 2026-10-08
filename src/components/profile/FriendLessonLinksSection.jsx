import React, { useState, useEffect } from 'react';
import Strings from '../../data/strings.js';
import {
    buildFriendLessonLink,
    toFriendLessonHref,
    getFriendLinkRemainingMs,
    formatFriendLinkRemaining,
    groupActiveFriendLinks,
} from '../../modules/user/friend-lesson-link-logic.js';

const cardStyle = {
    backgroundColor: '#1a3a5a',
    borderRadius: '12px',
    padding: '20px',
    border: '1px solid #2a4a6a',
};

// One link. Purely presentational; `now` is supplied by the section's ticking
// clock so the link disappears the moment the 48h window passes. The label is
// the English title of the lesson the profile owner recorded (already
// normalized to English at export time), so a visitor can pick the set they
// remember.
function FriendLessonLink({ entry, lang, now }) {
    const remainingMs = getFriendLinkRemainingMs(new Date(entry.addedAt).getTime(), now);

    const url = buildFriendLessonLink({
        courseId: entry.courseId,
        lessonId: entry.lessonId,
        shareCode: entry.shareCode,
    });

    // The label is the English title of the recorded lesson. If an entry has no
    // title (malformed/legacy data), fall back to the generic link copy so the
    // anchor keeps a visible, clickable label.
    const label = (typeof entry.lessonTitle === 'string' && entry.lessonTitle !== '')
        ? entry.lessonTitle
        : Strings.get('profile_friend_lesson_link', lang);

    return (
        <li style={{ color: '#ffffff', marginBottom: '12px' }}>
            <a
                data-testid="friend-lesson-link"
                href={toFriendLessonHref(url)}
                style={{ fontSize: '24px', fontWeight: 700, color: '#ffffff', textDecoration: 'underline', lineHeight: 1.3, display: 'inline-block' }}
            >
                {label}
            </a>
            <p data-testid="friend-lesson-link-countdown" style={{ color: '#adb5bd', fontSize: '14px', margin: '4px 0 0' }}>
                {Strings.get('profile_friend_link_available', lang, { time: formatFriendLinkRemaining(remainingMs) })}
            </p>
        </li>
    );
}

// Public-profile friend-practice area. Lists the friend-challenge links that
// are still inside the 48h R2 clip window, grouped by course, under a
// "Practice English with Me Free" invitation. When nothing is active (nothing
// recorded, or every entry aged past 48h) the course area is replaced by an
// explanation and a link into the public course listings.
export default function FriendLessonLinksSection({ friendLinks, lang = 'en' }) {
    const [now, setNow] = useState(() => Date.now());
    const groups = groupActiveFriendLinks(friendLinks, now);
    const isTicking = groups.length > 0;

    // Tick only while at least one link is still live; once the last one
    // expires the effect stops and the expired state renders.
    useEffect(() => {
        if (!isTicking) return undefined;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [isTicking]);

    if (groups.length === 0) {
        return (
            <div
                data-testid="friend-lessons-expired"
                style={{ ...cardStyle, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', marginBottom: '24px' }}
            >
                <p data-testid="friend-lessons-expired-message" style={{ color: '#adb5bd', fontSize: '16px', lineHeight: 1.5, margin: 0 }}>
                    {Strings.get('profile_friend_lessons_expired', lang)}
                </p>
                <a
                    data-testid="friend-lessons-practice-free"
                    href="/courses"
                    style={{ fontSize: '28px', fontWeight: 800, color: '#ffffff', textDecoration: 'underline', lineHeight: 1.2 }}
                >
                    {Strings.get('profile_friend_practice_free', lang)}
                </a>
            </div>
        );
    }

    return (
        <div
            data-testid="friend-lesson-links"
            style={{ display: 'flex', flexDirection: 'column', gap: '24px', marginBottom: '24px' }}
        >
            <div>
                <h2 data-testid="friend-lesson-links-heading" style={{ color: '#ffffff', fontSize: '28px', fontWeight: 700, margin: 0 }}>
                    {Strings.get('profile_friend_practice_heading', lang)}
                </h2>
                <p data-testid="friend-lesson-links-subheading" style={{ color: '#adb5bd', fontSize: '15px', margin: '4px 0 0' }}>
                    {Strings.get('profile_friend_practice_subheading', lang)}
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
                            />
                        ))}
                    </ul>
                </div>
            ))}
        </div>
    );
}
