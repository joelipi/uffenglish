import { useState } from 'react';
import { account, getCurrentUser } from '../../modules/api/appwrite.js';
import { queryClient, getUserProfile } from '../../modules/api/api.js';
import { identifyUser, trackEvent } from '../../modules/utils/posthog.js';

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
                await account.get();
                trackEvent('login', { method: 'existing_session' });
                onLoginSuccess?.();
                return;
            } catch {
                // Not logged in, proceed to login
            }

            await account.createEmailPasswordSession(email, password);

            // Seed auth status immediately, then start pre-fetching the profile
            // so /profile renders from cache without a slow loading spinner.
            queryClient.setQueryData(['auth', 'status'], true);
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
