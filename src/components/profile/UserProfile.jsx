import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { account } from '../../modules/api/appwrite.js';
import { useUserProfile, useSyncUserMetaData } from '../../modules/api/api.js';
import { invalidateUserAndAuthCache } from '../../modules/api/api.js';
import Strings from '../../data/strings.js';
import defaultProfilePic from '../../assets/img/userprofile.png';

const NATIVE_LANGUAGES = [
    { value: 'EN', label: 'English' },
    { value: 'ES', label: 'Spanish' },
    { value: 'FR', label: 'French' },
    { value: 'DE', label: 'German' },
    { value: 'IT', label: 'Italian' },
    { value: 'PT', label: 'Portuguese' },
    { value: 'ZH', label: 'Chinese' },
    { value: 'JA', label: 'Japanese' },
    { value: 'KO', label: 'Korean' },
    { value: 'RU', label: 'Russian' },
    { value: 'AR', label: 'Arabic' },
    { value: 'HI', label: 'Hindi' },
    { value: 'NL', label: 'Dutch' },
    { value: 'PL', label: 'Polish' },
    { value: 'TR', label: 'Turkish' },
    { value: 'VI', label: 'Vietnamese' },
    { value: 'TH', label: 'Thai' },
    { value: 'SV', label: 'Swedish' },
    { value: 'DA', label: 'Danish' },
    { value: 'NB', label: 'Norwegian' },
    { value: 'FI', label: 'Finnish' },
    { value: 'EL', label: 'Greek' },
    { value: 'CS', label: 'Czech' },
    { value: 'HU', label: 'Hungarian' },
    { value: 'RO', label: 'Romanian' },
    { value: 'UK', label: 'Ukrainian' },
];

const ENGLISH_LEVELS = ['A0', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'Native'];

function Section({ title, children }) {
    return (
        <div style={{ marginBottom: '24px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px', color: '#e0e0e0' }}>{title}</h3>
            {children}
        </div>
    );
}

function FormField({ label, id, children }) {
    return (
        <div style={{ marginBottom: '16px' }}>
            <label htmlFor={id} style={{ display: 'block', marginBottom: '6px', fontSize: '14px', color: '#adb5bd' }}>{label}</label>
            {children}
        </div>
    );
}

function Input({ id, value, onChange, type = 'text', placeholder, disabled }) {
    return (
        <input id={id} type={type} value={value} onChange={onChange} placeholder={placeholder} disabled={disabled}
               style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #2a4a6a', backgroundColor: '#0b1a2a', color: 'white', fontSize: '15px', boxSizing: 'border-box' }} />
    );
}

function Select({ id, value, onChange, options, disabled }) {
    return (
        <select id={id} value={value} onChange={onChange} disabled={disabled}
                style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #2a4a6a', backgroundColor: '#0b1a2a', color: 'white', fontSize: '15px', boxSizing: 'border-box' }}>
            {options.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label || opt.value}</option>
            ))}
        </select>
    );
}

function StatusMessage({ type, message }) {
    if (!message) return null;
    const isSuccess = type === 'success';
    return (
        <div style={{ padding: '10px 14px', borderRadius: '8px', marginBottom: '16px', fontSize: '14px', backgroundColor: isSuccess ? '#1a3a2a' : '#3a1a1a', color: isSuccess ? '#6fcf97' : '#ff6b6b', border: `1px solid ${isSuccess ? '#2a5a3a' : '#5a2a2a'}` }}>
            <i className={`bi ${isSuccess ? 'bi-check-circle-fill' : 'bi-exclamation-circle-fill'}`} style={{ marginRight: '8px' }}></i>
            {message}
        </div>
    );
}

export default function UserProfile() {
    const navigate = useNavigate();
    const { data: profile, isLoading, isError } = useUserProfile();
    const syncMutation = useSyncUserMetaData();

    const lang = profile?.native_language?.toLowerCase() || 'en';
    const isGuest = profile?.$id === 'guest';
    const displayName = profile?.display_name || '';
    const email = profile?.email || '';
    const joinDate = profile?.join_date ? new Date(profile.join_date).toLocaleDateString() : '';
    const profilePic = profile?.profilepicurl || defaultProfilePic;
    const completedDates = Array.isArray(profile?.completed_dates) ? profile.completed_dates : [];
    const lessonsCompleted = Number(profile?.lessons_completed || 0);

    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [nativeLanguage, setNativeLanguage] = useState('EN');
    const [userLevel, setUserLevel] = useState('A0');
    const [profileMsg, setProfileMsg] = useState(null);

    const [newEmail, setNewEmail] = useState('');
    const [emailPassword, setEmailPassword] = useState('');
    const [emailMsg, setEmailMsg] = useState(null);
    const [emailLoading, setEmailLoading] = useState(false);

    const [curPassword, setCurPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [passwordMsg, setPasswordMsg] = useState(null);
    const [passwordLoading, setPasswordLoading] = useState(false);

    useEffect(() => {
        if (profile) {
            setFirstName(profile.firstName || '');
            setLastName(profile.lastName || '');
            setNativeLanguage(profile.native_language || 'EN');
            setUserLevel(profile.english_level || 'A0');
        }
    }, [profile]);

    async function handleProfileSave() {
        setProfileMsg(null);
        const fullName = `${firstName} ${lastName}`.trim();
        try {
            await syncMutation.mutateAsync({
                metaToUpdate: {
                    firstName,
                    lastName,
                    native_language: nativeLanguage,
                    english_level: userLevel,
                },
                userId: profile.$id,
            });
            await account.updateName(fullName);
            invalidateUserAndAuthCache();
            setProfileMsg({ type: 'success', text: Strings.get('profile_updated', lang) });
        } catch (err) {
            setProfileMsg({ type: 'error', text: err.message || Strings.get('profile_update_failed', lang) });
        }
    }

    async function handleEmailChange() {
        setEmailMsg(null);
        if (!newEmail) { setEmailMsg({ type: 'error', text: 'Please enter a new email.' }); return; }
        if (!emailPassword) { setEmailMsg({ type: 'error', text: 'Please enter your current password.' }); return; }
        setEmailLoading(true);
        try {
            await account.updateEmail(newEmail, emailPassword);
            invalidateUserAndAuthCache();
            setEmailMsg({ type: 'success', text: Strings.get('profile_email_verification_sent', lang) });
            setNewEmail('');
            setEmailPassword('');
        } catch (err) {
            setEmailMsg({ type: 'error', text: err.message || Strings.get('profile_email_update_failed', lang) });
        } finally {
            setEmailLoading(false);
        }
    }

    async function handlePasswordChange() {
        setPasswordMsg(null);
        if (!curPassword) { setPasswordMsg({ type: 'error', text: 'Please enter your current password.' }); return; }
        if (!newPassword || newPassword.length < 8) { setPasswordMsg({ type: 'error', text: 'New password must be at least 8 characters.' }); return; }
        if (newPassword !== confirmPassword) { setPasswordMsg({ type: 'error', text: 'Passwords do not match.' }); return; }
        setPasswordLoading(true);
        try {
            await account.updatePassword(newPassword, curPassword);
            setPasswordMsg({ type: 'success', text: Strings.get('profile_password_updated', lang) });
            setCurPassword('');
            setNewPassword('');
            setConfirmPassword('');
        } catch (err) {
            setPasswordMsg({ type: 'error', text: err.message || Strings.get('profile_password_update_failed', lang) });
        } finally {
            setPasswordLoading(false);
        }
    }

    const containerStyle = {
        height: '100vh',
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

    const inputStyle = {
        width: '100%',
        padding: '12px',
        borderRadius: '8px',
        border: '1px solid #2a4a6a',
        backgroundColor: '#0b1a2a',
        color: 'white',
        fontSize: '15px',
        boxSizing: 'border-box',
    };

    const btnPrimaryStyle = {
        padding: '12px 24px',
        backgroundColor: '#007bff',
        color: 'white',
        border: 'none',
        borderRadius: '8px',
        fontSize: '15px',
        fontWeight: 600,
        cursor: 'pointer',
    };

    const btnPrimaryDisabled = {
        ...btnPrimaryStyle,
        opacity: 0.6,
        cursor: 'not-allowed',
    };

    if (isLoading) {
        return (
            <div style={containerStyle}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
                    <div className="spinner-border" role="status" style={{ width: '3rem', height: '3rem' }}>
                        <span className="visually-hidden">Loading...</span>
                    </div>
                </div>
            </div>
        );
    }

    if (isError) {
        return (
            <div style={containerStyle}>
                <div style={headerStyle}>
                    <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: 'white', fontSize: '20px', cursor: 'pointer' }}>
                        <i className="bi bi-arrow-left"></i>
                    </button>
                    <span style={{ fontSize: '18px', fontWeight: 600 }}>{Strings.get('profile_title', lang)}</span>
                </div>
                <div style={{ padding: '24px 16px', textAlign: 'center', color: '#ff6b6b' }}>
                    <i className="bi bi-exclamation-triangle-fill" style={{ fontSize: '32px', display: 'block', marginBottom: '12px' }}></i>
                    {Strings.get('profile_load_failed', lang)}
                </div>
            </div>
        );
    }

    if (isGuest) {
        return (
            <div style={containerStyle}>
                <div style={headerStyle}>
                    <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: 'white', fontSize: '20px', cursor: 'pointer' }}>
                        <i className="bi bi-arrow-left"></i>
                    </button>
                    <span style={{ fontSize: '18px', fontWeight: 600 }}>{Strings.get('profile_title', lang)}</span>
                </div>
                <div style={{ padding: '24px 16px' }}>
                    <div style={{ ...cardStyle, textAlign: 'center' }}>
                        <i className="bi bi-person-circle" style={{ fontSize: '64px', color: '#6c757d', marginBottom: '16px', display: 'block' }}></i>
                        <h2 style={{ fontSize: '22px', marginBottom: '12px' }}>{Strings.get('profile_guest_title', lang)}</h2>
                        <p style={{ color: '#adb5bd', marginBottom: '24px', lineHeight: 1.6 }}>
                            {Strings.get('profile_guest_message', lang)}
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '300px', margin: '0 auto' }}>
                            <Link to="/signup" style={{ ...btnPrimaryStyle, textDecoration: 'none', textAlign: 'center', display: 'block' }}>
                                {Strings.get('guest_modal_signup', lang)}
                            </Link>
                            <Link to="/login" style={{ ...btnPrimaryStyle, textDecoration: 'none', textAlign: 'center', display: 'block' }}>
                                {Strings.get('sign_in', lang)}
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div style={containerStyle}>
            <div style={headerStyle}>
                <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: 'white', fontSize: '20px', cursor: 'pointer' }}>
                    <i className="bi bi-arrow-left"></i>
                </button>
                <span style={{ fontSize: '18px', fontWeight: 600 }}>{Strings.get('profile_title', lang)}</span>
            </div>

            <div style={{ padding: '24px 16px', maxWidth: '640px', margin: '0 auto' }}>

                <div style={{ ...cardStyle, textAlign: 'center', marginBottom: '24px' }}>
                    <img src={profilePic} alt={Strings.get('profile_title', lang)} style={{ width: '96px', height: '96px', borderRadius: '50%', objectFit: 'cover', marginBottom: '12px' }}
                         onError={e => { e.currentTarget.src = defaultProfilePic; }} />
                    <h2 style={{ fontSize: '22px', marginBottom: '4px' }}>{displayName}</h2>
                    <p style={{ color: '#adb5bd', fontSize: '14px', marginBottom: '4px' }}>{email}</p>
                    {joinDate && <p style={{ color: '#6c757d', fontSize: '13px' }}>{Strings.get('profile_member_since', lang, { date: joinDate })}</p>}
                </div>

                <Section title={Strings.get('profile_personal_info', lang)}>
                    <div style={cardStyle}>
                        <StatusMessage type={profileMsg?.type} message={profileMsg?.text} />
                        <FormField label={Strings.get('profile_first_name', lang)} id="firstName">
                            <Input id="firstName" value={firstName} onChange={e => setFirstName(e.target.value)} />
                        </FormField>
                        <FormField label={Strings.get('profile_last_name', lang)} id="lastName">
                            <Input id="lastName" value={lastName} onChange={e => setLastName(e.target.value)} />
                        </FormField>
                        <FormField label={Strings.get('profile_native_language', lang)} id="nativeLanguage">
                            <Select id="nativeLanguage" value={nativeLanguage} onChange={e => setNativeLanguage(e.target.value)} options={NATIVE_LANGUAGES} />
                        </FormField>
                        <FormField label={Strings.get('profile_user_level', lang)} id="userLevel">
                            <Select id="userLevel" value={userLevel} onChange={e => setUserLevel(e.target.value)} options={ENGLISH_LEVELS.map(l => ({ value: l, label: l }))} />
                        </FormField>
                        <button onClick={handleProfileSave} disabled={syncMutation.isPending}
                                style={syncMutation.isPending ? btnPrimaryDisabled : btnPrimaryStyle}>
                            {syncMutation.isPending ? <span className="spinner-border spinner-border-sm" role="status"></span> : Strings.get('profile_save', lang)}
                        </button>
                    </div>
                </Section>

                <Section title={Strings.get('profile_change_email', lang)}>
                    <div style={cardStyle}>
                        <StatusMessage type={emailMsg?.type} message={emailMsg?.text} />
                        <FormField label={Strings.get('profile_new_email', lang)} id="newEmail">
                            <input id="newEmail" type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} style={inputStyle} />
                        </FormField>
                        <FormField label={Strings.get('profile_current_password', lang)} id="emailPassword">
                            <input id="emailPassword" type="password" value={emailPassword} onChange={e => setEmailPassword(e.target.value)} style={inputStyle} />
                        </FormField>
                        <button onClick={handleEmailChange} disabled={emailLoading} style={emailLoading ? btnPrimaryDisabled : btnPrimaryStyle}>
                            {emailLoading ? <span className="spinner-border spinner-border-sm" role="status"></span> : Strings.get('profile_update_email', lang)}
                        </button>
                    </div>
                </Section>

                <Section title={Strings.get('profile_change_password', lang)}>
                    <div style={cardStyle}>
                        <StatusMessage type={passwordMsg?.type} message={passwordMsg?.text} />
                        <FormField label={Strings.get('profile_current_password', lang)} id="curPassword">
                            <input id="curPassword" type="password" value={curPassword} onChange={e => setCurPassword(e.target.value)} style={inputStyle} />
                        </FormField>
                        <FormField label={Strings.get('profile_new_password', lang)} id="newPassword">
                            <input id="newPassword" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder={Strings.get('profile_min_chars', lang)} style={inputStyle} />
                        </FormField>
                        <FormField label={Strings.get('profile_confirm_password', lang)} id="confirmPassword">
                            <input id="confirmPassword" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} style={inputStyle} />
                        </FormField>
                        <button onClick={handlePasswordChange} disabled={passwordLoading} style={passwordLoading ? btnPrimaryDisabled : btnPrimaryStyle}>
                            {passwordLoading ? <span className="spinner-border spinner-border-sm" role="status"></span> : Strings.get('profile_update_password', lang)}
                        </button>
                    </div>
                </Section>

                <Section title={Strings.get('profile_statistics', lang)}>
                    <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ color: '#adb5bd' }}>{Strings.get('profile_lessons_completed', lang)}</span>
                            <span style={{ fontSize: '20px', fontWeight: 700 }}>{lessonsCompleted}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ color: '#adb5bd' }}>{Strings.get('profile_days_active', lang)}</span>
                            <span style={{ fontSize: '20px', fontWeight: 700 }}>{completedDates.length}</span>
                        </div>
                    </div>
                </Section>
            </div>
        </div>
    );
}
