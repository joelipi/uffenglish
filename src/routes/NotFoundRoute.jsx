// src/routes/NotFoundRoute.jsx
// The real 404 page. Rendered for the `*` catch-all (multi-segment typos) and
// by PublicProfileRoute for single-segment URLs that cannot be share codes.
// Styled to match PublicProfile's "User not found" treatment so the two read
// as one family instead of two unrelated screens.
//
// The card itself lives in `src/components/NotFoundPage.jsx`, which the lesson
// route also renders for a dead course/lesson link: that link is a 404 too,
// and one card keeps the two answers identical.
import React, { useEffect } from 'react';
import NotFoundPage from '../components/NotFoundPage.jsx';
import { useNativeLanguage } from '../hooks/use-native-language.js';
import { usePreloader } from '../hooks/usePreloader.js';

export default function NotFoundRoute() {
    const { finishPreloader } = usePreloader();
    const lang = useNativeLanguage();

    // Same contract as every other route: without this the app sits behind the
    // preloader on a page the visitor can never leave.
    useEffect(() => { finishPreloader(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    return <NotFoundPage lang={lang} />;
}
