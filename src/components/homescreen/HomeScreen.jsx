import React, { useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from 'zustand';
import { useQuery, useQueries } from '@tanstack/react-query';
import { appStore } from '../../modules/store/store.js';
import { useUserProfile, useNotifications, fetchUserByShareCode } from '../../modules/api/api.js';
import Strings from '../../data/strings.js';
import { useNativeLanguage } from '../../hooks/use-native-language.js';
import { loadConfigEntries, resolveCourseHeroImage } from '../../modules/courses/friend-course-configs.js';
import { listFriendCourses } from '../../modules/courses/friend-courses-logic.js';
import {
    resolveContinueTarget,
    collectFriendActorCodes,
    buildFriendLinksMaps,
} from '../../modules/home/continue-logic.js';
import FriendCoursesView from '../courses/FriendCoursesView.jsx';
import PWAInstallBanner from '../pwa/PWAInstallBanner.web.jsx';
import PushNotificationsOptIn from '../notifications/PushNotificationsOptIn.web.jsx';
import { isRegisteredViewer } from '../../modules/navigation/app-menu-logic.js';

export default function HomeScreen() {
    const navigate = useNavigate();
    const courseId = useStore(appStore, state => state.courseId);
    const activeLessonId = useStore(appStore, state => state.activeLessonId);
    const lang = useNativeLanguage();

    const { data: profile } = useUserProfile();
    const viewerId = profile?.$id;
    // A guest stub is not an account: no install banner, no push prompt.
    const registered = isRegisteredViewer(viewerId);

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

    const containerStyle = {
        // The app shell (src/routes/AppShellLayout.jsx) owns the frame height
        // and the shared header, so the dashboard is a flex child of the
        // region below the header — it must not claim a height of its own.
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        backgroundColor: '#0b1a2a',
        color: 'white',
        fontFamily: 'var(--font-body)',
        display: 'flex',
        flexDirection: 'column',
    };

    // REVISIT LATER: the Continue bar is deliberately hidden for now — there is
    // too much in the app to test right now, so we are taking this one out of
    // the surface. `display: 'none'` keeps the target resolution (and its
    // tests) wired up, so re-showing the bar later is a one-line style change.
    const bottomBarStyle = {
        display: 'none',
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
            <div style={{ flex: 1, overflowY: 'auto' }}>
                {registered && (
                    <>
                        <PWAInstallBanner lang={lang} userId={viewerId} />
                        <PushNotificationsOptIn lang={lang} variant="prompt" userId={viewerId} />
                    </>
                )}
                <FriendCoursesView
                    lang={lang}
                    courses={courses}
                    isLoading={coursesLoading}
                    isError={coursesError}
                />
            </div>

            {continueTarget && (
                <div style={bottomBarStyle} data-testid="home-continue-bar">
                    <button data-testid="home-continue" onClick={handleContinueNavigate} style={continueBtnStyle}
                            onMouseEnter={e => { e.currentTarget.style.opacity = '0.9'; e.currentTarget.style.transform = 'scale(1.02)'; }}
                            onMouseLeave={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'scale(1)'; }}>
                        {Strings.get('home_continue', lang)} <i className="bi bi-arrow-right"></i>
                    </button>
                </div>
            )}
        </div>
    );
}
