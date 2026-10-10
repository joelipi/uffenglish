// --- modules/store.js ---
// Zustand vanilla store for reactive UI metrics.
// This store holds the values that drive persistent on-screen indicators and session states.
// All other application state (lesson data, config, player refs, flags) remains in state.js.

import { createStore } from 'zustand';
import { persist } from 'zustand/middleware';
import { applyGuestLanguagePreference } from '../user/guest-modal-logic.js';
import { BRANCH_OVERLAY_PHASE } from '../lesson/branch-choice-logic.js';

// ── Module-level mutable refs (not reactive) ──
// These hold instances that don't belong in Zustand's reactive state.
// Components needing reactivity should subscribe to related trigger counters.
let _answerPipelineDeps = null;
let _currentVideoPlayer = null;
let _webcamStream = null;
let _nextMsgId = 1;

export function getAnswerPipelineDeps()    { return _answerPipelineDeps; }
export function setAnswerPipelineDeps(v)   { _answerPipelineDeps = v; }
export function getCurrentVideoPlayer()    { return _currentVideoPlayer; }
export function setCurrentVideoPlayer(v)   { _currentVideoPlayer = v; }
export function getWebcamStream()          { return _webcamStream; }
export function setWebcamStream(v)         { _webcamStream = v; appStore.getState()._bumpWebcamStreamKey(); }

const phaseMapping = {
    loading:                                     { topState: 'hidden',          mediaState: 'preloader',           bottomState: 'hidden',               showMission: false },
    lessonIntro:                                 { topState: 'topBarOnly',      mediaState: 'introCallWidget',     bottomState: 'hidden',               showMission: true },
    firstResponse:                               { topState: 'topBarOnly',      mediaState: 'webcamOrAvatar',      bottomState: 'introChoices',          showMission: true },
    simpleVideo:                                 { topState: 'topBarOnly',      mediaState: 'simpleVideo',         bottomState: 'hidden',               showMission: true },
    'simpleVideo-decisionTime-response':         { topState: 'topBarOnly',      mediaState: 'decisionOverlay',     bottomState: 'responseDecisionButtons', showMission: true },
    [BRANCH_OVERLAY_PHASE]:                      { topState: 'topBarOnly',      mediaState: 'decisionOverlay',     bottomState: 'branchChoices',         showMission: true },
    'interactiveVideo+closedResponse':           { topState: 'topBarWithStats', mediaState: 'interactiveVideo',    bottomState: 'hidden',                showMission: true },
    'interactiveVideo+openResponse':             { topState: 'topBarWithStats', mediaState: 'interactiveVideo',    bottomState: 'hidden',                showMission: true },
    'interactiveVideo+friendClosedResponse':     { topState: 'topBarWithStats', mediaState: 'interactiveVideo',    bottomState: 'hidden',                showMission: true },
    'interactiveVideo-decisionTime-closedResponse': { topState: 'topBarWithStats', mediaState: 'decisionOverlay', bottomState: 'decisionButtons',      showMission: true },
    'interactiveVideo-decisionTime-openResponse':   { topState: 'topBarWithStats', mediaState: 'decisionOverlay', bottomState: 'decisionButtons',      showMission: true },
    'interactiveVideo-decisionTime-friendClosedResponse': { topState: 'topBarWithStats', mediaState: 'decisionOverlay', bottomState: 'decisionButtons', showMission: true },
    'viewAndContinueVideo':                          { topState: 'topBarOnly',      mediaState: 'simpleVideo',         bottomState: 'hidden',               showMission: true },
    'simpleVideo-decisionTime-viewAndContinue':     { topState: 'topBarOnly',      mediaState: 'decisionOverlay', bottomState: 'presentDecisionButtons', showMission: false },
    'recording/answering':                       { topState: (s) => s.currentVideo?.type === 'interactive' || s.isTextMode ? 'topBarWithStats' : 'topBarOnly', mediaState: 'webcamOrAvatar', bottomState: 'micActiveOrAnswerInput', showMission: false },
    'processing/transcribing':                   { topState: (s) => s.currentVideo?.type === 'interactive' || s.isTextMode ? 'topBarWithStats' : 'topBarOnly', mediaState: 'processingRecording', bottomState: 'hidden', showMission: false },
    'transcription preflight-rejected':          { topState: (s) => s.currentVideo?.type === 'interactive' || s.isTextMode ? 'topBarWithStats' : 'topBarOnly', mediaState: 'preflightRejected', bottomState: 'hidden', showMission: false },
    review:                                      { topState: (s) => s.currentVideo?.type === 'interactive' || s.isTextMode ? 'topBarWithStats' : 'topBarOnly', mediaState: 'whisperReview', bottomState: 'reviewButtons', showMission: false },
    feedback:                                    { topState: 'topBarOnly',       mediaState: 'chat',                bottomState: 'continueButton',        showMission: false },
    lessonSuccess:                               { topState: 'topBarOnly',       mediaState: 'simpleVideo',         bottomState: 'lessonSuccess',         showMission: false },
    // Success video finished: keep the success screen mounted (so the guest
    // modal effect still runs) but switch to the decision overlay so the
    // tap-to-play icon is suppressed while the water overlay + concat button
    // are revealed — mirrors 'simpleVideo-decisionTime-viewAndContinue'.
    'lessonSuccess-decisionTime':                { topState: 'topBarOnly',       mediaState: 'decisionOverlay',     bottomState: 'lessonSuccess',         showMission: false },
    successVideoCreation:                        { topState: 'hidden',           mediaState: 'videoProcessor',      bottomState: 'hidden',               showMission: false },
    'successVideo/videoShare':                   { topState: 'hidden',           mediaState: 'videoProcessor',      bottomState: 'shareButtons',          showMission: false },
    error:                                       { topState: 'hidden',           mediaState: 'errorModal',          bottomState: 'hidden',               showMission: false },
};

const answerFlowTransitions = {
    'simpleVideo':                               ['recording/answering', 'simpleVideo-decisionTime-response', BRANCH_OVERLAY_PHASE],
    'interactiveVideo+closedResponse':           ['interactiveVideo-decisionTime-closedResponse'],
    'interactiveVideo+openResponse':             ['interactiveVideo-decisionTime-openResponse'],
    'interactiveVideo+friendClosedResponse':     ['interactiveVideo-decisionTime-friendClosedResponse'],
    'interactiveVideo-decisionTime-closedResponse': ['recording/answering', 'interactiveVideo+closedResponse'],
    'interactiveVideo-decisionTime-openResponse':   ['recording/answering', 'interactiveVideo+openResponse'],
    'interactiveVideo-decisionTime-friendClosedResponse': ['recording/answering', 'interactiveVideo+friendClosedResponse'],
    'firstResponse':                             ['recording/answering'],
    'recording/answering':                       ['processing/transcribing', 'feedback'],
    'processing/transcribing':                   ['review', 'transcription preflight-rejected', 'recording/answering', 'feedback'],
    'transcription preflight-rejected':          ['recording/answering'],
    review:                                      ['feedback', 'loading'],
    'simpleVideo-decisionTime-viewAndContinue':      ['simpleVideo', 'feedback'],
    'simpleVideo-decisionTime-response':             ['simpleVideo', 'recording/answering'],
    'viewAndContinueVideo':                           ['simpleVideo-decisionTime-viewAndContinue'],
    feedback:                                    [],
};

export const appStore = createStore(
    persist(
        (set, get) => ({
            // --- Session Flags (Not Persisted) ---
            isPWAMode: false,
            isWhisperReady: false,
            isWhisperEngineFailed: false,
            isMicActive: false,
            isTextMode: false,
            isPlaybackMuted: false,
            isCameraOff: false,
            isGuestModalOpen: false,
            guestModalShownThisSession: false,
            guestNativeLanguage: null,
            guestDetectedLang: null,
            guestModalStep: 'select-language',
            // True when the current guest modal was opened for a friend lesson:
            // step 1 (language) still renders, but step 2 (login choice) never does.
            guestModalFriendMode: false,
            isLoggedIn: false,
            reactReady: false,
            criticalErrorMessage: null,
            answerErrorMessage: null,
            userFirstName: null,
            userData: null,
            configData: null,
            friendCode: null,   // captured from ?sharecode= URL param (case-insensitive, lowercased), persisted
            courseId: null,
            currentLessonTimestamp: null,
            lessonScores: '{}',
            userLevel: 'A0',
            currentVideo: null,
            pendingLessonNavigation: null,
            pauseAllVideosTrigger: 0,
            pendingVideoPlayType: null,  // 'interactive' | 'simple' | 'success' | null

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
            currentStepIndexLessonId: '',
            // True when the current step was loaded directly by loadLessonContent
            // (page load / reload / signup redirect) rather than advanced to via
            // loadNextStep. Drives the success screen's immediate reveal.
            stepLoadedFromRestore: false,
            wordsRevealed: 0,
            videoPlays: 0,
            videoClicks: 0,
            lessonStartTime: null,

            // --- Input UI State (Replaces renderSpeechInputUI/renderTextInputUI) ---
            textInputVisible: false,
            textInputPlaceholder: '',
            speechInputContent: null,
            tutorChatVisible: false,

            _webcamStreamKey: 0,
            mediaVisible: false,
            micBounceTrigger: 0,
            overlayVisible: false,
            bottomOverlayVisible: true,

            // --- Preloader State ---
            preloaderVisible: true,
            preloaderProgress: 0,
            introVideoReady: true,  // becomes false when a lesson intro video is loading; gates Preloader removal (legacy)
            introPosterReady: true, // becomes false when an intro poster (lessonId jpg) is loading; gates Preloader removal — zero-ms rectangle guarantee

            // --- App Phase State Machine ---
            appPhase: 'loading',
            topState: 'hidden',
            mediaState: 'preloader',
            bottomState: 'hidden',
            phaseData: {},

            // --- System Message Overlay ---
            systemMessage: null,
            systemMessageText: null,

            // --- Whisper Review Overlay ---
            whisperReviewData: null,
            whisperReviewTimeLeft: null,
            successVideoBlob: null,

            // --- Success Screen State ---
            successScreenVisible: false,
            successLessonId: null,
            successFluencyData: null,
            lastSuccessFluencyData: null,
            successContinueButton: { visible: false, loading: false },
            successVideoButton: { visible: false, loading: false, state: 'idle' },
            successRepeatButton: { visible: false },
            successCanvasVisible: false,
            // True while the per-segment clips are being published after the
            // recap is ready. The success screen warns the user not to close
            // the tab until it flips back to false.
            clipsPublishing: false,

            // --- Save-clips modal (guest R2 publish prompt) ---
            saveClipsModalOpen: false,
            // Captured at modal-open so the post-login effect can recover
            // the recap's lessonId even if the success screen unmounts.
            pendingPublishLessonId: null,
            // True when the guest pressed the create-video button and the modal
            // is gating video generation. Cleared on login or "Not now"; the
            // success screen resumes generation when it flips false.
            pendingVideoCreation: false,
            // Friend-completion credits waiting on authentication: a guest has
            // no user id, so owner credits cannot be recorded until signup
            // or login. Array of { ownerShareCode, courseId, lessonId },
            // deduped by key (unique-users semantics). Persisted so credits
            // survive a reload before the account exists.
            pendingFriendCredits: [],
            pointLossAmount: null,
            pointLossTrigger: 0,

            // --- Media Viewport Dynamic Content ---
            praiseImageUrl: null,
            youtubeVideoId: null,
            mediaClearTrigger: 0,

            // --- Playback Video State ---
            playbackBlob: null,
            playbackAutoplay: false,

            // --- Recorded Audio Waveform ---
            recordedAudioPeaks: null,

            // --- Tutor Engagement Metrics ---
            userMessagesToAi: 0,
            aIMessagesToUser: 0,
            userMessagesToAiWordCount: 0,
            aIMessagesToUserWordCount: 0,

            // --- Actions ---

            // Set Session Flags
            setPWAMode: (val) => set({ isPWAMode: val }),
            setWhisperReady: (val) => set({ isWhisperReady: val }),
            setWhisperEngineFailed: (val) => set({ isWhisperEngineFailed: val }),
            setMicActive: (val) => set({ isMicActive: val }),
            setTextMode: (val) => set({ isTextMode: val }),
            setPlaybackMuted: (val) => set({ isPlaybackMuted: val }),
            setCameraOff: (val) => set({ isCameraOff: val }),
            setGuestModalOpen: (val) => set({ isGuestModalOpen: val }),
            setGuestModalShownThisSession: (val) => set({ guestModalShownThisSession: val }),
            setStepLoadedFromRestore: (val) => set({ stepLoadedFromRestore: val }),
            setGuestNativeLanguage: (val) => set({ guestNativeLanguage: val }),
            setGuestDetectedLang: (val) => set({ guestDetectedLang: val }),
            setGuestModalStep: (val) => set({ guestModalStep: val }),
            setGuestModalFriendMode: (val) => set({ guestModalFriendMode: val }),
            setFriendCode: (code) => set({ friendCode: code }),
            /** Adopts `lang` without opening the modal or changing the step (friend
             *  lessons with a non-English browser language). Also writes
             *  userData.native_language so the whole app (MissionSection,
             *  DecisionButtons, Hints, etc.) translates to the guest's language. */
            setGuestLanguageSilent: (lang) => set((state) => ({
                guestNativeLanguage: lang,
                userData: state.userData
                    ? { ...state.userData, native_language: lang }
                    : { native_language: lang },
            })),
            /** Sets guestNativeLanguage + userData.native_language and, in non-friend
             *  mode, the guestModalStep, all in ONE set() so React never renders
             *  login-choice with a null language. In friend mode it closes the modal
             *  instead, so step 2 (login choice) never renders. */
            confirmGuestLanguage: (lang) => set((state) => {
                const userData = state.userData
                    ? { ...state.userData, native_language: lang }
                    : { native_language: lang };
                if (state.guestModalFriendMode) {
                    return { guestNativeLanguage: lang, userData, isGuestModalOpen: false };
                }
                return { guestNativeLanguage: lang, userData, guestModalStep: 'login-choice' };
            }),
            setIsLoggedIn: (val) => set({ isLoggedIn: val }),
            setReactReady: (val) => set({ reactReady: val }),
            triggerMicBounce: () => set((state) => ({ micBounceTrigger: state.micBounceTrigger + 1 })),
            setCriticalErrorMessage: (val) => set({ criticalErrorMessage: val }),
            setAnswerErrorMessage: (val) => set({ answerErrorMessage: val }),
            _bumpWebcamStreamKey: () => set((s) => ({ _webcamStreamKey: s._webcamStreamKey + 1 })),
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
                    ...msg,
                    id: msg.id ?? _nextMsgId++,
                    role: msg.role,
                    type: msg.type || 'standard',
                    content: msg.content,
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
            setUserFirstName: (val) => set({ userFirstName: val }),
            setCourseData: (data) => set((state) => {
                const incomingUserData = data.userData !== undefined ? data.userData : state.userData;
                return {
                    // A guest's chosen language is authoritative: the async
                    // bootstrap writes the fetched guest profile (native_language
                    // 'EN') and must not revert a language the guest already
                    // confirmed. See applyGuestLanguagePreference.
                    userData: applyGuestLanguagePreference({
                        userData: incomingUserData,
                        guestLang: state.guestNativeLanguage,
                        isLoggedIn: state.isLoggedIn,
                    }),
                    configData: data.configData !== undefined ? data.configData : state.configData,
                    courseId: data.courseId !== undefined ? data.courseId : state.courseId,
                    userLevel: data.userLevel !== undefined ? data.userLevel : state.userLevel,
                };
            }),
            setCourseId: (val) => set({ courseId: val }),
            setCurrentLessonTimestamp: (val) => set({ currentLessonTimestamp: val }),
            setLessonScores: (val) => set({ lessonScores: val }),

            setCurrentVideo: (video) => {
                console.log(`[Store] setCurrentVideo: ${video ? video.type : 'null'}`);
                set({ currentVideo: video });
            },

            // --- Preloader Actions ---
            setPreloaderProgress: (val) => set({ preloaderProgress: val }),
            setPreloaderVisible: (val) => set({ preloaderVisible: val }),
            setIntroVideoReady: (val) => set({ introVideoReady: val }),
            setIntroPosterReady: (val) => set({ introPosterReady: val }),

            // --- UI State Actions ---
            setProgressPercent: (percent) => set({ progressPercent: percent }),
            setSystemMessageText: (text) => set({ systemMessageText: text }),
            setSystemMessage: (status) => set({ systemMessage: status }),
            setIsLoaded: (loaded) => set({ isLoaded: loaded }),
            setHintsVisible: (visible) => set({ hintsVisible: visible }),
            setHangmanHintHTML: (html) => set({ hangmanHintHTML: html }),
            setHangmanOps: (ops) => set({ hangmanOps: ops }),
            setHangmanCue: (cue) => set({ hangmanCue: cue }),
            setBottomOverlayVisible: (val) => set({ bottomOverlayVisible: val }),
            setOverlayVisible: (val) => set({ overlayVisible: val }),
            setSubmitBtnDisabled: (val) => set({ submitBtnDisabled: val }),
            setSubmitBtnIcon: (icon) => set({ submitBtnIcon: icon }),
            setSubmitBtnDanger: (val) => set({ submitBtnDanger: val }),
            setInputDisabled: (val) => set({ inputDisabled: val }),
            triggerInputFocus: () => set((state) => ({ inputFocusTrigger: state.inputFocusTrigger + 1 })),
            triggerPointLoss: (target, points) => set((state) => ({ pointLossAmount: points, pointLossTrigger: state.pointLossTrigger + 1 })),
            triggerVideoPlay: (muted) => set((state) => ({ videoPlayTrigger: state.videoPlayTrigger + 1, videoPlayMuted: muted })),
            triggerVideoClear: () => set((state) => ({ videoClearTrigger: state.videoClearTrigger + 1 })),
            triggerPauseAllVideos: () => set((state) => ({ pauseAllVideosTrigger: state.pauseAllVideosTrigger + 1 })),
            setPendingVideoPlayType: (type) => set({ pendingVideoPlayType: type }),
            triggerPreflightRejected: () => set((state) => ({ preflightRejectedTrigger: state.preflightRejectedTrigger + 1 })),
            triggerTranscriptRejected: (cue, transcript) => set((state) => ({ transcriptRejectedTrigger: state.transcriptRejectedTrigger + 1, transcriptRejectedCue: cue, transcriptRejectedTranscript: transcript })),
            triggerScoreUpdate: () => set((state) => ({ scoreUpdateTrigger: state.scoreUpdateTrigger + 1 })),
            transitionTo: (phase, data = {}, opts = {}) => set((state) => {
                if (!opts.fromStepLoad) {
                    const allowed = answerFlowTransitions[state.appPhase];
                    if (allowed && !allowed.includes(phase)) {
                        console.warn(`[Phase] Unexpected transition: ${state.appPhase} → ${phase} (allowed: ${allowed.join(', ')})`);
                    }
                }

                const zoneStates = phaseMapping[phase] || phaseMapping.error;

                const resolved = Object.fromEntries(
                    Object.entries(zoneStates).map(([k, v]) => [k, typeof v === 'function' ? v(state) : v])
                );

                console.log(`[Phase] ${state.appPhase} → ${phase}`, data);

                const result = {
                    appPhase: phase,
                    phaseData: data,
                    ...resolved,
                };
                if (phase === 'review') {
                    result.whisperReviewData = data;
                    result.whisperReviewTimeLeft = data?.timeLeft ?? null;
                }
                return result;
            }),
            setPlaybackBlob: (blob, autoplay = false) => set({ playbackBlob: blob, playbackAutoplay: autoplay }),
            clearPlaybackBlob: () => set({ playbackBlob: null, playbackAutoplay: false }),
            setRecordedAudioPeaks: (peaks) => set({ recordedAudioPeaks: peaks }),
            clearRecordedAudioPeaks: () => set({ recordedAudioPeaks: null }),
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
                playbackBlob: null,
                playbackAutoplay: false,
                bottomOverlayVisible: true,
                appPhase: 'loading',
                phaseData: {},
                ...phaseMapping.loading,
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
                clipsPublishing: false,
                playbackBlob: null,
                playbackAutoplay: false,
                hangmanOps: null,
                hangmanCue: null,
                pendingVideoPlayType: null,
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
                pointLossTrigger: 0,
                submitBtnDisabled: false,
                inputDisabled: false,
                stepsAnswered: 0,
                isTextMode: false,
                isCameraOff: false,
                successVideoBlob: null,
                successVideoButton: { visible: false, loading: false, state: 'idle' },
                successCanvasVisible: false,
                clipsPublishing: false,
            }),

            // --- Input UI Actions (Replaces renderSpeechInputUI/renderTextInputUI) ---
            setTextInputVisible: (visible) => set({ textInputVisible: visible }),
            setTextInputPlaceholder: (placeholder) => set({ textInputPlaceholder: placeholder }),
            setSpeechInputContent: (content) => set({ speechInputContent: content }),
            setTutorChatVisible: (visible) => set({ tutorChatVisible: visible }),


            setMediaVisible: (visible) => set({ mediaVisible: visible }),
            setPointLossAmount: (amount) => set((state) => ({ pointLossAmount: amount, pointLossTrigger: state.pointLossTrigger + 1 })),
            // --- Whisper Review Actions ---
            setWhisperReviewData: (data) => set({ whisperReviewData: data }),
            setWhisperReviewTimeLeft: (timeLeft) => set({ whisperReviewTimeLeft: timeLeft }),
            setSuccessVideoBlob: (blob) => set({ successVideoBlob: blob }),
            clearSuccessVideoBlob: () => set({ successVideoBlob: null }),
            setClipsPublishing: (publishing) => set({ clipsPublishing: publishing }),

            // --- Success Screen Actions ---
            setSuccessScreen: (lessonId, fluencyData) => set({
                successScreenVisible: true,
                successLessonId: lessonId,
                successFluencyData: fluencyData,
                successContinueButton: { visible: false, loading: false },
                successVideoButton: { visible: true, loading: false, state: 'idle' },
                successRepeatButton: { visible: false },
                successCanvasVisible: false,
                clipsPublishing: false,
            }),
            hideSuccessScreen: () => set({
                successScreenVisible: false,
                successLessonId: null,
                successFluencyData: null,
                successContinueButton: { visible: false, loading: false },
                successVideoButton: { visible: false, loading: false, state: 'idle' },
                successRepeatButton: { visible: false },
                successCanvasVisible: false,
                clipsPublishing: false,
                successVideoBlob: null,
                saveClipsModalOpen: false,
                pendingPublishLessonId: null,
                pendingVideoCreation: false,
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
            setSaveClipsModalOpen: (open) => set({ saveClipsModalOpen: open }),
            setPendingPublishLessonId: (lessonId) => set({ pendingPublishLessonId: lessonId }),
            setPendingVideoCreation: (pending) => set({ pendingVideoCreation: pending }),
            setPendingFriendCredits: (credits) => set({ pendingFriendCredits: Array.isArray(credits) ? credits : [] }),

            // --- Media Viewport Actions ---
            setPraiseImageUrl: (url) => set({ praiseImageUrl: url }),
            setYoutubeVideoId: (id) => set({ youtubeVideoId: id }),
            triggerMediaClear: () => set((state) => ({ mediaClearTrigger: state.mediaClearTrigger + 1 })),

            clearCriticalError: () => set({
                criticalErrorMessage: null,
                isLoaded: false,
                preloaderProgress: 100,
                preloaderVisible: false,
                chatHistory: [],
                mediaVisible: false,
                currentVideo: null,
                textInputVisible: false,
                speechInputContent: null,
                tutorChatVisible: false,
                submitBtnDisabled: false,
                inputDisabled: false,
                progressPercent: 0,
                completionMessage: null,
                listeningScore: 100,
                speakingScore: 100,
                fluencyScore: 100,
                flowScore: 100,
                vocabularyScore: 100,
                grammarScore: 100,
                formalityScore: 100,
                nativeLikeScore: 100,
                understandingScore: 100,
            }),

            clearInputUI: () => set({
                textInputVisible: false,
                textInputPlaceholder: '',
                speechInputContent: null,
                tutorChatVisible: false
            })
        }),
        {
            name: 'uff-lesson-storage',
            partialize: (state) => ({
                // Only these values are saved to localStorage. 
                // isPWAMode and isWhisperReady are safely ignored.
                activeLessonId: state.activeLessonId,
                currentLessonIndex: state.currentLessonIndex,
                currentStepIndex: state.currentStepIndex,
                currentStepIndexLessonId: state.currentStepIndexLessonId,
                isTextMode: state.isTextMode,
                isCameraOff: state.isCameraOff,
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
                aIMessagesToUserWordCount: state.aIMessagesToUserWordCount,
                courseId: state.courseId,
                friendCode: state.friendCode,
                pendingFriendCredits: state.pendingFriendCredits,
                guestNativeLanguage: state.guestNativeLanguage,
                currentLessonTimestamp: state.currentLessonTimestamp,
                lessonScores: state.lessonScores
            })
        }
    )
);

