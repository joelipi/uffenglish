import { useState } from 'react';
import { supabase } from '../../modules/api/supabase.js';
import { queryClient } from '../../modules/api/api.js';
import { appStore } from '../../modules/store/store.js';
import { identifyUser, trackEvent } from '../../modules/utils/posthog.js';
import { toShortId } from '../../modules/utils/short-id.js';
import { sendWelcomeEmail } from '../../modules/user/email-confirmation.js';
import { guestSignupLessonCredit } from '../../modules/user/lesson-count-logic.js';
import defaultProfilePic from '../../assets/img/userprofile.png';

export function useSignupForm({ onSignupSuccess, nativeLanguage: initialNativeLanguage = '' } = {}) {
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [nativeLanguage, setNativeLanguage] = useState(initialNativeLanguage);
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
                // native_language rides on user_metadata so the welcome email can
                // be localized without an extra profile query at send time.
                options: { data: { full_name: fullName, native_language: nativeLanguage } }
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
            // A guest's completed lesson lives only in the store — there is no
            // row to write it to, and the bootstrap right after signup seeds the
            // store from that row. Credit the lesson on the success screen so the
            // new account shows it. When signing up from anywhere else, no extra
            // columns are written and the DB defaults apply.
            const lessonCredit = guestSignupLessonCredit({
                courseId: appStore.getState().courseId,
                lessonId: appStore.getState().successLessonId,
            });
            if (lessonCredit.creditLesson) {
                console.log(`[Signup] Crediting guest lesson ${lessonCredit.key} to the new account`);
            }
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
                ...(lessonCredit.creditLesson
                    ? { lessons_completed: lessonCredit.lessonsCompleted, counted_lessons: lessonCredit.countedLessons }
                    : {}),
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
            const profile = {
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
                // Keep the client-side profile in sync with the row just
                // inserted, so a further completion in this session baselines
                // off 1 instead of the store's guest value.
                ...(lessonCredit.creditLesson
                    ? { lessons_completed: lessonCredit.lessonsCompleted, counted_lessons: lessonCredit.countedLessons }
                    : {}),
            };
            queryClient.setQueryData(['user', 'profile'], profile);
            // Sync the Zustand store too: useAppBootstrap only writes isLoggedIn /
            // userData once (initStarted guard), so an inline signup that only
            // updates the React Query cache would leave the app thinking it is
            // still a guest (no share code, no R2 publish).
            appStore.getState().setIsLoggedIn(true);
            appStore.getState().setCourseData({ userData: profile });

            // Fire-and-forget: the welcome/confirm email is optional and must
            // never delay or fail the signup the user just completed. The
            // helper swallows all errors and returns { sent }, so this is safe
            // to leave un-awaited.
            void sendWelcomeEmail();

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
