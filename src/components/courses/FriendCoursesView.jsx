import React, { useMemo, useState } from 'react';
import Strings from '../../data/strings.js';
import { buildCourseStartHref, buildCourseListView } from '../../modules/courses/friend-courses-logic.js';
import { courseTopicOptions, filterCoursesByTag } from '../../modules/courses/course-tags-logic.js';
import { BilingualText } from '../BilingualText.jsx';
import BilingualString from '../BilingualString.jsx';
import CourseMissionDropdown from './CourseMissionDropdown.jsx';
import CourseTopicFilter from './CourseTopicFilter.jsx';

const cardStyle = {
    backgroundColor: '#1a3a5a',
    borderRadius: '12px',
    padding: '20px',
    border: '1px solid #2a4a6a',
};

export default function FriendCoursesView({ lang = 'en', courses, isLoading = false, isError = false }) {
    const view = buildCourseListView({ courses, isLoading, isError });
    // The topic filter narrows the list in place: the selected topic lives
    // here, the filtering decision lives in the pure module.
    const [topic, setTopic] = useState('');
    const topics = useMemo(() => courseTopicOptions(view.courses), [view.courses]);
    const visibleCourses = useMemo(() => filterCoursesByTag(view.courses, topic), [view.courses, topic]);

    return (
        <div style={{ padding: '24px 16px', maxWidth: '640px', margin: '0 auto' }}>
            <h1
                data-testid="friend-courses-heading"
                style={{ fontSize: '26px', fontWeight: 800, lineHeight: 1.25, marginBottom: '16px', marginTop: 0 }}
            >
                {Strings.get('friend_courses_heading', lang)}
            </h1>

            <ol
                data-testid="friend-courses-steps"
                style={{ fontSize: '16px', lineHeight: 1.5, color: '#e9ecef', paddingLeft: '1.5rem', marginBottom: '28px', display: 'flex', flexDirection: 'column', gap: '8px' }}
            >
                <li>{Strings.get('friend_courses_step_1', lang)}</li>
                <li>{Strings.get('friend_courses_step_2', lang)}</li>
            </ol>

            {/* The topic picker: the subheading says what it is for, the
                drop-down below it narrows the list to one topic. */}
            <div
                data-testid="course-topic-heading"
                style={{ fontSize: '16px', fontWeight: 600, lineHeight: 1.5, marginBottom: '10px', color: '#e9ecef' }}
            >
                <BilingualString stringKey="courses_topic_subheading" lang={lang} />
            </div>

            <CourseTopicFilter lang={lang} topics={topics} selected={topic} onSelect={setTopic} />

            {view.state === 'loading' && (
                <div data-testid="friend-courses-loading" style={{ textAlign: 'center', padding: '32px 0' }}>
                    <div className="spinner-border" role="status" style={{ width: '3rem', height: '3rem' }}>
                        <span className="visually-hidden">Loading...</span>
                    </div>
                </div>
            )}

            {view.state === 'error' && (
                <div data-testid="friend-courses-error" style={{ color: '#ff6b6b', textAlign: 'center', padding: '24px 0' }}>
                    {Strings.get('home_courses_load_error', lang)}
                </div>
            )}

            {view.state === 'empty' && (
                <div data-testid="friend-courses-empty" style={{ color: '#adb5bd', textAlign: 'center', padding: '24px 0' }}>
                    {Strings.get('friend_courses_empty', lang)}
                </div>
            )}

            {view.state === 'ready' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {visibleCourses.map((course) => (
                        <a
                            key={course.courseId}
                            data-testid="friend-course-card"
                            href={buildCourseStartHref(course.courseId, course.firstLessonId)}
                            style={{ ...cardStyle, display: 'block', textDecoration: 'none', color: 'white' }}
                        >
                            <h2 style={{ fontSize: '20px', fontWeight: 700, margin: 0, marginBottom: '8px' }}>
                                {/* The course name is curriculum content, so it is
                                    localized: the English name first, the
                                    learner's language after it. */}
                                <span className="bilingual-label">
                                    {course.courseNames
                                        ? <BilingualText translationData={course.courseNames} userLang={lang} spanPrefix=" " />
                                        : course.courseName}
                                </span>
                            </h2>
                            {course.heroImage && (
                                <img
                                    data-testid="course-hero"
                                    src={course.heroImage}
                                    alt={course.courseName}
                                    style={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', borderRadius: '8px', marginBottom: '12px', display: 'block' }}
                                />
                            )}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#adb5bd', fontSize: '14px' }}>
                                <i className="bi bi-journal-text"></i>
                                <span>{Strings.get('friend_courses_lesson_count', lang, { count: course.lessonCount })}</span>
                            </div>
                            <CourseMissionDropdown lang={lang} mission={course.mission} />
                        </a>
                    ))}
                </div>
            )}
        </div>
    );
}
