import { useNavigate, Link } from 'react-router-dom';
import { useUserProfile, useFriendProfiles } from '../../modules/api/api.js';
import Strings from '../../data/strings.js';
import { useNativeLanguage } from '../../hooks/use-native-language.js';
import defaultProfilePic from '../../assets/img/userprofile.png';
import { getFriendUserIds, buildFriendsList } from '../../modules/user/friends-logic.js';

const containerStyle = {
    // The app shell (src/routes/AppShellLayout.jsx) owns the frame height and
    // the shared header, so the page is a flex child of the region below the
    // header — it must not claim a height of its own.
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

// Directory-style row: the friend's real name and profile picture both link
// to their public profile; the share code is plain text; the badge renders
// only when the friend has a lesson the viewer can do with them together.
// Purely presentational — every gate lives in friends-logic.js.
function FriendRow({ friend, lang }) {
    const profileHref = `/${friend.shareCode}`;
    const pic = friend.profilePictureUrl || defaultProfilePic;
    const name = friend.displayName || friend.shareCode;
    return (
        <li data-testid="friend-row" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 0', borderBottom: '1px solid #2a4a6a' }}>
            <Link data-testid="friend-pic-link" to={profileHref} style={{ flexShrink: 0 }}>
                <img
                    data-testid="friend-pic"
                    src={pic}
                    alt={name}
                    crossOrigin="anonymous"
                    style={{ width: '48px', height: '48px', borderRadius: '50%', objectFit: 'cover', display: 'block' }}
                />
            </Link>
            <div style={{ flex: 1, minWidth: 0 }}>
                <Link
                    data-testid="friend-name-link"
                    to={profileHref}
                    style={{ color: '#ffffff', fontSize: '17px', fontWeight: 700, textDecoration: 'underline', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                    {name}
                </Link>
                <span data-testid="friend-share-code" style={{ color: '#ffffff', fontSize: '13px' }}>{friend.shareCode}</span>
                {friend.hasJointLessons === true && (
                    <span data-testid="friend-joint-badge" style={{ display: 'inline-block', marginLeft: '8px', padding: '2px 10px', borderRadius: '999px', backgroundColor: '#0f5132', color: '#8ce99a', fontSize: '12px', fontWeight: 700 }}>
                        {Strings.get('friends_joint_badge', lang)}
                    </span>
                )}
            </div>
        </li>
    );
}

// Friends directory: everyone the viewer has completed at least one lesson
// with (the friend-credit union), newest-first by credit order.
export default function Friends() {
    const navigate = useNavigate();
    const { data: profile, isLoading: profileLoading } = useUserProfile();
    // Settled-guest only: while the profile query is still loading `profile`
    // is undefined, which must render the spinner — never the login prompt.
    const isGuest = !profileLoading && (!profile || profile.$id === 'guest');
    const friendIds = isGuest ? [] : getFriendUserIds(profile);
    const { data: friendProfiles, isLoading: friendsLoading } = useFriendProfiles(friendIds);

    // Subscribed (not one-shot `getState()`): the page re-renders when the
    // guest language changes elsewhere. Guest-first through the shared hook;
    // the freshly fetched query profile rides as the fallback so a language
    // changed in the profile editor (which the store mirror has not caught up
    // with yet) already localizes this page.
    const lang = useNativeLanguage(profile?.native_language);

    const friends = isGuest ? [] : buildFriendsList({ profile, friendProfiles: friendProfiles ?? [], nowMs: Date.now() });
    const isLoading = profileLoading || (!isGuest && friendIds.length > 0 && friendsLoading);

    return (
        <div style={containerStyle}>
            <div style={headerStyle}>
                <span data-testid="friends-heading" style={{ fontSize: '25px', fontWeight: 600, textAlign: 'center', width: '100%' }}>{Strings.get('friends_heading', lang)}</span>
            </div>

            <div style={{ padding: '24px 16px', maxWidth: '640px', margin: '0 auto' }}>
                <p data-testid="friends-subheading" style={{ color: '#ffffff', fontSize: '15px', lineHeight: 1.5, margin: '0 0 16px' }}>
                    {Strings.get('friends_subheading', lang)}
                </p>
                <div data-testid="friends-callout" style={{ ...cardStyle, marginBottom: '24px', borderLeft: '4px solid #00c0d8' }}>
                    <p style={{ color: '#ffffff', fontSize: '14px', lineHeight: 1.5, margin: 0 }}>
                        {Strings.get('friends_callout', lang)}
                    </p>
                </div>

                {isGuest ? (
                    <div data-testid="friends-login-required" style={{ ...cardStyle, textAlign: 'center' }}>
                        <Link data-testid="friends-login-link" to="/login?redirect=%2Ffriends" style={{ color: '#ffffff', fontSize: '16px', fontWeight: 600, textDecoration: 'underline' }}>
                            {Strings.get('friends_login_required', lang)}
                        </Link>
                    </div>
                ) : isLoading ? (
                    <div data-testid="friends-loading" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px' }}>
                        <div className="spinner-border" role="status" style={{ width: '3rem', height: '3rem' }}>
                            <span className="visually-hidden">Loading...</span>
                        </div>
                    </div>
                ) : friends.length === 0 ? (
                    <div data-testid="friends-empty" style={{ ...cardStyle, textAlign: 'center' }}>
                        <p style={{ color: '#ffffff', fontSize: '15px', lineHeight: 1.5, margin: 0 }}>
                            {Strings.get('friends_empty', lang)}
                        </p>
                    </div>
                ) : (
                    <div style={cardStyle}>
                        <ul data-testid="friends-list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                            {friends.map((friend) => (
                                <FriendRow key={friend.id} friend={friend} lang={lang} />
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        </div>
    );
}
