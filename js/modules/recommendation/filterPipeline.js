export function removeNeverRecommend(courses, neverRecommendIds) {
    if (!courses) return [];
    if (!neverRecommendIds || neverRecommendIds.length === 0) return courses;
    return courses.filter(course => !neverRecommendIds.includes(course.courseId));
}

export function removeCompleted(courses, completedUnitIds) {
    if (!courses) return [];
    if (!completedUnitIds || completedUnitIds.length === 0) return courses;
    return courses.filter(course => !completedUnitIds.includes(course.courseId));
}

export function removeWrongLevel(courses, userLevel) {
    if (!courses) return [];
    if (!userLevel) return courses;
    return courses.filter(course => course.languageLevel === userLevel);
}

export function splitResumableAndFresh(courses, startedUnitIds) {
    if (!courses) return { resumable: [], fresh: [] };
    const resumable = [];
    const fresh = [];

    courses.forEach(course => {
        if (startedUnitIds && startedUnitIds.includes(course.courseId)) {
            resumable.push(course);
        } else {
            fresh.push(course);
        }
    });

    return { resumable, fresh };
}

export function filterByTagsAndFocus(courses, tags, focus) {
    if (!courses) return [];
    if (!tags && !focus) return courses;

    return courses.filter(course => {
        const hasMatchingTag = tags && tags.length > 0 && course.tags ? tags.some(tag => course.tags.includes(tag)) : true;
        const hasMatchingFocus = focus && course.focus ? course.focus.includes(focus) : true;
        return hasMatchingTag && hasMatchingFocus;
    });
}

export function fallbackDropTags(courses, userLevel, focus) {
    if (!courses) return [];
    return courses.filter(course => course.languageLevel === userLevel && (focus && course.focus ? course.focus.includes(focus) : true));
}

export function fallbackDropFocus(courses, userLevel) {
    if (!courses) return [];
    return courses.filter(course => course.languageLevel === userLevel);
}

export function fallbackWiderLevel(courses, userLevel) {
    if (!courses) return [];
    const levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    const currentIdx = levels.indexOf(userLevel);
    if (currentIdx === -1 || currentIdx === levels.length - 1) return courses; // Unknown or highest level

    const nextLevel = levels[currentIdx + 1];
    return courses.filter(course => course.languageLevel === nextLevel);
}
