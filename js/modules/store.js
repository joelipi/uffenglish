// --- modules/store.js ---
// Zustand vanilla store for reactive UI metrics.
// This store holds the values that drive persistent on-screen indicators and session states.
// All other application state (lesson data, config, player refs, flags) remains in state.js.

import { createStore } from 'zustand';
import { persist } from 'zustand/middleware';

export const appStore = createStore(
    persist(
        (set, get) => ({
            // --- Session Flags (Not Persisted) ---
            isDemoMode: false,
            isWhisperReady: false,
            isMicActive: false,
            isTextMode: false,
            isPlaybackMuted: false,
            isCameraOff: false,
            isGuestModalOpen: false,
            isLoggedIn: false,
            criticalErrorMessage: null,
            answerErrorMessage: null,
            userFirstName: null,
            userData: null,
            configData: null,
            courseId: null,
            englishLevel: 'A0',
            currentVideo: null,
            currentVideoPlayer: null,
            introContinueCallback: null,
            introAudioOnlyCallback: null,
onMicClickCallback: null,
            loadLessonContentCallback: null,

// --- Session-scoped State (not persisted, reset per lesson) ---
            isAudioEnabled: false,
            chatHistory: [],
            interactionLog: [],
            recognizedIdioms: [],
            pragmaticFlags: [],
            totalHesitations: 0,
            totalPauses: null,
            averageWpm: null,
            mission: null,
            setting: null,
            roleOther: null,
            roleUser: null,
            userRole: null,
            videoRole: null,
            stepCount: 0,
            stepsAnswered: 0,
            wordsRevealed: 0,
            videoPlays: 0,
            videoClicks: 0,
            lessonStartTime: null,

            // --- Input UI State (Replaces renderSpeechInputUI/renderTextInputUI) ---
            textInputVisible: false,
            textInputPlaceholder: '',
            textInputSubmitCallback: null,
            speechInputContent: null,
            speechCue: null,
            speechPossibleAnswer: null,
            speechInputHintCallback: null,
            speechInputRevealCallback: null,
            speechInputToggleCallback: null,
            tutorChatVisible: false,
            tutorChatSubmitCallback: null,
            webcamStream: null,
            mediaVisible: false,
            micBounceTrigger: 0,

            // --- Whisper Review Overlay ---
            whisperReviewData: null,
            whisperReviewTimeLeft: null,
            successVideoBlob: null,

            // --- Success Screen State ---
            successScreenVisible: false,
            successLessonId: null,
            successFluencyData: null,
            successContinueButton: { visible: false, loading: false },
            successVideoButton: { visible: false, loading: false, state: 'idle' },
            successRepeatButton: { visible: false },
            successCanvasVisible: false,
            pointLossAmount: null,

            // --- Media Viewport Dynamic Content ---
            praiseImageUrl: null,
            youtubeVideoId: null,
            mediaClearTrigger: 0,

            // --- Playback Video State ---
            playbackBlob: null,
            playbackAutoplay: false,
            playbackSpeechCamChunks: [],

            // --- Tutor Engagement Metrics ---
            userMessagesToAi: 0,
            aIMessagesToUser: 0,
            userMessagesToAiWordCount: 0,
            aIMessagesToUserWordCount: 0,

            // --- Actions ---

            // Set Session Flags
            setDemoMode: (val) => set({ isDemoMode: val }),
            setWhisperReady: (val) => set({ isWhisperReady: val }),
            setMicActive: (val) => set({ isMicActive: val }),
            setTextMode: (val) => set({ isTextMode: val }),
            setPlaybackMuted: (val) => set({ isPlaybackMuted: val }),
            setCameraOff: (val) => set({ isCameraOff: val }),
            setGuestModalOpen: (val) => set({ isGuestModalOpen: val }),
            setIsLoggedIn: (val) => set({ isLoggedIn: val }),
            triggerMicBounce: () => set((state) => ({ micBounceTrigger: state.micBounceTrigger + 1 })),
            setCriticalErrorMessage: (val) => set({ criticalErrorMessage: val }),
            setAnswerErrorMessage: (val) => set({ answerErrorMessage: val }),
            setCurrentVideoPlayer: (val) => set({ currentVideoPlayer: val }),
            setIntroContinueCallback: (val) => set({ introContinueCallback: val }),
            setIntroAudioOnlyCallback: (val) => set({ introAudioOnlyCallback: val }),
            setOnMicClickCallback: (val) => set({ onMicClickCallback: val }),
            setLoadLessonContentCallback: (val) => set({ loadLessonContentCallback: val }),
            setLessonTitle: (val) => set({ lessonTitle: val }),
            setIsLessonActive: (val) => set({ isLessonActive: val }),

            setAudioEnabled: (val) => set({ isAudioEnabled: val }),
            setInteractionLog: (val) => set({ interactionLog: val }),
            clearInteractionLog: () => set({ interactionLog: [] }),
            addRecognizedIdiom: (val) => set((s) => ({ recognizedIdioms: [...s.recognizedIdioms, val] })),
            clearRecognizedIdioms: () => set({ recognizedIdioms: [] }),
            addPragmaticFlag: (val) => set((s) => ({ pragmaticFlags: [...s.pragmaticFlags, val] })),
            clearPragmaticFlags: () => set({ pragmaticFlags: [] }),
            setTotalHesitations: (val) => set({ totalHesitations: val }),
            setTotalPauses: (val) => set({ totalPauses: val }),
            setAverageWpm: (val) => set({ averageWpm: val }),
            setMission: (val) => set({ mission: val }),
            setSetting: (val) => set({ setting: val }),
            setRoleOther: (val) => set({ roleOther: val }),
            setRoleUser: (val) => set({ roleUser: val }),
            setUserRole: (val) => set({ userRole: val }),
            setVideoRole: (val) => set({ videoRole: val }),
            setStepCount: (val) => set({ stepCount: val }),
            incrementStepCount: () => set((s) => ({ stepCount: s.stepCount + 1 })),
            setStepsAnswered: (val) => set({ stepsAnswered: val }),
            incrementStepsAnswered: () => set((s) => ({ stepsAnswered: s.stepsAnswered + 1 })),
            setWordsRevealed: (val) => set({ wordsRevealed: val }),
            incrementWordsRevealed: () => set((s) => ({ wordsRevealed: s.wordsRevealed + 1 })),
            setVideoPlays: (val) => set({ videoPlays: val }),
            incrementVideoPlays: () => set((s) => ({ videoPlays: s.videoPlays + 1 })),
            setVideoClicks: (val) => set({ videoClicks: val }),
            incrementVideoClicks: () => set((s) => ({ videoClicks: s.videoClicks + 1 })),
            setLessonStartTime: (val) => set({ lessonStartTime: val }),

            resetLessonState: () => set({
                interactionLog: [],
                recognizedIdioms: [],
                pragmaticFlags: [],
                totalHesitations: 0,
                totalPauses: null,
                averageWpm: null,
                roleOther: null,
                roleUser: null,
                userRole: null,
                videoRole: null,
                stepCount: 0,
                stepsAnswered: 0,
                wordsRevealed: 0,
                videoPlays: 0,
                videoClicks: 0,
                lessonStartTime: null,
            }),

            resetStepState: () => set({
                wordsRevealed: 0,
                videoPlays: 0,
                videoClicks: 0,
            }),

            addChatMessage: (msg) => set((state) => {
                const newMsg = {
                    id: msg.id !== undefined ? msg.id : Date.now() + Math.random(),
                    role: msg.role,
                    type: msg.type || 'standard',
                    content: msg.content,
                    ...msg
                };
                return { chatHistory: [...state.chatHistory, newMsg] };
            }),
            clearChatHistory: () => set({ chatHistory: [] }),
            removeAiLoadingMessage: () => set((state) => ({
                chatHistory: state.chatHistory.filter(msg => msg.type !== 'aiLoading')
            })),
            removeContinueWidget: () => set((state) => ({
                chatHistory: state.chatHistory.filter(msg => msg.type !== 'continueWidget')
            })),
            replaceLastMessage: (msg) => set((state) => {
                if (state.chatHistory.length === 0) {
                    const newMsg = {
                        id: msg.id !== undefined ? msg.id : Date.now() + Math.random(),
                        role: msg.role,
                        type: msg.type || 'standard',
                        content: msg.content,
                        ...msg
                    };
                    return { chatHistory: [newMsg] };
                }
                const newHistory = [...state.chatHistory];
                const lastMsg = newHistory[newHistory.length - 1];
                newHistory[newHistory.length - 1] = {
                    ...lastMsg,
                    ...msg
                };
                return { chatHistory: newHistory };
            }),
            setUserFirstName: (val) => set({ userFirstName: val }),
            setCourseData: (data) => set((state) => ({
                userData: data.userData !== undefined ? data.userData : state.userData,
                configData: data.configData !== undefined ? data.configData : state.configData,
                courseId: data.courseId !== undefined ? data.courseId : state.courseId,
                englishLevel: data.englishLevel !== undefined ? data.englishLevel : state.englishLevel,
            })),

            setCurrentVideo: (video) => {
                console.log(`[Store] setCurrentVideo: ${video ? video.type : 'null'}`);
                set({ currentVideo: video });
            },

            // --- Preloader Actions ---
            setPreloaderProgress: (val) => set({ preloaderProgress: val }),
            setPreloaderVisible: (val) => set({ preloaderVisible: val }),

            // --- UI State Actions ---
            setProgressPercent: (percent) => set({ progressPercent: percent }),
            setStatsVisible: (visible) => set({ statsVisible: visible }),
            setMicStatusText: (text) => set({ micStatusText: text }),
            setIsLoaded: (loaded) => set({ isLoaded: loaded }),
            setHintsVisible: (visible) => set({ hintsVisible: visible }),
            setHangmanHintHTML: (html) => set({ hangmanHintHTML: html }),
            setHangmanOps: (ops) => set({ hangmanOps: ops }),
            setBottomControlState: (state) => set({ bottomControlState: state }),
            setChatModeActive: (val) => set({ chatModeActive: val }),
            setChatHeaderMode: (mode) => set({ chatHeaderMode: mode }),
            setSubmitBtnDisabled: (val) => set({ submitBtnDisabled: val }),
            setSubmitBtnIcon: (icon) => set({ submitBtnIcon: icon }),
            setSubmitBtnDanger: (val) => set({ submitBtnDanger: val }),
            setInputDisabled: (val) => set({ inputDisabled: val }),
            triggerInputFocus: () => set((state) => ({ inputFocusTrigger: state.inputFocusTrigger + 1 })),
            triggerPointLoss: (target, points) => set((state) => ({ pointLossTrigger: state.pointLossTrigger + 1, pointLossData: { target, points } })),
            clearPointLoss: () => set({ pointLossData: null }),
            triggerVideoPlay: (muted) => set((state) => ({ videoPlayTrigger: state.videoPlayTrigger + 1, videoPlayMuted: muted })),
            triggerVideoClear: () => set((state) => ({ videoClearTrigger: state.videoClearTrigger + 1 })),
            triggerPreflightRejected: () => set((state) => ({ preflightRejectedTrigger: state.preflightRejectedTrigger + 1 })),
            triggerTranscriptRejected: (cue, transcript) => set((state) => ({ transcriptRejectedTrigger: state.transcriptRejectedTrigger + 1, transcriptRejectedCue: cue, transcriptRejectedTranscript: transcript })),
            triggerScoreUpdate: () => set((state) => ({ scoreUpdateTrigger: state.scoreUpdateTrigger + 1 })),
            setPlaybackBlob: (blob, autoplay = false, speechCamChunks = []) => set({ playbackBlob: blob, playbackAutoplay: autoplay, playbackSpeechCamChunks: speechCamChunks }),
            clearPlaybackBlob: () => set({ playbackBlob: null, playbackAutoplay: false, playbackSpeechCamChunks: [] }),
            setCompletionMessage: (msg) => set({ completionMessage: msg }),
            clearCompletionMessage: () => set({ completionMessage: null }),

            // Update physical place in the lesson
            setProgress: ({ lessonId, lessonIndex, questionIndex }) => set({
                activeLessonId: lessonId,
                currentLessonIndex: lessonIndex,
                currentStepIndex: questionIndex
            }),

            // Clear history arrays when a new lesson begins
            resetLessonHistory: () => set({
                responsesGiven: [],
                repeatPointsHistory: [],
                rolePlayPointsHistory: []
            }),

            // Update fluency metrics securely by filtering only expected keys
            setFluencyMetrics: (metrics) => set((state) => ({
                fluencyScore: metrics.fluencyScore !== undefined ? metrics.fluencyScore : state.fluencyScore,
                flowScore: metrics.flowScore !== undefined ? metrics.flowScore : state.flowScore,
                vocabularyScore: metrics.vocabularyScore !== undefined ? metrics.vocabularyScore : state.vocabularyScore,
                grammarScore: metrics.grammarScore !== undefined ? metrics.grammarScore : state.grammarScore,
                formalityScore: metrics.formalityScore !== undefined ? metrics.formalityScore : state.formalityScore,
                nativeLikeScore: metrics.nativeLikeScore !== undefined ? metrics.nativeLikeScore : state.nativeLikeScore,
                understandingScore: metrics.understandingScore !== undefined ? metrics.understandingScore : state.understandingScore
            })),

            // Deduct from listeningScore, floored at 0
            deductListeningScore: (amount) => set((state) => {
                const safeAmount = Number(amount) || 0; // Fallback to 0 if undefined/NaN
                return { listeningScore: Math.max(0, state.listeningScore - safeAmount) };
            }),

            // Set listeningScore to an explicit value
            setListeningScore: (value) => set({
                listeningScore: Math.max(0, Number(value) || 0)
            }),

            // Deduct from flowScore, floored at 0
            deductFlowScore: (amount) => set((state) => {
                const safeAmount = Number(amount) || 0;
                return { flowScore: Math.max(0, state.flowScore - safeAmount) };
            }),

            setHesitationMs: (ms) => set({ hesitationMs: Math.max(0, Number(ms) || 0) }),

            // Deduct from speakingScore, floored at 0
            deductSpeakingScore: (amount) => set((state) => {
                const safeAmount = Number(amount) || 0;
                return { speakingScore: Math.max(0, state.speakingScore - safeAmount) };
            }),

            // Set speakingScore to an explicit value
            setSpeakingScore: (value) => set({
                speakingScore: Math.max(0, Number(value) || 0)
            }),

            incrementIncorrectAttempts: () => set((state) => ({
                incorrectAttempts: state.incorrectAttempts + 1
            })),

            // Increment whisperRejections by 1
            incrementWhisperRejections: () => set((state) => ({
                whisperRejections: state.whisperRejections + 1
            })),

            // Update dayCount and currentStreak together
            setActivityMetrics: (dayCount, currentStreak) => set({
                dayCount: Number(dayCount) || 0,
                currentStreak: Number(currentStreak) || 0
            }),

            setLessonsCompleted: (count) => {
                const safeCount = Number(count) || 0;
                console.log(`[Gamification] Lessons completed updated: ${safeCount}`);
                set({ lessonsCompleted: safeCount });
            },
            setLastLessonFluencyAvg: (avg) => {
                console.log(`[Gamification] Last lesson fluency avg updated: ${avg}`);
                set({ lastLessonFluencyAvg: avg });
            },
            setFluencyImproving: (improving) => {
                console.log(`[Gamification] Fluency improving flag: ${!!improving}`);
                set({ fluencyImproving: !!improving });
            },
            setLastSuccessFluencyData: (data) => set({ lastSuccessFluencyData: data || null }),
            setTotalFluencySum: (sum) => set({ totalFluencySum: Number(sum) || 0 }),
            setRecentFluencyAvgs: (avgs) => set({ recentFluencyAvgs: Array.isArray(avgs) ? avgs : [] }),
            setCountedLessons: (lessons) => set({ countedLessons: Array.isArray(lessons) ? lessons : [] }),

            // Increment Tutor Engagement Stats
            incrementUserTutorStats: (wordCount) => set((state) => ({
                userMessagesToAi: state.userMessagesToAi + 1,
                userMessagesToAiWordCount: state.userMessagesToAiWordCount + (Number(wordCount) || 0)
            })),
            incrementAiTutorStats: (wordCount) => set((state) => ({
                aIMessagesToUser: state.aIMessagesToUser + 1,
                aIMessagesToUserWordCount: state.aIMessagesToUserWordCount + (Number(wordCount) || 0)
            })),

            resetForNextStep: () => set({
                listeningScore: 100,
                speakingScore: 100,
                incorrectAttempts: 0,
                whisperRejections: 0,
                fluencyScore: 100,
                flowScore: 100,
                hesitationMs: 0,
                vocabularyScore: 100,
                grammarScore: 100,
                formalityScore: 100,
                nativeLikeScore: 100,
                understandingScore: 100,
                lastSuccessFluencyData: null,
                submitBtnDisabled: false,
                inputDisabled: false,
                isPlaybackMuted: false,
                bottomControlState: 'mic',
                praiseImageUrl: null,
                youtubeVideoId: null,
                whisperReviewData: null,
                whisperReviewTimeLeft: null,
                successVideoBlob: null,
                successScreenVisible: false,
                successLessonId: null,
                successFluencyData: null,
                successContinueButton: { visible: false, loading: false },
                successVideoButton: { visible: false, loading: false, state: 'idle' },
                successRepeatButton: { visible: false },
                successCanvasVisible: false,
                playbackBlob: null,
                playbackAutoplay: false,
                playbackSpeechCamChunks: [],
                speechCue: null,
                speechPossibleAnswer: null,
                hangmanOps: null,
            }),

            // Reset all per-lesson metrics (called at lesson start)
            resetForNewLesson: () => set({
                listeningScore: 100,
                speakingScore: 100,
                incorrectAttempts: 0,
                whisperRejections: 0,
                fluencyScore: 100,
                flowScore: 100,
                vocabularyScore: 100,
                grammarScore: 100,
                formalityScore: 100,
                nativeLikeScore: 100,
                understandingScore: 100,
                lastSuccessFluencyData: null,
                pointLossAmount: null,
                submitBtnDisabled: false,
                inputDisabled: false
            }),

            // --- Input UI Actions (Replaces renderSpeechInputUI/renderTextInputUI) ---
            setTextInputVisible: (visible) => set({ textInputVisible: visible }),
            setTextInputPlaceholder: (placeholder) => set({ textInputPlaceholder: placeholder }),
            setTextInputSubmitCallback: (callback) => set({ textInputSubmitCallback: callback }),
            setSpeechInputContent: (content) => set({ speechInputContent: content }),
            setSpeechCue: (cue) => set({ speechCue: cue }),
            setSpeechPossibleAnswer: (answer) => set({ speechPossibleAnswer: answer }),
            setSpeechInputHintCallback: (callback) => set({ speechInputHintCallback: callback }),
            setSpeechInputRevealCallback: (callback) => set({ speechInputRevealCallback: callback }),
            setSpeechInputToggleCallback: (callback) => set({ speechInputToggleCallback: callback }),
            setTutorChatVisible: (visible) => set({ tutorChatVisible: visible }),
            setTutorChatSubmitCallback: (callback) => set({ tutorChatSubmitCallback: callback }),
            setWebcamStream: (stream) => set({ webcamStream: stream }),
            setMediaVisible: (visible) => set({ mediaVisible: visible }),
            setPointLossAmount: (amount) => set({ pointLossAmount: amount }),
            // --- Whisper Review Actions ---
            setWhisperReviewData: (data) => set({ whisperReviewData: data }),
            setWhisperReviewTimeLeft: (timeLeft) => set({ whisperReviewTimeLeft: timeLeft }),
            setSuccessVideoBlob: (blob) => set({ successVideoBlob: blob }),
            clearSuccessVideoBlob: () => set({ successVideoBlob: null }),

            // --- Success Screen Actions ---
            setSuccessScreen: (lessonId, fluencyData) => set({
                successScreenVisible: true,
                successLessonId: lessonId,
                successFluencyData: fluencyData,
                successContinueButton: { visible: false, loading: false },
                successVideoButton: { visible: true, loading: false, state: 'idle' },
                successRepeatButton: { visible: false },
                successCanvasVisible: false,
            }),
            hideSuccessScreen: () => set({
                successScreenVisible: false,
                successLessonId: null,
                successFluencyData: null,
                successContinueButton: { visible: false, loading: false },
                successVideoButton: { visible: false, loading: false, state: 'idle' },
                successRepeatButton: { visible: false },
                successCanvasVisible: false,
            }),
            setSuccessContinueLoading: (loading) => set(state => ({
                successContinueButton: { ...state.successContinueButton, loading }
            })),
            setSuccessVideoState: (state) => set({
                successVideoButton: { visible: true, loading: state === 'processing', state }
            }),
            setSuccessCanvasVisible: (visible) => set({ successCanvasVisible: visible }),
            setSuccessRepeatButtonVisible: (visible) => set(state => ({
                successRepeatButton: { visible }
            })),
            setSuccessContinueVisible: (visible) => set(state => ({
                successContinueButton: { ...state.successContinueButton, visible }
            })),

            // --- Media Viewport Actions ---
            setPraiseImageUrl: (url) => set({ praiseImageUrl: url }),
            setYoutubeVideoId: (id) => set({ youtubeVideoId: id }),
            triggerMediaClear: () => set((state) => ({ mediaClearTrigger: state.mediaClearTrigger + 1 })),

            clearInputUI: () => set({
                textInputVisible: false,
                textInputPlaceholder: '',
                textInputSubmitCallback: null,
                speechInputContent: null,
                speechCue: null,
                speechPossibleAnswer: null,
                speechInputHintCallback: null,
                speechInputRevealCallback: null,
                speechInputToggleCallback: null,
                tutorChatVisible: false
            })
        }),
        {
            name: 'uff-lesson-storage',
            partialize: (state) => ({
                // Only these values are saved to localStorage. 
                // isDemoMode and isWhisperReady are safely ignored.
                activeLessonId: state.activeLessonId,
                currentLessonIndex: state.currentLessonIndex,
                currentStepIndex: state.currentStepIndex,
                fluencyScore: state.fluencyScore,
                flowScore: state.flowScore,
                vocabularyScore: state.vocabularyScore,
                grammarScore: state.grammarScore,
                formalityScore: state.formalityScore,
                nativeLikeScore: state.nativeLikeScore,
                understandingScore: state.understandingScore,
                totalFluencySum: state.totalFluencySum,
                recentFluencyAvgs: state.recentFluencyAvgs,
                countedLessons: state.countedLessons,
                responsesGiven: state.responsesGiven,
                repeatPointsHistory: state.repeatPointsHistory,
                rolePlayPointsHistory: state.rolePlayPointsHistory,
                userMessagesToAi: state.userMessagesToAi,
                aIMessagesToUser: state.aIMessagesToUser,
                userMessagesToAiWordCount: state.userMessagesToAiWordCount,
                aIMessagesToUserWordCount: state.aIMessagesToUserWordCount
            })
        }
    )
);

// Global bridge for legacy window.isMicActive
if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'isMicActive', {
        get() {
            return appStore.getState().isMicActive;
        },
        set(value) {
            appStore.getState().setMicActive(value);
        },
        configurable: true
    });
}

