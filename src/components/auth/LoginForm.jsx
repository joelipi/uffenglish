import { useState } from 'react';
import { account } from '../../modules/api/appwrite.js';
import { invalidateUserAndAuthCache } from '../../modules/api/api.js';

export function useLoginForm({ onLoginSuccess } = {}) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            try {
                await account.get();
                onLoginSuccess?.();
                return;
            } catch {
                // Not logged in, proceed to login
            }

            await account.createEmailPasswordSession(email, password);
            invalidateUserAndAuthCache();
            onLoginSuccess?.();
        } catch (err) {
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
