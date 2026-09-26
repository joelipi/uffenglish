import { useNavigate } from 'react-router-dom';
import { useUserByShareCode } from '../../modules/api/api.js';
import { appStore } from '../../modules/store/store.js';
import Strings from '../../data/strings.js';
import { LOCALE_MAP } from '../../data/languages.js';
import defaultProfilePic from '../../assets/img/userprofile.png';
import FriendLessonLinksSection from './FriendLessonLinksSection.jsx';

export default function PublicProfile({ shareCode }) {
    const navigate = useNavigate();
    const { data: profile, isLoading } = useUserByShareCode(shareCode);

    const containerStyle = {
        height: '100dvh',
        overflowY: 'auto',
        backgroundColor: '#0b1a2a',
        color: 'white',
        fontFamily: "'Plus Jakarta Sans', sans-serif",
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
        const viewerLang = appStore.getState().guestNativeLanguage || appStore.getState().userData?.native_language || 'en';
        return (
            <div style={containerStyle}>
                <div style={headerStyle}>
                    <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: 'white', fontSize: '20px', cursor: 'pointer' }}>
                        <i className="bi bi-arrow-left"></i>
                    </button>
                    <span style={{ fontSize: '18px', fontWeight: 600 }}>{Strings.get('public_profile_heading', viewerLang)}</span>
                </div>
                <div style={{ padding: '24px 16px', textAlign: 'center', color: '#ff6b6b' }}>
                    <i className="bi bi-exclamation-triangle-fill" style={{ fontSize: '32px', display: 'block', marginBottom: '12px' }}></i>
                    <p>{Strings.get('public_profile_not_found', viewerLang)}</p>
                </div>
            </div>
        );
    }

    const lang = profile.native_language?.toLowerCase() || 'en';
    const displayName = profile.display_name || [profile.firstName, profile.lastName].filter(Boolean).join(' ') || '';
    const joinDate = profile.joinDate ? new Date(profile.joinDate).toLocaleDateString(LOCALE_MAP[profile.native_language] || 'en') : '';
    const rawPic = profile.profilePictureUrl;
    const profilePic = rawPic || defaultProfilePic;
    const completedDates = Array.isArray(profile.completed_dates) ? profile.completed_dates : [];
    const lessonsCompleted = Number(profile.lessons_completed || 0);
    const friendLinks = profile.friendLinks;

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
                        style={{ width: '96px', height: '96px', borderRadius: '50%', objectFit: 'cover', marginBottom: '12px' }}
                    />
                    <h2 style={{ fontSize: '22px', marginBottom: '4px', marginTop: '12px' }}>{displayName}</h2>
                    <p style={{ color: '#6c757d', fontSize: '13px', marginBottom: '4px' }}>Share Code: {shareCode}</p>
                    {joinDate && <p style={{ color: '#6c757d', fontSize: '13px' }}>{Strings.get('profile_member_since', lang, { date: joinDate })}</p>}
                </div>

                <FriendLessonLinksSection friendLinks={friendLinks} lang={lang} />

                <div style={cardStyle}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ color: '#adb5bd' }}>{Strings.get('profile_lessons_completed', lang)}</span>
                            <span style={{ fontSize: '20px', fontWeight: 700 }}>{lessonsCompleted}</span>
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
