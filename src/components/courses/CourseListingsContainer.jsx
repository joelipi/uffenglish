import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useNativeLanguage } from '../../hooks/use-native-language.js';
import { loadConfigEntries } from '../../modules/courses/friend-course-configs.js';
import { listFriendCourses } from '../../modules/courses/friend-courses-logic.js';
import CourseListings from './CourseListings.jsx';

// Container for `/courses`: loads every config via the lazy Vite glob, filters
// to friend courses, and hands the list to the presentational view. Configs are
// cached for the session (`staleTime: Infinity`).
export default function CourseListingsContainer() {
    const navigate = useNavigate();
    const lang = useNativeLanguage();

    const { data: courses, isLoading, isError } = useQuery({
        queryKey: ['friend-courses'],
        queryFn: async () => listFriendCourses(await loadConfigEntries()),
        staleTime: Infinity,
    });

    return (
        <CourseListings
            lang={lang}
            courses={courses}
            isLoading={isLoading}
            isError={isError}
            onBack={() => navigate('/')}
        />
    );
}
