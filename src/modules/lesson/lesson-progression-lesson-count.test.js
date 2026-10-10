import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setProgressionDeps, loadNextLesson } from './lesson-progression.js';
import { appStore } from '../store/store.js';

const saveLessonProgress = vi.fn(async () => ({ newDayCount: 0, newStreak: 0, lessonsCompleted: 0 }));

// The real deps hit Supabase; these stubs only prove what loadNextLesson asks
// saveLessonProgress to persist.
setProgressionDeps({
    addAILoadingMessage: vi.fn(),
    getChatHistoryContext: vi.fn(),
    askEnglishTutor: vi.fn(),
    saveLessonProgress,
    playSound: vi.fn(),
});

describe('loadNextLesson does not double-count a completed lesson', () => {
    beforeEach(() => {
        saveLessonProgress.mockClear();
        appStore.setState({
            configData: { lessons: [{ lessonId: 'm-g', nextLessonId: 'm-a', steps: [{ step: 's' }] }] },
            currentLessonIndex: 0,
            currentStepIndex: 0,
            userData: { $id: 'user-1' },
            completionMessage: null,
            pendingLessonNavigation: null,
        });
    });

    it('never asks for the completion increment (handleSuccessStep owns the count)', async () => {
        await loadNextLesson({ callLoadStep: vi.fn(), loadLessonContent: vi.fn() });

        expect(saveLessonProgress).toHaveBeenCalledTimes(1);
        const [, resumeLessonId, , options] = saveLessonProgress.mock.calls[0];
        // Advancing still persists the resume target...
        expect(resumeLessonId).toBe('m-a');
        // ...but must not request an increment or mark a completed lesson.
        expect(options?.incrementCount).toBeUndefined();
        expect(options?.completedLessonId).toBeUndefined();
    });
});
