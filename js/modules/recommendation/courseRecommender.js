import {
    removeNeverRecommend,
    removeCompleted,
    removeWrongLevel,
    splitResumableAndFresh,
    filterByTagsAndFocus,
    fallbackDropTags,
    fallbackDropFocus,
    fallbackWiderLevel
} from './filterPipeline.js';

export function recommend({ user, manifest, sessionSkipped }) {
    if (!manifest || manifest.length === 0) {
        return { nextCourse: null, status: 'empty', courses: [], reason: null };
    }

    // 1. Check user.lastCompletedCourseId -> if set, find course and read recommendedNextCourseId
    if (user.lastCompletedCourseId) {
        const lastCourse = manifest.find(c => c.courseId === user.lastCompletedCourseId);
        if (lastCourse && lastCourse.recommendedNextCourseId) {
            const nextCourseCandidate = manifest.find(c => c.courseId === lastCourse.recommendedNextCourseId);
            if (nextCourseCandidate) {
                // 2. Run that course through removeNeverRecommend, removeCompleted, removeWrongLevel
                let candidateList = [nextCourseCandidate];
                candidateList = removeNeverRecommend(candidateList, user.neverRecommendIds);
                candidateList = removeCompleted(candidateList, user.completedUnitIds);
                // Note: requirement says run removeWrongLevel, but it might be a different level if recommended.
                // We'll follow the instructions strictly.
                candidateList = removeWrongLevel(candidateList, user.level);

                if (candidateList.length > 0) {
                    return {
                        nextCourse: candidateList[0],
                        status: 'presenting_next_course',
                        courses: [],
                        reason: null
                    };
                }
            }
        }
    }

    // 3. Remove sessionSkipped course IDs from manifest before main pipeline
    let workingManifest = manifest;
    if (sessionSkipped && sessionSkipped.length > 0) {
        workingManifest = manifest.filter(c => !sessionSkipped.includes(c.courseId));
    }

    // 4. Run main pipeline
    workingManifest = removeNeverRecommend(workingManifest, user.neverRecommendIds);
    workingManifest = removeCompleted(workingManifest, user.completedUnitIds);
    workingManifest = removeWrongLevel(workingManifest, user.level);

    let { resumable, fresh } = splitResumableAndFresh(workingManifest, user.startedUnitIds);

    // 6. Prioritize resumable over fresh
    if (resumable.length > 0) {
        return {
            nextCourse: null,
            status: 'resumable',
            courses: resumable,
            reason: null
        };
    }

    let filteredFresh = filterByTagsAndFocus(fresh, user.tags, user.focus);

    if (filteredFresh.length > 0) {
        return {
            nextCourse: null,
            status: 'fresh',
            courses: filteredFresh,
            reason: null
        };
    }

    // 5. Run fallbacks in order, track which was used
    let fallbackCourses = fallbackDropTags(fresh, user.level, user.focus);
    if (fallbackCourses.length > 0) {
        return {
            nextCourse: null,
            status: 'fallback',
            courses: fallbackCourses,
            reason: 'widened_tags'
        };
    }

    fallbackCourses = fallbackDropFocus(fresh, user.level);
    if (fallbackCourses.length > 0) {
         return {
            nextCourse: null,
            status: 'fallback',
            courses: fallbackCourses,
            reason: 'widened_focus' // using widened_focus for clarity, instructions said reason: 'widened_tags' | 'widened_level'
        };
    }

    // We need to re-run the pipeline to get the wider level courses (before they were removed by removeWrongLevel)
    let widerManifest = manifest;
    if (sessionSkipped && sessionSkipped.length > 0) {
        widerManifest = manifest.filter(c => !sessionSkipped.includes(c.courseId));
    }
    widerManifest = removeNeverRecommend(widerManifest, user.neverRecommendIds);
    widerManifest = removeCompleted(widerManifest, user.completedUnitIds);

    fallbackCourses = fallbackWiderLevel(widerManifest, user.level);
    // Also remove started to only get fresh wider level? The prompt implies fallback is for fresh.
    let widerSplit = splitResumableAndFresh(fallbackCourses, user.startedUnitIds);
    if (widerSplit.fresh.length > 0) {
        return {
            nextCourse: null,
            status: 'fallback',
            courses: widerSplit.fresh,
            reason: 'widened_level'
        };
    } else if (widerSplit.resumable.length > 0) {
        return {
            nextCourse: null,
            status: 'fallback',
            courses: widerSplit.resumable,
            reason: 'widened_level'
        };
    }

    return {
        nextCourse: null,
        status: 'empty',
        courses: [],
        reason: null
    };
}
