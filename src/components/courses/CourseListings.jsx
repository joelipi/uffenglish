import React from 'react';
import Strings from '../../data/strings.js';
import { buildCourseStartHref, buildCourseListView } from '../../modules/courses/friend-courses-logic.js';

// Public course-listings page (`/courses`). Purely presentational; the
// container loads the friend courses. Uses plain `<a href>` (not `<Link>`) for
// the course cards so full-page navigation needs no Router context, matching
// the profile page's anchors.
export default function CourseListings({ lang = 'en', courses, isLoading = false, isError = false, onBack }) {
    const containerStyle = {
        minHeight: '100dvh',
        backgroundColor: '#0b1a2a',
        color: 'white',
        fontFamily: "'Inter', 'Plus Jakarta Sans', sans-serif",
        paddingBottom: '40px',
    };

    const headerStyle = {
        display: 'flex',
        alignItems: 'center',
        padding: '16px',
        borderBottom: '1px solid #1a3a5a',
        gap: '12px',
    };

    const cardStyle = {
        backgroundColor: '#1a3a5a',
        borderRadius: '12px',
        padding: '20px',
        border: '1px solid #2a4a6a',
    };

    const view = buildCourseListView({ courses, isLoading, isError });

    return (
        <div style={containerStyle}>
            <div style={headerStyle}>
                <button
                    type="button"
                    data-testid="friend-courses-back"
                    onClick={onBack}
                    style={{ background: 'none', border: 'none', color: 'white', fontSize: '20px', cursor: 'pointer' }}
                >
                    <i className="bi bi-arrow-left"></i>
                </button>
                <span style={{ fontSize: '18px', fontWeight: 600 }}>{Strings.get('home_courses', lang)}</span>
            </div>

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
                        {view.courses.map((course) => (
                            <a
                                key={course.courseId}
                                data-testid="friend-course-card"
                                href={buildCourseStartHref(course.courseId, course.firstLessonId)}
                                style={{ ...cardStyle, display: 'block', textDecoration: 'none', color: 'white' }}
                            >
                                <h2 style={{ fontSize: '20px', fontWeight: 700, margin: 0, marginBottom: '8px' }}>
                                    {course.courseName}
                                </h2>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#adb5bd', fontSize: '14px' }}>
                                    <i className="bi bi-journal-text"></i>
                                    <span>{Strings.get('friend_courses_lesson_count', lang, { count: course.lessonCount })}</span>
                                </div>
                            </a>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
