import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNativeLanguage } from '../../hooks/use-native-language.js';
import { loadConfigEntries } from '../../modules/courses/friend-course-configs.js';
import { collectCourseTags } from '../../modules/courses/course-tags-logic.js';
import WelcomePage from './WelcomePage.jsx';

// Container for `/welcome`: loads every course config (the lazy Vite glob),
// collects the tags those courses carry, and hands the list to the
// presentational view. The configs are cached for the session
// (`staleTime: Infinity`), and the `config-entries` key is the one the
// dashboard already uses, so the two pages share one fetch.
export default function WelcomePageContainer() {
    const lang = useNativeLanguage();

    const { data: entries, isLoading, isError } = useQuery({
        queryKey: ['config-entries'],
        queryFn: () => loadConfigEntries(),
        staleTime: Infinity,
    });

    const tags = useMemo(() => collectCourseTags(entries), [entries]);

    return (
        <WelcomePage
            lang={lang}
            tags={tags}
            isLoading={isLoading}
            isError={isError}
        />
    );
}
