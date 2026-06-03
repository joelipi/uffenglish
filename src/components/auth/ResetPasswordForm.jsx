import { useState, useEffect } from 'react';
import { account } from '../../modules/api/appwrite.js';
import { getUrlParam } from '../../modules/utils/url-params.js';
import Strings from '../../data/strings.js';

export function useResetPasswordForm({ onResetSuccess } = {}) {
    const [password, setPassword] = useState('');
    const [passwordConfirm, setPasswordConfirm] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);
    const [loading, setLoading] = useState(false);
    const [invalidLink, setInvalidLink] = useState(false);

    const userId = getUrlParam('userId');
    const secret = getUrlParam('secret');

    useEffect(() => {
        if (!userId || !secret) {
            setInvalidLink(true);
        }
    }, [userId, secret]);

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');

        if (password !== passwordConfirm) {
            setError(Strings.get('auth_passwords_mismatch', 'en'));
            return;
        }

        setLoading(true);

        try {
            await account.updateRecovery(userId, secret, password, passwordConfirm);
            setSuccess(true);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    return {
        password,
        setPassword,
        passwordConfirm,
        setPasswordConfirm,
        error,
        success,
        loading,
        invalidLink,
        handleSubmit,
        onResetSuccess,
    };
}
