import React from 'react';
import { Link } from 'react-router-dom';
import Strings from '../../data/strings.js';
import { buildCourseStartHref, buildCourseListView } from '../../modules/courses/friend-courses-logic.js';
import { WELCOME_PATH } from '../../modules/courses/course-tags-logic.js';
import CourseMissionDropdown from './CourseMissionDropdown.jsx';

const cardStyle = {
    backgroundColor: '#1a3a5a',
    borderRadius: '12px',
    padding: '20px',
    border: '1px solid #2a4a6a',
};

// The tag page (`/tags/<tag>`): the courses that carry the tag, each linking
// to the course exactly like the course listings page does.
//
// Presentational only: the container loads the configs and filters them by the
// tag in the URL. The mission block is EXPANDED here (the course listing page
// collapses it behind a toggle) so the whole mission reads at a glance.
export default function TagPage({ lang = 'en', tag = '', courses, isLoading = false, isError = false }) {
    const view = buildCourseListView({ courses, isLoading, isError });

    const containerStyle = {
        // The app shell (src/routes/AppShellLayout.jsx) owns the frame height
        // and the shared header, so the page is a flex child of the region
        // below the header — it must not claim a height of its own.
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backgroundColor: '#0b1a2a',
        color: 'white',
        fontFamily: 'var(--font-body)',
    };

    const headerStyle = {
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        padding: '16px',
        borderBottom: '1px solid #1a3a5a',
        gap: '12px',
    };

    const scrollStyle = {
        flex: 1,
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        paddingBottom: '40px',
    };

    return (
        <div style={containerStyle} data-testid="tag-page">
            <div style={headerStyle}>
                <Link
                    to={WELCOME_PATH}
                    data-testid="tag-back"
                    aria-label={Strings.get('tag_back', lang)}
                    style={{ background: 'none', color: 'white', fontSize: '20px', cursor: 'pointer', lineHeight: 1 }}
                >
                    <i className="bi bi-arrow-left"></i>
                </Link>
                <h1 data-testid="tag-heading" style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>
                    {tag}
                </h1>
            </div>

            <div data-testid="tag-scroll" style={scrollStyle}>
                {view.state === 'loading' && (
                    <div data-testid="tag-loading" style={{ textAlign: 'center', padding: '32px 0' }}>
                        <div className="spinner-border" role="status" style={{ width: '3rem', height: '3rem' }}>
                            <span className="visually-hidden">Loading...</span>
                        </div>
                    </div>
                )}

                {view.state === 'error' && (
                    <div data-testid="tag-error" style={{ color: '#ff6b6b', textAlign: 'center', padding: '24px 0' }}>
                        {Strings.get('home_courses_load_error', lang)}
                    </div>
                )}

                {view.state === 'empty' && (
                    <div data-testid="tag-empty" style={{ color: '#adb5bd', textAlign: 'center', padding: '24px 0' }}>
                        {Strings.get('tag_courses_empty', lang)}
                    </div>
                )}

                {view.state === 'ready' && (
                    <div style={{ padding: '24px 16px', maxWidth: '640px', margin: '0 auto' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {view.courses.map((course) => (
                                <a
                                    key={course.courseId}
                                    data-testid="tag-course-card"
                                    href={buildCourseStartHref(course.courseId, course.firstLessonId)}
                                    style={{ ...cardStyle, display: 'block', textDecoration: 'none', color: 'white' }}
                                >
                                    <h2 style={{ fontSize: '20px', fontWeight: 700, margin: 0, marginBottom: '8px' }}>
                                        {course.courseName}
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
                                    {/* Expanded: the whole mission reads at a glance on a topic page. */}
                                    <CourseMissionDropdown lang={lang} mission={course.mission} defaultExpanded />
                                </a>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
