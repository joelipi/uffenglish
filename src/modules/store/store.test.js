import { describe, it, expect, beforeEach } from 'vitest';
import { appStore } from '../store/store.js';

describe('Zustand App Store', () => {
    beforeEach(() => {
        // Reset the store to default state before each test
        appStore.setState({
            isPWAMode: false,
            isWhisperReady: false,
            chatHistory: [],
            userFirstName: null,
            listeningScore: 100,
            speakingScore: 100,
            incorrectAttempts: 0,
            whisperRejections: 0,
            dayCount: 0,
            currentStreak: 0,
            lessonsCompleted: 0,
            lastLessonFluencyAvg: null,
            fluencyImproving: false,
            totalFluencySum: 0,
            recentFluencyAvgs: [],
            countedLessons: [],
            fluencyScore: 100,
            flowScore: 100,
            hesitationMs: 0,
            vocabularyScore: 100,
            grammarScore: 100,
            formalityScore: 100,
            nativeLikeScore: 100,
            understandingScore: 100,
            activeLessonId: null,
            currentLessonIndex: 0,
            currentStepIndex: 0,
            responsesGiven: [],
            repeatPointsHistory: [],
            rolePlayPointsHistory: [],
            userMessagesToAi: 0,
            aIMessagesToUser: 0,
            userMessagesToAiWordCount: 0,
            aIMessagesToUserWordCount: 0,
        });
    });

    it('should correctly set progress', () => {
        appStore.getState().setProgress({ lessonId: 'lesson_1', lessonIndex: 1, questionIndex: 2 });
        const state = appStore.getState();
        expect(state.activeLessonId).toBe('lesson_1');
        expect(state.currentLessonIndex).toBe(1);
        expect(state.currentStepIndex).toBe(2);
    });

    it('should deduct listening and speaking scores without going below 0', () => {
        appStore.getState().deductListeningScore(30);
        expect(appStore.getState().listeningScore).toBe(70);

        appStore.getState().deductListeningScore(80); // Should floor at 0
        expect(appStore.getState().listeningScore).toBe(0);

        appStore.getState().deductSpeakingScore(10);
        expect(appStore.getState().speakingScore).toBe(90);

        appStore.getState().deductSpeakingScore(100); // Should floor at 0
        expect(appStore.getState().speakingScore).toBe(0);
    });

    it('should handle undefined values when deducting points', () => {
        appStore.getState().deductListeningScore(undefined);
        expect(appStore.getState().listeningScore).toBe(100);

        appStore.getState().deductSpeakingScore(NaN);
        expect(appStore.getState().speakingScore).toBe(100);
    });

    it('should increment incorrect attempts and rejections', () => {
        appStore.getState().incrementIncorrectAttempts();
        expect(appStore.getState().incorrectAttempts).toBe(1);

        appStore.getState().incrementIncorrectAttempts();
        expect(appStore.getState().incorrectAttempts).toBe(2);

        appStore.getState().incrementWhisperRejections();
        expect(appStore.getState().whisperRejections).toBe(1);
    });

    it('should reset per-step metrics correctly', () => {
        appStore.setState({
            listeningScore: 50,
            speakingScore: 40,
            incorrectAttempts: 2,
            whisperRejections: 1
        });

        appStore.getState().resetForNextStep();

        const state = appStore.getState();
        expect(state.listeningScore).toBe(100);
        expect(state.speakingScore).toBe(100);
        expect(state.incorrectAttempts).toBe(0);
        expect(state.whisperRejections).toBe(0);
    });

    it('should set fluency metrics partially', () => {
        appStore.getState().setFluencyMetrics({
            fluencyScore: 85,
            grammarScore: 90
        });

        const state = appStore.getState();
        expect(state.fluencyScore).toBe(85);
        expect(state.grammarScore).toBe(90);
        expect(state.flowScore).toBe(100); // Unchanged
    });

    it('should set session flags', () => {
        appStore.getState().setPWAMode(true);
        expect(appStore.getState().isPWAMode).toBe(true);

        appStore.getState().setWhisperReady(true);
        expect(appStore.getState().isWhisperReady).toBe(true);

        appStore.getState().setUserFirstName('Jules');
        expect(appStore.getState().userFirstName).toBe('Jules');
    });

    it('should reset lesson history', () => {
        appStore.setState({
            responsesGiven: ['response1'],
            repeatPointsHistory: [100],
            rolePlayPointsHistory: [80]
        });

        appStore.getState().resetLessonHistory();
        const state = appStore.getState();
        expect(state.responsesGiven).toEqual([]);
        expect(state.repeatPointsHistory).toEqual([]);
        expect(state.rolePlayPointsHistory).toEqual([]);
    });

    it('should handle setting specific scores', () => {
        appStore.getState().setListeningScore(80);
        expect(appStore.getState().listeningScore).toBe(80);

        appStore.getState().setListeningScore(-10);
        expect(appStore.getState().listeningScore).toBe(0);

        appStore.getState().deductFlowScore(20);
        expect(appStore.getState().flowScore).toBe(80);

        appStore.getState().setHesitationMs(150);
        expect(appStore.getState().hesitationMs).toBe(150);

        appStore.getState().setSpeakingScore(70);
        expect(appStore.getState().speakingScore).toBe(70);
    });

    it('should handle gamification updates correctly', () => {
        appStore.getState().setActivityMetrics(5, 3);
        expect(appStore.getState().dayCount).toBe(5);
        expect(appStore.getState().currentStreak).toBe(3);

        appStore.getState().setLessonsCompleted(10);
        expect(appStore.getState().lessonsCompleted).toBe(10);

        appStore.getState().setLastLessonFluencyAvg(95);
        expect(appStore.getState().lastLessonFluencyAvg).toBe(95);

        appStore.getState().setFluencyImproving(true);
        expect(appStore.getState().fluencyImproving).toBe(true);

        appStore.getState().setTotalFluencySum(500);
        expect(appStore.getState().totalFluencySum).toBe(500);

        appStore.getState().setRecentFluencyAvgs([90, 95]);
        expect(appStore.getState().recentFluencyAvgs).toEqual([90, 95]);

        appStore.getState().setCountedLessons(['lesson1']);
        expect(appStore.getState().countedLessons).toEqual(['lesson1']);
    });

    it('should reset for new lesson', () => {
        appStore.setState({
            listeningScore: 50,
            speakingScore: 40,
            incorrectAttempts: 2,
            whisperRejections: 1
        });

        appStore.getState().resetForNewLesson();
        const state = appStore.getState();
        expect(state.listeningScore).toBe(100);
        expect(state.speakingScore).toBe(100);
        expect(state.incorrectAttempts).toBe(0);
        expect(state.whisperRejections).toBe(0);
    });

    it('should track tutor engagement metrics', () => {
        appStore.getState().incrementUserTutorStats(10);
        expect(appStore.getState().userMessagesToAi).toBe(1);
        expect(appStore.getState().userMessagesToAiWordCount).toBe(10);

        appStore.getState().incrementAiTutorStats(5);
        expect(appStore.getState().aIMessagesToUser).toBe(1);
        expect(appStore.getState().aIMessagesToUserWordCount).toBe(5);
    });

    it('should manage chat history correctly', () => {
        // Initial state
        expect(appStore.getState().chatHistory).toEqual([]);

        // Add standard message
        const msg1 = { role: 'user', content: 'Hello tutor' };
        appStore.getState().addChatMessage(msg1);
        let history = appStore.getState().chatHistory;
        expect(history.length).toBe(1);
        expect(history[0].role).toBe('user');
        expect(history[0].content).toBe('Hello tutor');
        expect(history[0].type).toBe('standard');
        expect(typeof history[0].id).toBe('number');

        // Add custom message with id and type
        const msg2 = { id: 12345, role: 'system', type: 'grammarDiff', content: 'Correction' };
        appStore.getState().addChatMessage(msg2);
        history = appStore.getState().chatHistory;
        expect(history.length).toBe(2);
        expect(history[1].id).toBe(12345);
        expect(history[1].type).toBe('grammarDiff');
    });

    describe('transitionTo', () => {
        beforeEach(() => {
            appStore.setState({ appPhase: 'loading', phaseData: {}, currentVideo: null });
        });

        it('sets showMission according to phase mapping', () => {
            appStore.getState().transitionTo('lessonIntro');
            expect(appStore.getState().showMission).toBe(true);
            appStore.getState().transitionTo('feedback');
            expect(appStore.getState().showMission).toBe(false);
        });

        it('sets zone states correctly for feedback phase', () => {
            appStore.getState().transitionTo('feedback');
            expect(appStore.getState().topState).toBe('topBarOnly');
            expect(appStore.getState().mediaState).toBe('chat');
            expect(appStore.getState().bottomState).toBe('continueButton');
        });

        it('sets zone states correctly for lessonIntro phase', () => {
            appStore.getState().transitionTo('lessonIntro');
            expect(appStore.getState().topState).toBe('topBarOnly');
            expect(appStore.getState().mediaState).toBe('introCallWidget');
            expect(appStore.getState().bottomState).toBe('introChoices');
        });

        it('resolves conditional topState based on currentVideo', () => {
            appStore.setState({ currentVideo: { type: 'interactive' } });
            appStore.getState().transitionTo('recording/answering');
            expect(appStore.getState().topState).toBe('topBarWithStats');

            appStore.setState({ currentVideo: { type: 'simple' } });
            appStore.getState().transitionTo('recording/answering');
            expect(appStore.getState().topState).toBe('topBarOnly');
        });

        it('stores phaseData', () => {
            appStore.getState().transitionTo('review', { transcript: 'hello' });
            expect(appStore.getState().phaseData).toEqual({ transcript: 'hello' });
        });

        it('warns on unexpected answer-flow transitions', () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            appStore.getState().transitionTo('recording/answering', {}, { fromStepLoad: true });
            appStore.getState().transitionTo('lessonIntro');
            expect(warn).toHaveBeenCalled();
            warn.mockRestore();
        });

        it('skips validation with fromStepLoad flag', () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            appStore.getState().transitionTo('lessonIntro', {}, { fromStepLoad: true });
            expect(warn).not.toHaveBeenCalled();
            warn.mockRestore();
        });

        it('sets whisperReviewData on review phase', () => {
            appStore.getState().transitionTo('review', { transcript: 'hello', timeLeft: 5 });
            expect(appStore.getState().whisperReviewData).toEqual({ transcript: 'hello', timeLeft: 5 });
            expect(appStore.getState().whisperReviewTimeLeft).toBe(5);
        });

        it('falls back to error mapping for unknown phases', () => {
            appStore.getState().transitionTo('unknown_phase');
            expect(appStore.getState().topState).toBe('hidden');
            expect(appStore.getState().mediaState).toBe('errorModal');
            expect(appStore.getState().bottomState).toBe('hidden');
        });
    });
});
