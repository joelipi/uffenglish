import { useState } from 'react';
import { supabase } from '../../modules/api/supabase.js';
import { queryClient } from '../../modules/api/api.js';
import { appStore } from '../../modules/store/store.js';
import { identifyUser, trackEvent } from '../../modules/utils/posthog.js';

import { sendWelcomeEmail } from '../../modules/user/email-confirmation.js';
import { guestSignupLessonCredit } from '../../modules/user/lesson-count-logic.js';
import { calculateCurrentStreak } from '../../modules/user/user-profile.js';
import { flushPendingFriendCredits } from '../../modules/user/friend-credit-sync.js';
import { verifyTurnstileToken } from '../../modules/auth/turnstile-logic.js';
import { generateShareCode } from '../../modules/utils/short-id.js';
import {
    checkEmailAddress,
    normalizeEmail,
} from '../../modules/auth/email-validation-logic.js';
import defaultProfilePic from '../../assets/img/userprofile.png';

/**
 * Shared signup logic. `captcha` gates the submit on a server-side Turnstile
 * verification; it defaults to on and is turned off only for the success-step
 * modal form (SaveClipsSignupForm), which renders inside a native <dialog>
 * that is closed at the time the widget would have to run.
 *
 * `getCaptchaToken` supplies a FRESH widget token at submit time — Turnstile
 * tokens are single-use and expire after ~5 minutes, so the form cannot capture
 * one at render and reuse it.
 *
 * This hook also runs the zero-cost email screen before any account is created.
 * It returns `emailError` as a reason CODE plus `emailSuggestion`, never copy:
 * the view resolves both through strings.js, because logic owns decisions and
 * display owns language. `captcha: false` does NOT disable the email check —
 * the screen is a data-quality gate, not a bot gate, so it applies to every
 * signup surface including the modal.
 */
export function useSignupForm({
    onSignupSuccess,
    nativeLanguage: initialNativeLanguage = '',
    captcha = true,
    getCaptchaToken,
} = {}) {
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [nativeLanguage, setNativeLanguage] = useState(initialNativeLanguage);
    const [userLevel, setUserLevel] = useState('');
    const [error, setError] = useState('');
    const [emailError, setEmailError] = useState('');
    const [emailSuggestion, setEmailSuggestion] = useState('');
    const [loading, setLoading] = useState(false);

    /**
     * Replace the address and drop any stale screen verdict.
     *
     * Clearing lives here rather than in the views because deciding WHICH state
     * a stale verdict invalidates is logic, not rendering — and because two
     * views (the standalone form and the save-clips modal) share this hook and
     * must recover identically.
     *
     * `setEmail` is deliberately NOT exported: a view could then write the
     * address without clearing the verdict, and the stale alert would return
     * with no visible cause. Only this function may change the address.
     *
     * Only the email verdict is invalidated. A generic `error` (e.g. Supabase
     * reporting the address is already registered) is left alone, because
     * editing the field is not evidence that a non-email failure went away.
     */
    function handleEmailChange(value) {
        setEmail(value);
        setEmailError('');
        setEmailSuggestion('');
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setEmailError('');
        setEmailSuggestion('');
        setLoading(true);

        try {
            const fullName = `${firstName.trim()} ${lastName.trim()}`;

            // Bot gate, in front of the Supabase call. The token is verified
            // server-side (functions/api/turnstile-verify.js) before any account
            // is created, so a bot that skips the widget gets no account.
            if (captcha) {
                if (typeof getCaptchaToken !== 'function') {
                    throw new Error('Human verification is not ready yet. Please try again.');
                }
                const captchaToken = await getCaptchaToken();
                const captchaVerified = await verifyTurnstileToken(captchaToken);
                if (!captchaVerified) {
                    throw new Error('Human verification failed. Please try again.');
                }
            }

            // One canonical identity for the whole submit: the address that is SCREENED
            // is the address that is CREATED. GoTrue normalizes server-side too,
            // but normalizing here keeps the screen, the profile row and the
            // login lookup agreeing even if that ever changes.
            const signupEmail = normalizeEmail(email);

            // Zero-cost email screen, in front of the Supabase call and after
            // the bot gate. The server (functions/api/email-validate.js) is
            // authoritative — a browser-only check is bypassed by posting
            // straight to Supabase — and it fails OPEN, so a lookup outage
            // returns valid:true and lands here as a no-op rather than costing
            // a signup. Only a definite verdict blocks, and then no account is
            // created.
            const emailVerdict = await checkEmailAddress(signupEmail);
            if (!emailVerdict.valid) {
                console.log(`[Signup] Email screen rejected the address (${emailVerdict.reason})`);
                setEmailError(emailVerdict.reason);
                setEmailSuggestion(emailVerdict.suggestion || '');
                return;
            }

            const { data, error: signUpError } = await supabase.auth.signUp({
                email: signupEmail,
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

            const shareCode = generateShareCode();
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
            // The completion day counts too: without it the new account starts
            // with streak 0 / 0 active days despite just finishing a lesson.
            const signupDates = lessonCredit.creditLesson
                ? [new Date().toLocaleDateString('en-CA')]
                : [];
            // UPSERT, not insert. The fire-and-forget geo/referrer collection above
            // (collect-signup-data.js) also writes this row, via
            // syncUserMetaDataMutation's upsert. Which of the two lands first is
            // a network race, so a plain INSERT here failed with
            // `duplicate key value violates unique constraint
            // "user_profiles_pkey"` whenever geo won — the account existed, the
            // signup reported failure, and the profile row kept a NULL email
            // because only the geo columns had been written.
            //
            // With onConflict: 'id' the write is idempotent and order
            // independent: an existing row is UPDATEd with these columns, and a
            // missing one is INSERTed. Postgres only updates the columns
            // actually supplied, so the geo write landing afterwards adds its
            // fields without disturbing the profile.
            const { error: insertError } = await supabase.from('user_profiles').upsert({
                id: user.id,
                email: signupEmail,
                first_name: firstName.trim(),
                last_name: lastName.trim(),
                join_date: new Date().toISOString(),
                account_status: 'active',
                native_language: nativeLanguage,
                english_level: userLevel,
                completed_dates: signupDates,
                share_code: shareCode,
                ...(lessonCredit.creditLesson
                    ? { lessons_completed: lessonCredit.lessonsCompleted, counted_lessons: lessonCredit.countedLessons }
                    : {}),
            }, { onConflict: 'id' });
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
                email: signupEmail,
                display_name: fullName,
                join_date: user.created_at,
                auth_method: 'supabase',
                shareCode,
                share_code: shareCode,
                firstName: firstName.trim(),
                lastName: lastName.trim(),
                native_language: nativeLanguage,
                english_level: userLevel,
                completed_dates: signupDates,
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
            // Sync the store counters too when a lesson was credited: the next
            // completion baselines off max(row, store) and the union of both
            // counted sets, so leaving the guest's full in-session values here
            // would over-count (store 2 + row 1 -> 3) and permanently admit the
            // pre-signup keys into the new row.
            if (lessonCredit.creditLesson) {
                appStore.getState().setLessonsCompleted(lessonCredit.lessonsCompleted);
                appStore.getState().setCountedLessons(lessonCredit.countedLessons);
                // The credited day starts the streak: the guest bootstrap never
                // seeded activity metrics, so without this the new account shows
                // streak 0 despite just finishing a lesson.
                appStore.getState().setActivityMetrics(signupDates.length, calculateCurrentStreak(signupDates));
            }

            // Deferred friend credit (answer 4): a guest completion stashed an
            // owner credit that needs an account to record. Fail-open inside —
            // never blocks the signup the user just completed.
            void flushPendingFriendCredits();

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
        handleEmailChange,
        password,
        setPassword,
        nativeLanguage,
        setNativeLanguage,
        userLevel,
        setUserLevel,
        error,
        emailError,
        emailSuggestion,
        loading,
        handleSubmit,
    };
}
