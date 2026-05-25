import React from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';

export default function LessonTitle() {
    const lessonTitle = useStore(appStore, (state) => state.lessonTitle);

    if (!lessonTitle) return null;

    return <span className="lesson-title">{lessonTitle}</span>;
}
