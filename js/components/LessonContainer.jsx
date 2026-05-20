// components/LessonContainer.jsx

import React, { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { appStore } from '../modules/store.js';

export default function LessonContainer() {
    const { courseId, lessonId } = useParams();

    useEffect(() => {
        if (courseId && lessonId) {
            console.log(`[Router] Route matched. Course: ${courseId}, Lesson: ${lessonId}`);

            // 1. Save the route parameters to Zustand so Vanilla JS can read them
            appStore.getState().setCourseData({ courseId });
            appStore.setState({ activeLessonId: lessonId });

            // 2. Fire a custom event to tell app.js to boot or reboot the lesson
            window.dispatchEvent(new CustomEvent('hybridRouteChange', {
                detail: { courseId, lessonId }
            }));
        }
    }, [courseId, lessonId]);

    // For now, it just returns an empty fragment. 
    // The Vanilla JS DOM elements (video players, etc.) are still hardcoded in index.html.
    return <></>;
}