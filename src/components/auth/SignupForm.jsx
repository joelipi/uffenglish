import { useState } from 'react';
import { supabase } from '../../modules/api/supabase.js';
import { queryClient } from '../../modules/api/api.js';
import { identifyUser, trackEvent } from '../../modules/utils/posthog.js';
import { toShortId } from '../../modules/utils/short-id.js';
import defaultProfilePic from '../../assets/img/userprofile.png';

export function useSignupForm({ onSignupSuccess } = {}) {
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [nativeLanguage, setNativeLanguage] = useState('');
    const [userLevel, setUserLevel] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const fullName = `${firstName.trim()} ${lastName.trim()}`;

            const { data, error: signUpError } = await supabase.auth.signUp({
                email,
                password,
                options: { data: { full_name: fullName } }
            });
            if (signUpError) throw signUpError;
            const user = data.user;
            if (!user) throw new Error('Signup failed — no user returned');

            try {
                const { collectSignupGeoAndReferrer } = await import('../../modules/user/collect-signup-data.js');
                collectSignupGeoAndReferrer().then(() => {
                    console.log('[Signup] Geo/referrer collection finished.');
                });
            } catch (importError) {
                console.error('[Signup] Failed to import collection module:', importError);
            }

            const shareCode = toShortId(Math.floor(Math.random() * 0xFFFFFF));
            const { error: insertError } = await supabase.from('user_profiles').insert({
                id: user.id,
                email: email,
                first_name: firstName.trim(),
                last_name: lastName.trim(),
                join_date: new Date().toISOString(),
                account_status: 'active',
                native_language: nativeLanguage,
                english_level: userLevel,
                completed_dates: [],
                share_code: shareCode,
            });
            if (insertError) {
                console.error('[Signup] Failed to create profile row:', insertError);
                throw insertError;
            }
            console.log(`[Signup] shareCode ${shareCode} set for user ${user.id}`);

            identifyUser(user.id, {
                email: user.email,
                name: fullName,
                signup_native_language: nativeLanguage,
                signup_english_level: userLevel,
            });
            trackEvent('signup', {
                native_language: nativeLanguage,
                english_level: userLevel,
            });

            queryClient.setQueryData(['auth', 'status'], true);
            queryClient.setQueryData(['user', 'profile'], {
                $id: user.id,
                email: email,
                display_name: fullName,
                join_date: user.created_at,
                auth_method: 'supabase',
                shareCode,
                share_code: shareCode,
                firstName: firstName.trim(),
                lastName: lastName.trim(),
                native_language: nativeLanguage,
                english_level: userLevel,
                completed_dates: [],
                profilePictureUrl: defaultProfilePic,
            });
            onSignupSuccess?.();
        } catch (err) {
            trackEvent('signup_failed', { error: err.message });
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    return {
        firstName,
        setFirstName,
        lastName,
        setLastName,
        email,
        setEmail,
        password,
        setPassword,
        nativeLanguage,
        setNativeLanguage,
        userLevel,
        setUserLevel,
        error,
        loading,
        handleSubmit,
    };
}
