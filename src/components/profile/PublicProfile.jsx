import { useNavigate } from 'react-router-dom';
import { useUserByShareCode, useAuthStatus, useUserProfile, useNotifications } from '../../modules/api/api.js';
import { calculateCurrentStreak } from '../../modules/user/user-profile.js';
import { formatProfileJoinDate } from '../../modules/user/public-profile-logic.js';
import Strings from '../../data/strings.js';
import defaultProfilePic from '../../assets/img/userprofile.png';
import FriendLessonLinksSection from './FriendLessonLinksSection.jsx';
import useFriendChainHeads from '../../hooks/useFriendChainHeads.js';
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
    // Only the configs this profile's links reference are fetched; a course
    // whose config cannot be loaded fails open in the read-time filter.
    const chainHeads = useFriendChainHeads(profile?.friendLinks);
    // The page is localized to the VISITOR's language — the app's guest-first
    // session language — and never to the language of the profile being read.
    // A Spanish learner opening a Hindi speaker's profile reads the page in
    // Spanish, so the owner's `native_language` must not pick the copy here.
    const lang = useNativeLanguage();

    const containerStyle = {
        height: '100dvh',
        overflowY: 'auto',
        backgroundColor: '#0b1a2a',
        color: 'white',
        fontFamily: 'var(--font-body)',
        paddingBottom: '40px',
    };

    const headerStyle = {
        display: 'flex',
        alignItems: 'center',
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
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh' }}>
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
                    <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: 'white', fontSize: '20px', cursor: 'pointer' }}>
                        <i className="bi bi-arrow-left"></i>
                    </button>
                    <span style={{ fontSize: '18px', fontWeight: 600 }}>{Strings.get('public_profile_heading', lang)}</span>
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
    const completedDates = Array.isArray(profile.completed_dates) ? profile.completed_dates : [];
    const lessonsCompleted = Number(profile.lessons_completed || 0);
    const currentStreak = calculateCurrentStreak(completedDates);
    const friendCount = Array.isArray(profile.friends) ? profile.friends.length : 0;
    const referrals = Number(profile.referrals || 0);
    const friendLinks = profile.friendLinks;

    // Logged-in viewer only when a real (non-guest) session is present. The
    // inbox is already guest-disabled; `notifications` may be undefined while
    // it loads, so the logic module defaults it to [].
    const viewer = (isLoggedIn === true && viewerId)
        ? {
            shareCode: viewerProfile.shareCode,
            counted_lessons: viewerProfile.counted_lessons ?? [],
            notifications: Array.isArray(notifications) ? notifications : [],
            ownerShareCode: profile.shareCode ?? profile.share_code ?? shareCode,
        }
        : null;

    return (
        <div style={containerStyle}>
            <div style={headerStyle}>
                <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: 'white', fontSize: '20px', cursor: 'pointer' }}>
                    <i className="bi bi-arrow-left"></i>
                </button>
                <span style={{ fontSize: '18px', fontWeight: 600 }}>{Strings.get('public_profile_heading', lang)}</span>
            </div>

            <div style={{ padding: '24px 16px', maxWidth: '640px', margin: '0 auto' }}>
                <div style={{ ...cardStyle, textAlign: 'center', marginBottom: '24px' }}>
                    <img
                        src={profilePic}
                        alt={displayName}
                        crossOrigin="anonymous"
                        style={{ width: '96px', height: '96px', borderRadius: '50%', objectFit: 'cover', marginBottom: '12px' }}
                    />
                    <h2 style={{ fontSize: '22px', marginBottom: '4px', marginTop: '12px' }}>{displayName}</h2>
                    <p style={{ color: '#6c757d', fontSize: '13px', marginBottom: '4px' }}>{Strings.get('public_profile_share_code', lang)} {shareCode}</p>
                    {joinDate && <p style={{ color: '#6c757d', fontSize: '13px' }}>{Strings.get('profile_member_since', lang, { date: joinDate })}</p>}
                </div>

                <FriendLessonLinksSection
                    friendLinks={friendLinks}
                    lang={lang}
                    shareCode={shareCode}
                    viewer={viewer}
                    chainHeads={chainHeads}
                />

                <div style={cardStyle}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ color: '#adb5bd' }}>{Strings.get('profile_streak', lang)}</span>
                            <span style={{ fontSize: '20px', fontWeight: 700 }}>{currentStreak}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ color: '#adb5bd' }}>{Strings.get('profile_lessons_completed', lang)}</span>
                            <span style={{ fontSize: '20px', fontWeight: 700 }}>{lessonsCompleted}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ color: '#adb5bd' }}>{Strings.get('profile_friend_count', lang)}</span>
                            <span style={{ fontSize: '20px', fontWeight: 700 }}>{friendCount}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ color: '#adb5bd' }}>{Strings.get('profile_referrals', lang)}</span>
                            <span style={{ fontSize: '20px', fontWeight: 700 }}>{referrals}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ color: '#adb5bd' }}>{Strings.get('profile_days_active', lang)}</span>
                            <span style={{ fontSize: '20px', fontWeight: 700 }}>{completedDates.length}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
