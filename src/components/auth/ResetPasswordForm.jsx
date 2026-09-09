import { useState, useEffect } from 'react';
import { supabase } from '../../modules/api/supabase.js';
import { appStore } from '../../modules/store/store.js';
import Strings from '../../data/strings.js';

export function useResetPasswordForm({ onResetSuccess } = {}) {
    const [password, setPassword] = useState('');
    const [passwordConfirm, setPasswordConfirm] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);
    const [loading, setLoading] = useState(false);
    const [invalidLink, setInvalidLink] = useState(false);

    useEffect(() => {
        // Supabase recovery links set a session via ?code= or hash. Check session exists.
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (!session) {
                // No session — might be invalid/expired link. Don't block immediately,
                // let user try; Supabase will error on updateUser if invalid.
                console.warn('[ResetPassword] No active session from recovery link');
            }
        });
    }, []);

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');

        if (password !== passwordConfirm) {
            const lang = appStore.getState().guestNativeLanguage || appStore.getState().userData?.native_language || 'en';
            setError(Strings.get('auth_passwords_mismatch', lang));
            return;
        }

        setLoading(true);

        try {
            const { error } = await supabase.auth.updateUser({ password });
            if (error) throw error;
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
