import React, { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useNativeLanguage } from '../../hooks/use-native-language.js';
import { loadConfigEntries, resolveCourseHeroImage } from '../../modules/courses/friend-course-configs.js';
import { findTagLabel, listCoursesByTag } from '../../modules/courses/course-tags-logic.js';
import TagPage from './TagPage.jsx';

// Container for `/tags/:tag`: loads every course config (the lazy Vite glob)
// and keeps the courses that carry the tag in the URL. The configs are cached
// for the session (`staleTime: Infinity`) under the `config-entries` key the
// dashboard already uses, so the two pages share one fetch.
export default function TagPageContainer() {
    const { tag } = useParams();
    const lang = useNativeLanguage();

    const { data: entries, isLoading, isError } = useQuery({
        queryKey: ['config-entries'],
        queryFn: () => loadConfigEntries(),
        staleTime: Infinity,
    });

    const courses = useMemo(
        () => listCoursesByTag(entries, tag)
            .map((course) => ({ ...course, heroImage: resolveCourseHeroImage(course.heroImage) })),
        [entries, tag],
    );

    // The heading shows the tag the way the course authored it; the URL keeps
    // the normalized form.
    const label = useMemo(() => findTagLabel(entries, tag) || tag, [entries, tag]);

    return (
        <TagPage
            lang={lang}
            tag={label}
            courses={courses}
            isLoading={isLoading}
            isError={isError}
        />
    );
}
