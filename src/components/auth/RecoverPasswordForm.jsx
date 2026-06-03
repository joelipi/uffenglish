import { useState } from 'react';
import { account } from '../../modules/api/appwrite.js';
import { getAppOrigin } from '../../modules/utils/url-params.js';

export function useRecoverPasswordForm({ onBackToLogin } = {}) {
    const [email, setEmail] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);
    const [loading, setLoading] = useState(false);

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setSuccess(false);
        setLoading(true);

        try {
            const resetUrl = `${getAppOrigin()}/reset-password`;
            await account.createRecovery(email, resetUrl);
            setSuccess(true);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    return {
        email,
        setEmail,
        error,
        success,
        loading,
        handleSubmit,
        onBackToLogin,
    };
}
