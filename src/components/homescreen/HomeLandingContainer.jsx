import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';
import { useAuthStatus, fetchUserByShareCode } from '../../modules/api/api.js';
import Strings from '../../data/strings.js';
import {
    GO_LESSON_PATH,
    normalizeShareCode,
    planShareCodeSubmit,
    shareCodeErrorStringKey,
} from '../../modules/user/share-code-entry-logic.js';
import { buildShowcaseVideos } from '../../modules/video/showcase-videos.js';
import HomeLanding from './HomeLanding.jsx';

// Public homepage container: owns the share-code lookup + error state and
// delegates presentation to HomeLanding. Looks the code up before navigating
// so a bad/unknown code shows an inline error instead of a broken profile.
export default function HomeLandingContainer() {
    const navigate = useNavigate();
    const { data: isLoggedIn } = useAuthStatus();
    const guestLang = useStore(appStore, (s) => s.guestNativeLanguage);
    const userLang = useStore(appStore, (s) => s.userData?.native_language);
    const lang = guestLang || userLang || 'en';
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);
    const showcaseVideos = useMemo(() => buildShowcaseVideos(), []);

    async function handleSubmit(rawCode) {
        if (loading) return;
        const code = normalizeShareCode(rawCode);
        if (!code) {
            setError(shareCodeErrorStringKey('empty'));
            return;
        }
        setLoading(true);
        try {
            const profile = await fetchUserByShareCode(code);
            const plan = planShareCodeSubmit({ rawCode: code, profile });
            if (plan.action === 'navigate') {
                setError(null);
                navigate(plan.to);
                return;
            }
            setError(shareCodeErrorStringKey(plan.reason));
        } catch {
            setError(shareCodeErrorStringKey('lookup_failed'));
        } finally {
            setLoading(false);
        }
    }

    function handleNoCode() {
        navigate(GO_LESSON_PATH);
    }

    function handleInputChange() {
        setError(null);
    }

    function handleLanguageChange(code) {
        appStore.getState().setGuestLanguageSilent(code);
    }

    return (
        <HomeLanding
            lang={lang}
            isLoggedIn={!!isLoggedIn}
            error={error ? Strings.get(error, lang) : null}
            loading={loading}
            onSubmitCode={handleSubmit}
            onNoCode={handleNoCode}
            onInputChange={handleInputChange}
            onLanguageChange={handleLanguageChange}
            showcaseVideos={showcaseVideos}
        />
    );
}
