import { useState } from 'react';
import { supabase, getCurrentUser } from '../../modules/api/supabase.js';
import { queryClient, getUserProfile } from '../../modules/api/api.js';
import { identifyUser, trackEvent } from '../../modules/utils/posthog.js';
import { flushPendingFriendCredits } from '../../modules/user/friend-credit-sync.js';

export function useLoginForm({ onLoginSuccess } = {}) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    async function identifyAfterLogin() {
        const user = await getCurrentUser();
        if (user) {
            identifyUser(user.$id, {
                email: user.email,
                name: user.name,
            });
            trackEvent('login', { method: 'email' });
        }
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            try {
                const user = await getCurrentUser();
                if (user) {
                    trackEvent('login', { method: 'existing_session' });
                    // A restored session can carry pre-auth guest credits.
                    void flushPendingFriendCredits();
                    onLoginSuccess?.();
                    return;
                }
            } catch {
                // Not logged in, proceed
            }

            const { error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) throw error;

            queryClient.setQueryData(['auth', 'status'], true);
            // Deferred friend credit for guest completions before this login.
            void flushPendingFriendCredits();
            getUserProfile().catch(err => console.warn('[Login] Profile pre-fetch failed:', err));
            identifyAfterLogin();
            onLoginSuccess?.();
        } catch (err) {
            trackEvent('login_failed', { error: err.message });
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    return {
        email,
        setEmail,
        password,
        setPassword,
        error,
        loading,
        handleSubmit,
    };
}
