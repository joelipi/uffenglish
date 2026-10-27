import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useUserByShareCode, useAuthStatus, useUserProfile, useNotifications, useFriendCompletions } from '../../modules/api/api.js';
import { formatProfileJoinDate } from '../../modules/user/public-profile-logic.js';
import { buildRecordedLessonOrdinals } from '../../modules/user/friend-lesson-link-logic.js';
import { loadConfigEntries } from '../../modules/courses/friend-course-configs.js';
import Strings from '../../data/strings.js';
import defaultProfilePic from '../../assets/img/userprofile.png';
import FriendLessonLinksSection from './FriendLessonLinksSection.jsx';
import ProfileStats from './ProfileStats.jsx';
import { buildProfileStats } from '../../modules/profile/profile-stats-logic.js';
import { useNativeLanguage } from '../../hooks/use-native-language.js';

export default function PublicProfile({ shareCode }) {
    const navigate = useNavigate();
    const { data: profile, isLoading } = useUserByShareCode(shareCode);
    // Viewer context: who is looking at this profile. Logged-out visitors get
    // the banner; logged-in ones get lessons they feature in prioritized. The
    // guest stub (no session) has `$id: 'guest'` and counts as logged out.
    const { data: isLoggedIn } = useAuthStatus();
    const { data: viewerProfile } = useUserProfile();
    const viewerId = viewerProfile && viewerProfile.$id !== 'guest' ? viewerProfile.$id : null;
    const { data: notifications } = useNotifications(viewerId);
    // The course configs (lazy Vite chunks, session-cached, shared with the
    // dashboard) supply each link's position in its chain. A failure fails
    // open: the ordinal map stays empty and the link falls back to its stored
    // title, so a config fetch never hides a lesson.
    const { data: configEntries } = useQuery({
        queryKey: ['config-entries'],
        queryFn: () => loadConfigEntries(),
        staleTime: Infinity,
    });
    // The owner's user id anchors the pair-scoped completion ledger: the badge
    // may only claim a lesson was done together with THIS profile owner (a
    // lesson is expected to be repeated with different friends).
    const ownerId = profile?.id ?? profile?.$id ?? null;
    const { data: friendCompletions } = useFriendCompletions(viewerId, ownerId);
    // The page is localized to the VISITOR's language — the app's guest-first
    // session language — and never to the language of the profile being read.
    // A Spanish learner opening a Hindi speaker's profile reads the page in
    // Spanish, so the owner's `native_language` must not pick the copy here.
    const lang = useNativeLanguage();

    const containerStyle = {
        // The app shell (src/routes/AppShellLayout.jsx) owns the frame height
        // and the shared header, so the page is a flex child of the region
        // below the header — it must not claim a height of its own.
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        backgroundColor: '#0b1a2a',
        color: 'white',
        fontFamily: 'var(--font-body)',
        paddingBottom: '40px',
    };

    const headerStyle = {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        borderBottom: '1px solid #1a3a5a',
        gap: '12px',
    };

    const cardStyle = {
        backgroundColor: '#1a3a5a',
        borderRadius: '12px',
        padding: '20px',
        border: '1px solid #2a4a6a',
    };

    if (isLoading) {
        return (
            <div style={containerStyle}>
                <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="spinner-border" role="status" style={{ width: '3rem', height: '3rem' }}>
                        <span className="visually-hidden">Loading...</span>
                    </div>
                </div>
            </div>
        );
    }

    if (!profile) {
        return (
            <div style={containerStyle}>
                <div style={headerStyle}>
                    <h1 style={{ fontSize: '25px', fontWeight: 700, fontStyle: 'italic', fontFamily: 'var(--font-heading)', textAlign: 'center', width: '100%', margin: 0 }}>
                        {Strings.get('public_profile_heading', lang)}
                    </h1>
                </div>
                <div style={{ padding: '24px 16px', textAlign: 'center', color: '#ff6b6b' }}>
                    <i className="bi bi-exclamation-triangle-fill" style={{ fontSize: '32px', display: 'block', marginBottom: '12px' }}></i>
                    <p>{Strings.get('public_profile_not_found', lang)}</p>
                </div>
            </div>
        );
    }

    const displayName = profile.display_name || [profile.firstName, profile.lastName].filter(Boolean).join(' ') || '';
    // The join date is formatted in the VISITOR's locale, not the owner's.
    const joinDate = formatProfileJoinDate(profile.joinDate, lang);
    const rawPic = profile.profilePictureUrl;
    const profilePic = rawPic || defaultProfilePic;
    // The statistics table (icons + derived values) is the shared definition
    // rendered by ProfileStats, exactly as on the viewer's own profile.
    const stats = buildProfileStats(profile);
    const friendLinks = profile.friendLinks;
    // "Lesson 3 of 6" per link, derived from the course config at read time.
    const lessonOrdinals = buildRecordedLessonOrdinals(friendLinks, configEntries);

    // Logged-in viewer only when a real (non-guest) session is present. The
    // inbox is already guest-disabled; `notifications` and `friendCompletions`
    // may be undefined while they load, so the logic module defaults both.
    const viewer = (isLoggedIn === true && viewerId)
        ? {
            shareCode: viewerProfile.shareCode,
            friendCompletions: Array.isArray(friendCompletions) ? friendCompletions : [],
            notifications: Array.isArray(notifications) ? notifications : [],
            ownerShareCode: profile.shareCode ?? profile.share_code ?? shareCode,
        }
        : null;

    return (
        <div style={containerStyle}>
            <div style={headerStyle}>
                <h1 style={{ fontSize: '25px', fontWeight: 700, fontStyle: 'italic', fontFamily: 'var(--font-heading)', textAlign: 'center', width: '100%', margin: 0 }}>
                    {/* Localized page heading: the owner's name is a label
                        under the picture, so the copy must not be hardcoded
                        English (it reads in the VISITOR's language). */}
                    {Strings.get('public_profile_heading', lang)} <br />
                    <img src={profilePic} alt={displayName} crossOrigin="anonymous" style={{ width: '192px', height: '192px', borderRadius: '50%', objectFit: 'cover', margin: '8px auto', display: 'block' }} />
                    <br />
                    {displayName}
                </h1>
            </div>

            <div style={{ padding: '24px 16px', maxWidth: '640px', margin: '0 auto' }}>
                <div style={{ ...cardStyle, textAlign: 'center', marginBottom: '24px' }}>
                    <p style={{ color: '#ffffff', fontSize: '13px', marginBottom: '4px' }}>{Strings.get('public_profile_share_code', lang)} {shareCode}</p>
                    {joinDate && <p style={{ color: '#ffffff', fontSize: '13px' }}>{Strings.get('profile_member_since', lang, { date: joinDate })}</p>}
                </div>

                <FriendLessonLinksSection
                    friendLinks={friendLinks}
                    lang={lang}
                    shareCode={shareCode}
                    viewer={viewer}
                    userName={displayName}
                    lessonOrdinals={lessonOrdinals}
                />

                <div style={cardStyle}>
                    <ProfileStats stats={stats} />
                </div>
            </div>
        </div>
    );
}
