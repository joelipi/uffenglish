import React from 'react';
import Strings from '../../data/strings.js';
import { courseTagLabelParts } from '../../modules/courses/course-tag-labels.js';

// The topic filter on the course lists (`/home` and `/courses`): a drop-down
// that narrows the list to the courses of one topic.
//
// Presentational: the parent owns the selected topic and does the filtering
// (the decision lives in a pure module). The options carry the topic's
// bilingual name — the English word first, the learner's language after it,
// the same format the topic chooser uses.
export default function CourseTopicFilter({ lang = 'en', topics = [], selected = '', onSelect }) {
    if (!Array.isArray(topics) || topics.length === 0) return null;

    const optionLabel = (topic) => {
        const { english, localized } = courseTagLabelParts(topic.tag, lang);
        return localized ? `${english} · ${localized}` : english;
    };

    return (
        <div data-testid="course-topic-filter" style={{ marginBottom: '20px' }}>
            <label
                htmlFor="course-topic-filter-select"
                style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '6px', color: '#ffffff' }}
            >
                {Strings.get('courses_topic_filter', lang)}
            </label>
            <select
                id="course-topic-filter-select"
                data-testid="course-topic-select"
                value={selected}
                onChange={(e) => onSelect?.(e.target.value)}
                style={{
                    width: '100%',
                    padding: '12px 10px',
                    borderRadius: '8px',
                    border: '1px solid #2a4a6a',
                    backgroundColor: '#1a3a5a',
                    color: 'white',
                    fontSize: '16px',
                    fontFamily: 'var(--font-body)',
                }}
            >
                <option value="">{Strings.get('courses_topic_all', lang)}</option>
                {topics.map((topic) => (
                    <option key={topic.key} value={topic.key}>{optionLabel(topic)}</option>
                ))}
            </select>
        </div>
    );
}
