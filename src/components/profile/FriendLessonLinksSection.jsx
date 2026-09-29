import React, { useState, useEffect } from 'react';
import Strings from '../../data/strings.js';
import {
    ANSWER_LESSON_ID,
    buildFriendLessonLink,
    toFriendLessonHref,
    getFriendLinkRemainingMs,
    formatFriendLinkRemaining,
    friendLinkEntryKey,
    listActiveFriendLinks,
    resolveRecapFirstClip,
} from '../../modules/user/friend-lesson-link-logic.js';
import { getCompleteVideoUrl, getSegmentPosterUrl } from '../../modules/video/video-url.js';

const cardStyle = {
    backgroundColor: '#1a3a5a',
    borderRadius: '12px',
    padding: '20px',
    border: '1px solid #2a4a6a',
};

// One card. Purely presentational; `now` is supplied by the section's ticking
// clock so the card disappears the moment the 48h window passes. The embedded
// recap sits above the link; `videoFailed` hides it (link kept) when the R2
// object is missing/expired/never uploaded.
function FriendLessonLink({ entry, lang, now }) {
    const [videoFailed, setVideoFailed] = useState(false);
    const remainingMs = getFriendLinkRemainingMs(new Date(entry.addedAt).getTime(), now);

    const url = buildFriendLessonLink({
        courseId: entry.courseId,
        lessonId: ANSWER_LESSON_ID,
        shareCode: entry.shareCode,
    });

    const videoUrl = entry.lessonId
        ? getCompleteVideoUrl({
            shareCode: entry.shareCode,
            courseId: entry.courseId,
            lessonId: entry.lessonId,
            otherShareCode: entry.otherShareCode,
        })
        : null;

    const firstClip = resolveRecapFirstClip(entry);
    const posterUrl = firstClip ? getSegmentPosterUrl(firstClip) : null;

    // Lightweight availability probe. `preload="none"` fetches no video bytes,
    // but then a missing/expired object would only surface after the user
    // pressed play. A HEAD request (no body) lets us hide the player up front
    // while the link + countdown stay. A network/CORS failure also hides it.
    useEffect(() => {
        if (!videoUrl) return undefined;
        let cancelled = false;
        fetch(videoUrl, { method: 'HEAD' })
            .then((res) => { if (!cancelled && !res.ok) setVideoFailed(true); })
            .catch(() => { if (!cancelled) setVideoFailed(true); });
        return () => { cancelled = true; };
    }, [videoUrl]);

    return (
        <div style={cardStyle}>
            {videoUrl && !videoFailed && (
                <video
                    data-testid="friend-lesson-video"
                    src={videoUrl}
                    poster={posterUrl || undefined}
                    controls
                    playsInline
                    preload="none"
                    onError={() => setVideoFailed(true)}
                    style={{ display: 'block', width: '100%', maxHeight: '70vh', objectFit: 'contain', backgroundColor: '#000', borderRadius: '8px', marginBottom: '12px' }}
                />
            )}
            <a
                data-testid="friend-lesson-link"
                href={toFriendLessonHref(url)}
                style={{ fontSize: '32px', fontWeight: 800, color: '#ffffff', textDecoration: 'underline', lineHeight: 1.2, display: 'inline-block' }}
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
                <FriendLessonLink key={`${friendLinkEntryKey(entry)}:${entry.addedAt}`} entry={entry} lang={lang} now={now} />
            ))}
        </div>
    );
}
