import { useState } from 'react';
import { account, tablesDB, ID, APPWRITE_CONFIG } from '../../modules/api/appwrite.js';
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

            const user = await account.create(ID.unique(), email, password, fullName);

            await account.createEmailPasswordSession(email, password);

            try {
                const { collectSignupGeoAndReferrer } = await import('../../modules/user/collect-signup-data.js');
                collectSignupGeoAndReferrer().then(() => {
                    console.log('[Signup] Geo/referrer collection finished.');
                });
            } catch (importError) {
                console.error('[Signup] Failed to import collection module:', importError);
            }

            const profileRow = await tablesDB.createRow({
                databaseId: APPWRITE_CONFIG.DATABASE_ID,
                tableId: APPWRITE_CONFIG.USER_PROFILES_TABLE_ID,
                rowId: user.$id,
                data: {
                    email: email,
                    firstName: firstName.trim(),
                    lastName: lastName.trim(),
                    joinDate: new Date().toISOString(),
                    accountStatus: 'active',
                    native_language: nativeLanguage,
                    english_level: userLevel,
                    completed_dates: []
                },
                permissions: [
                    `read("any")`,
                    `read("user:${user.$id}")`,
                    `update("user:${user.$id}")`,
                    `delete("user:${user.$id}")`
                ]
            });

            const shareCode = toShortId(profileRow.$sequence);
            try {
                await tablesDB.updateRow({
                    databaseId: APPWRITE_CONFIG.DATABASE_ID,
                    tableId: APPWRITE_CONFIG.USER_PROFILES_TABLE_ID,
                    rowId: profileRow.$id,
                    data: { shareCode },
                    permissions: [
                        `read("any")`,
                        `read("user:${user.$id}")`,
                        `update("user:${user.$id}")`,
                        `delete("user:${user.$id}")`
                    ]
                });
                console.log(`[Signup] shareCode ${shareCode} set for user ${profileRow.$id}`);
            } catch (shareCodeError) {
                console.error(`[Signup] Failed to set shareCode for user ${profileRow.$id}:`, shareCodeError);
            }

            identifyUser(user.$id, {
                email: user.email,
                name: user.name,
                signup_native_language: nativeLanguage,
                signup_english_level: userLevel,
            });
            trackEvent('signup', {
                native_language: nativeLanguage,
                english_level: userLevel,
            });

            // Seed the TanStack Query caches with fresh data so the /profile
            // page renders immediately without a slow re-fetch from Appwrite.
            queryClient.setQueryData(['auth', 'status'], true);
            queryClient.setQueryData(['user', 'profile'], {
                $id: user.$id,
                email: email,
                display_name: fullName,
                join_date: user.$createdAt,
                auth_method: 'appwrite',
                shareCode,
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
