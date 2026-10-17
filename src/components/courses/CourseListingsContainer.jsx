import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useNativeLanguage } from '../../hooks/use-native-language.js';
import { useUserProfile } from '../../modules/api/api.js';
import { loadConfigEntries, resolveCourseHeroImage } from '../../modules/courses/friend-course-configs.js';
import { listFriendCourses } from '../../modules/courses/friend-courses-logic.js';
import CourseListings from './CourseListings.jsx';

// Container for `/courses`: loads every config via the lazy Vite glob, filters
// to friend courses, and hands the list to the presentational view. Configs are
// cached for the session (`staleTime: Infinity`). Also resolves the viewer id
// so the view can show the install banner / notification prompt to signed-in
// users (guests see neither), and reports whether that profile query is still
// in flight so the view does not call an unknown viewer a guest.
export default function CourseListingsContainer() {
    const navigate = useNavigate();
    const lang = useNativeLanguage();
    const { data: profile, isLoading: isProfileResolving, isError: isProfileError } = useUserProfile();

    const { data: courses, isLoading, isError } = useQuery({
        queryKey: ['friend-courses'],
        queryFn: async () => {
            const courses = listFriendCourses(await loadConfigEntries());
            return courses.map((c) => ({ ...c, heroImage: resolveCourseHeroImage(c.heroImage) }));
        },
        staleTime: Infinity,
    });

    return (
        <CourseListings
            lang={lang}
            courses={courses}
            isLoading={isLoading}
            isError={isError}
            userId={profile?.$id}
            isResolving={isProfileResolving || isProfileError}
            onBack={() => navigate('/')}
        />
    );
}
