# React Transition Report: Comprehensive Codebase Analysis

This report provides a detailed, file-by-file analysis of the required changes to migrate the UFF English application to React.

### `js/app.js`
- **Lines of Code**: 947
- **Dependencies**: ./modules/navigation.js, ./modules/storage.js, ./components/success-lesson.js, ./components/point-loss-animation.js, ./components/mic-animation.js, ./modules/user-profile.js, ./components/ui.js, ./data/strings.js, ./modules/scoring.js, ./modules/api.js, ./modules/user-profile.js, ./modules/lesson-router.js, ./modules/config-normalizer.js, ./modules/video-loader.js, ./modules/store.js, ./modules/state.js, ./modules/utils.js, ./modules/analytics.js, ./modules/media.js, ./modules/feedback-builder.js, ./components/feedback-renderer.js, ./components/step-loader.js, ./modules/idiom-checker.js, ./modules/complexity.js
- **Category**: State Management / Business Logic
- **React Transition**: This file accesses the global `State` or `appStore`. Since `appStore` uses Zustand, it is already React-compatible (use `useStore` hook). For the vanilla `State` object, consider migrating it to a Zustand store or React Context to ensure UI components re-render when properties change. No DOM changes are needed.

### `js/components/feedback-renderer.js`
- **Lines of Code**: 6
- **Category**: Pure Logic
- **React Transition**: This file contains pure JavaScript logic. It requires NO CHANGES for React. Keep it as-is and import the exported functions directly into your React components.

### `js/components/feedback-renderer.web.js`
- **Lines of Code**: 145
- **Exports**: renderFeedbackToHTML, renderExplanationsToHTML
- **Category**: Pure Logic
- **React Transition**: This file contains pure JavaScript logic. It requires NO CHANGES for React. Keep it as-is and import the exported functions directly into your React components.

### `js/components/interactive-video-player.js`
- **Lines of Code**: 360
- **Exports**: InteractiveVideoPlayerUI, InteractiveVideoPlayer
- **Dependencies**: ../modules/interactive-video-controller.js
- **Category**: UI Component (46 DOM manipulations found)
- **React Transition**: This file needs to be entirely rewritten into one or more React Functional Components. The imperative DOM updates (e.g., `innerHTML`, `classList.add`) should be replaced with JSX and state variables (`useState`). Any internal state must be migrated to React hooks. Elements should use `ref` where direct access is unavoidable (e.g., media players).

### `js/components/intro-background-video.js`
- **Lines of Code**: 98
- **Exports**: introBackgroundVideo
- **Category**: UI Component (15 DOM manipulations found)
- **React Transition**: This file needs to be entirely rewritten into one or more React Functional Components. The imperative DOM updates (e.g., `innerHTML`, `classList.add`) should be replaced with JSX and state variables (`useState`). Any internal state must be migrated to React hooks. Elements should use `ref` where direct access is unavoidable (e.g., media players).

### `js/components/mic-animation.js`
- **Lines of Code**: 43
- **Exports**: initMicAnimation
- **Category**: UI Component (8 DOM manipulations found)
- **React Transition**: This file needs to be entirely rewritten into one or more React Functional Components. The imperative DOM updates (e.g., `innerHTML`, `classList.add`) should be replaced with JSX and state variables (`useState`). Any internal state must be migrated to React hooks. Elements should use `ref` where direct access is unavoidable (e.g., media players).

### `js/components/point-loss-animation.js`
- **Lines of Code**: 149
- **Category**: UI Component (10 DOM manipulations found)
- **React Transition**: This file needs to be entirely rewritten into one or more React Functional Components. The imperative DOM updates (e.g., `innerHTML`, `classList.add`) should be replaced with JSX and state variables (`useState`). Any internal state must be migrated to React hooks. Elements should use `ref` where direct access is unavoidable (e.g., media players).

### `js/components/simple-video-player.js`
- **Lines of Code**: 402
- **Exports**: simpleVideoPlayer
- **Dependencies**: ../modules/simple-video-controller.js
- **Category**: UI Component (56 DOM manipulations found)
- **React Transition**: This file needs to be entirely rewritten into one or more React Functional Components. The imperative DOM updates (e.g., `innerHTML`, `classList.add`) should be replaced with JSX and state variables (`useState`). Any internal state must be migrated to React hooks. Elements should use `ref` where direct access is unavoidable (e.g., media players).

### `js/components/step-loader.js`
- **Lines of Code**: 6
- **Category**: Pure Logic
- **React Transition**: This file contains pure JavaScript logic. It requires NO CHANGES for React. Keep it as-is and import the exported functions directly into your React components.

### `js/components/step-loader.web.js`
- **Lines of Code**: 437
- **Exports**: loadStep
- **Dependencies**: ../modules/state.js, ../modules/store.js, ../data/strings.js, ../modules/utils.js, ../modules/video-loader.js, ../modules/media.js, ../modules/video-processor.js, ../modules/user-profile.js, ../modules/scoring.js, ../components/point-loss-animation.js
- **Category**: UI Component (49 DOM manipulations found)
- **React Transition**: This file needs to be entirely rewritten into one or more React Functional Components. The imperative DOM updates (e.g., `innerHTML`, `classList.add`) should be replaced with JSX and state variables (`useState`). Any internal state must be migrated to React hooks. Elements should use `ref` where direct access is unavoidable (e.g., media players).

### `js/components/success-lesson.js`
- **Lines of Code**: 274
- **Exports**: SuccessLessonHandler
- **Dependencies**: canvas-confetti, ../modules/store.js, ./ui.js, ../modules/storage.js
- **Category**: UI Component (45 DOM manipulations found)
- **React Transition**: This file needs to be entirely rewritten into one or more React Functional Components. The imperative DOM updates (e.g., `innerHTML`, `classList.add`) should be replaced with JSX and state variables (`useState`). Any internal state must be migrated to React hooks. Elements should use `ref` where direct access is unavoidable (e.g., media players).

### `js/components/ui.js`
- **Lines of Code**: 1906
- **Exports**: syncTextModeUI, DOM, escapeHTML, getFirstName, flashElement, updateCurrentScoreDisplay, animatePointLoss, updateActivityDisplay, updateDayCountDisplay, disableAllButtons, safeRenderChatInterface, renderUserResponse, renderAIAnalysisLoading, createHeaderHTML, createPragmaticsBubbleHTML, createStatsBubbleHTML, createGrammarDiffHTML, getPraiseHTML, renderAIFeedback, hidePreloader, removeAILoadingStatus, renderHangmanHint, showMicWarning, showAnswerError, resetMissionText, resetMicStatusWithStep, bindAuthMenuUI, initMissionToggle, generateHangmanHint, clearChatInterface, clearChatHeaderScores, updateChatHeaderScores, initTutorChatUI, showTutorChatInput, hideTutorChatInput, hideAnswerInputArea, getChatHistoryContext, renderTutorMessage, showHintsAndScroll, hideHints, clearMicStatusAndHideMedia, setMicStatusText, initUISubscriptions, showGuestLoginModal, hideWhisperReviewUI, showCriticalError, hideCriticalError, renderWhisperReviewUI, updateWhisperTimer, pauseVideoIfPlaying, updateSpeakingScoreDisplay, clearPlaybackVideo, prepareMediaUI, showPlaybackVideo, isWebcamPreviewVisible, createWebcamPreview, ensureWebcamPreview, hideWebcamPreview, removeWebcamPreview, toggleCamera, showContinueButton, hideContinueButton, showLessonSuccessState, renderFallbackContinueButton, resetUIForNewStep, toggleScoresAndHearts, removeRepeatButton, clearMediaContainerAndPreservePlayers, renderImageInMediaContainer, renderYoutubeInMediaContainer, renderSpeechInputUI, renderTextInputUI, updateProgressAndCloseButton, setProgressBarWidth, hideAnswerDiv, bindProcessButton, renderMultiChoiceUI, showMessageInStepsContainer, showInitializationErrorMessage, setupLessonUI, handlecueUI, handleIncueUI
- **Dependencies**: ../modules/state.js, ../modules/store.js, ../data/strings.js, ../data/praise.js, ../modules/utils.js, ../modules/media.js, ./point-loss-animation.js
- **Category**: UI Component (343 DOM manipulations found)
- **React Transition**: This file needs to be entirely rewritten into one or more React Functional Components. The imperative DOM updates (e.g., `innerHTML`, `classList.add`) should be replaced with JSX and state variables (`useState`). Any internal state must be migrated to React hooks. Elements should use `ref` where direct access is unavoidable (e.g., media players).

### `js/components/ui.test.js`
- **Lines of Code**: 116
- **Dependencies**: vitest, ./ui.js
- **Category**: UI Component (22 DOM manipulations found)
- **React Transition**: This file needs to be entirely rewritten into one or more React Functional Components. The imperative DOM updates (e.g., `innerHTML`, `classList.add`) should be replaced with JSX and state variables (`useState`). Any internal state must be migrated to React hooks. Elements should use `ref` where direct access is unavoidable (e.g., media players).

### `js/data/praise.js`
- **Lines of Code**: 62
- **Dependencies**: ./strings.js
- **Category**: Pure Logic
- **React Transition**: This file contains pure JavaScript logic. It requires NO CHANGES for React. Keep it as-is and import the exported functions directly into your React components.

### `js/data/strings.js`
- **Lines of Code**: 646
- **Exports**: get
- **Category**: Pure Logic
- **React Transition**: This file contains pure JavaScript logic. It requires NO CHANGES for React. Keep it as-is and import the exported functions directly into your React components.

### `js/modules/analytics.js`
- **Lines of Code**: 50
- **Dependencies**: ./idiom-checker.js
- **Category**: Pure Logic
- **React Transition**: This file contains pure JavaScript logic. It requires NO CHANGES for React. Keep it as-is and import the exported functions directly into your React components.

### `js/modules/answers.js`
- **Lines of Code**: 269
- **Exports**: getCurrentStepIndex, isLastAiStepInLesson
- **Dependencies**: ./normalize.js, ./calculate-similarity.js, ./swearjar.js, ./api.js, ../data/strings.js
- **Category**: Pure Logic
- **React Transition**: This file contains pure JavaScript logic. It requires NO CHANGES for React. Keep it as-is and import the exported functions directly into your React components.

### `js/modules/api.js`
- **Lines of Code**: 315
- **Exports**: queryClient, courseConfigQuery, currentLessonQuery, invalidateUserAndAuthCache
- **Dependencies**: ./appwrite.js, ./normalize.js, @tanstack/query-core
- **Category**: Pure Logic
- **React Transition**: This file contains pure JavaScript logic. It requires NO CHANGES for React. Keep it as-is and import the exported functions directly into your React components.

### `js/modules/appwrite.js`
- **Lines of Code**: 39
- **Exports**: APPWRITE_CONFIG, account, tablesDB
- **Dependencies**: appwrite
- **Category**: Pure Logic
- **React Transition**: This file contains pure JavaScript logic. It requires NO CHANGES for React. Keep it as-is and import the exported functions directly into your React components.

### `js/modules/calculate-similarity.js`
- **Lines of Code**: 48
- **Category**: Pure Logic
- **React Transition**: This file contains pure JavaScript logic. It requires NO CHANGES for React. Keep it as-is and import the exported functions directly into your React components.

### `js/modules/calculate-similarity.test.js`
- **Lines of Code**: 36
- **Dependencies**: vitest, ./calculate-similarity.js
- **Category**: Pure Logic
- **React Transition**: This file contains pure JavaScript logic. It requires NO CHANGES for React. Keep it as-is and import the exported functions directly into your React components.

### `js/modules/collect-signup-data.js`
- **Lines of Code**: 60
- **Dependencies**: ./geo-service.js, ./referrer.js, ./appwrite.js, ./user-profile.js, ./storage-adapter.js
- **Category**: Pure Logic
- **React Transition**: This file contains pure JavaScript logic. It requires NO CHANGES for React. Keep it as-is and import the exported functions directly into your React components.

### `js/modules/complexity.js`
- **Lines of Code**: 55
- **Exports**: calculateSyntacticComplexity
- **Dependencies**: compromise
- **Category**: Pure Logic
- **React Transition**: This file contains pure JavaScript logic. It requires NO CHANGES for React. Keep it as-is and import the exported functions directly into your React components.

### `js/modules/config-normalizer.js`
- **Lines of Code**: 56
- **Exports**: normalizeConfig
- **Dependencies**: ../data/strings.js, ./utils.js
- **Category**: Pure Logic
- **React Transition**: This file contains pure JavaScript logic. It requires NO CHANGES for React. Keep it as-is and import the exported functions directly into your React components.

### `js/modules/config-normalizer.test.js`
- **Lines of Code**: 79
- **Dependencies**: vitest, ./config-normalizer.js
- **Category**: Pure Logic
- **React Transition**: This file contains pure JavaScript logic. It requires NO CHANGES for React. Keep it as-is and import the exported functions directly into your React components.

### `js/modules/feedback-builder.js`
- **Lines of Code**: 176
- **Exports**: buildFeedbackData, buildExplanationData
- **Dependencies**: ../data/strings.js
- **Category**: Pure Logic
- **React Transition**: This file contains pure JavaScript logic. It requires NO CHANGES for React. Keep it as-is and import the exported functions directly into your React components.

### `js/modules/geo-service.js`
- **Lines of Code**: 2
- **Category**: Pure Logic
- **React Transition**: This file contains pure JavaScript logic. It requires NO CHANGES for React. Keep it as-is and import the exported functions directly into your React components.

### `js/modules/geo-service.native.js`
- **Lines of Code**: 23
- **Category**: Pure Logic
- **React Transition**: This file contains pure JavaScript logic. It requires NO CHANGES for React. Keep it as-is and import the exported functions directly into your React components.

### `js/modules/geo-service.web.js`
- **Lines of Code**: 23
- **Category**: Pure Logic
- **React Transition**: This file contains pure JavaScript logic. It requires NO CHANGES for React. Keep it as-is and import the exported functions directly into your React components.

### `js/modules/idiom-checker.js`
- **Lines of Code**: 212
- **Exports**: idiomChecker
- **Dependencies**: ../data/idioms.json
- **Category**: Platform Handler / Imperative Module (1 DOM interactions found)
- **React Transition**: This file mixes logic with DOM API access. You should refactor this to remove `document.getElementById` calls. Instead, the functions should accept React `Ref` objects (`ref.current`) or DOM nodes passed from the React components that render them. Initialization logic should be wrapped in `useEffect`.

### `js/modules/interactive-video-controller.js`
- **Lines of Code**: 285
- **Exports**: InteractiveVideoStateController
- **Category**: Pure Logic
- **React Transition**: This file contains pure JavaScript logic. It requires NO CHANGES for React. Keep it as-is and import the exported functions directly into your React components.

### `js/modules/lesson-router.js`
- **Lines of Code**: 157
- **Exports**: resolveCurrentLessonId, resolveCurrentCourseId, cleanBrowserUrlRoute, getNextStep, navigateToLogin, navigateToHome
- **Dependencies**: ./store.js
- **Category**: Platform Handler / Imperative Module (6 DOM interactions found)
- **React Transition**: This file mixes logic with DOM API access. You should refactor this to remove `document.getElementById` calls. Instead, the functions should accept React `Ref` objects (`ref.current`) or DOM nodes passed from the React components that render them. Initialization logic should be wrapped in `useEffect`.

### `js/modules/media.js`
- **Lines of Code**: 5
- **Category**: Pure Logic
- **React Transition**: This file contains pure JavaScript logic. It requires NO CHANGES for React. Keep it as-is and import the exported functions directly into your React components.

### `js/modules/media.native.js`
- **Lines of Code**: 89
- **Exports**: Media
- **Dependencies**: expo-av, expo-video, ./state.js
- **Category**: State Management / Business Logic
- **React Transition**: This file accesses the global `State` or `appStore`. Since `appStore` uses Zustand, it is already React-compatible (use `useStore` hook). For the vanilla `State` object, consider migrating it to a Zustand store or React Context to ensure UI components re-render when properties change. No DOM changes are needed.

### `js/modules/media.web.js`
- **Lines of Code**: 87
- **Exports**: Media
- **Dependencies**: ./state.js, howler
- **Category**: Platform Handler / Imperative Module (6 DOM interactions found)
- **React Transition**: This file mixes logic with DOM API access. You should refactor this to remove `document.getElementById` calls. Instead, the functions should accept React `Ref` objects (`ref.current`) or DOM nodes passed from the React components that render them. Initialization logic should be wrapped in `useEffect`.

### `js/modules/navigation.js`
- **Lines of Code**: 1
- **Category**: Pure Logic
- **React Transition**: This file contains pure JavaScript logic. It requires NO CHANGES for React. Keep it as-is and import the exported functions directly into your React components.

### `js/modules/navigation.native.js`
- **Lines of Code**: 13
- **Exports**: cleanBrowserUrlRoute, navigateToLogin, navigateToHome
- **Category**: Pure Logic
- **React Transition**: This file contains pure JavaScript logic. It requires NO CHANGES for React. Keep it as-is and import the exported functions directly into your React components.

### `js/modules/navigation.web.js`
- **Lines of Code**: 23
- **Exports**: cleanBrowserUrlRoute, navigateToLogin, navigateToHome
- **Category**: Platform Handler / Imperative Module (6 DOM interactions found)
- **React Transition**: This file mixes logic with DOM API access. You should refactor this to remove `document.getElementById` calls. Instead, the functions should accept React `Ref` objects (`ref.current`) or DOM nodes passed from the React components that render them. Initialization logic should be wrapped in `useEffect`.

### `js/modules/normalize.js`
- **Lines of Code**: 59
- **Category**: Pure Logic
- **React Transition**: This file contains pure JavaScript logic. It requires NO CHANGES for React. Keep it as-is and import the exported functions directly into your React components.

### `js/modules/normalize.test.js`
- **Lines of Code**: 56
- **Dependencies**: vitest, ./normalize.js
- **Category**: Pure Logic
- **React Transition**: This file contains pure JavaScript logic. It requires NO CHANGES for React. Keep it as-is and import the exported functions directly into your React components.

### `js/modules/referrer.js`
- **Lines of Code**: 2
- **Category**: Pure Logic
- **React Transition**: This file contains pure JavaScript logic. It requires NO CHANGES for React. Keep it as-is and import the exported functions directly into your React components.

### `js/modules/referrer.native.js`
- **Lines of Code**: 23
- **Exports**: getReferrer
- **Category**: Pure Logic
- **React Transition**: This file contains pure JavaScript logic. It requires NO CHANGES for React. Keep it as-is and import the exported functions directly into your React components.

### `js/modules/referrer.web.js`
- **Lines of Code**: 31
- **Exports**: getReferrer
- **Category**: Platform Handler / Imperative Module (4 DOM interactions found)
- **React Transition**: This file mixes logic with DOM API access. You should refactor this to remove `document.getElementById` calls. Instead, the functions should accept React `Ref` objects (`ref.current`) or DOM nodes passed from the React components that render them. Initialization logic should be wrapped in `useEffect`.

### `js/modules/scoring.js`
- **Lines of Code**: 256
- **Exports**: calculateRepeatAverage, calculateRolePlayAverage, calculateAverage, calculateFluencyScore, logInteraction, getCompressedLessonStats
- **Dependencies**: ./state.js, ./store.js
- **Category**: State Management / Business Logic
- **React Transition**: This file accesses the global `State` or `appStore`. Since `appStore` uses Zustand, it is already React-compatible (use `useStore` hook). For the vanilla `State` object, consider migrating it to a Zustand store or React Context to ensure UI components re-render when properties change. No DOM changes are needed.

### `js/modules/scoring.test.js`
- **Lines of Code**: 168
- **Dependencies**: vitest, ./scoring.js, ./state.js, ./store.js
- **Category**: State Management / Business Logic
- **React Transition**: This file accesses the global `State` or `appStore`. Since `appStore` uses Zustand, it is already React-compatible (use `useStore` hook). For the vanilla `State` object, consider migrating it to a Zustand store or React Context to ensure UI components re-render when properties change. No DOM changes are needed.

### `js/modules/simple-video-controller.js`
- **Lines of Code**: 132
- **Exports**: SimpleVideoStateController
- **Category**: Pure Logic
- **React Transition**: This file contains pure JavaScript logic. It requires NO CHANGES for React. Keep it as-is and import the exported functions directly into your React components.

### `js/modules/speech.core.js`
- **Lines of Code**: 101
- **Exports**: MIN_LOGPROB_THRESHOLD, isGibberish, cleanTranscript, trimSilenceWithPadding
- **Category**: Pure Logic
- **React Transition**: This file contains pure JavaScript logic. It requires NO CHANGES for React. Keep it as-is and import the exported functions directly into your React components.

### `js/modules/speech.js`
- **Lines of Code**: 310
- **Exports**: listeningState, initLocalVoiceAI
- **Dependencies**: ./speech.core.js, ./speech.web.js, ../workers/whisper/app-vad-asr-web.js, ./storage.js, ./answers.js, ./state.js, ./store.js
- **Category**: State Management / Business Logic
- **React Transition**: This file accesses the global `State` or `appStore`. Since `appStore` uses Zustand, it is already React-compatible (use `useStore` hook). For the vanilla `State` object, consider migrating it to a Zustand store or React Context to ensure UI components re-render when properties change. No DOM changes are needed.

### `js/modules/speech.web.js`
- **Lines of Code**: 392
- **Exports**: isIOS, isWindows, isAndroid, safelyStopStream, stopSpeechCamRecording, stopLocalAudioTap, isWebSpeechActive, stopWebSpeech, startWebSpeechRecognition
- **Dependencies**: ../data/strings.js, ./storage.js, ./state.js, ../components/ui.js, ../workers/whisper/app-vad-asr-web.js
- **Category**: Platform Handler / Imperative Module (9 DOM interactions found)
- **React Transition**: This file mixes logic with DOM API access. You should refactor this to remove `document.getElementById` calls. Instead, the functions should accept React `Ref` objects (`ref.current`) or DOM nodes passed from the React components that render them. Initialization logic should be wrapped in `useEffect`.

### `js/modules/state.js`
- **Lines of Code**: 138
- **Exports**: State
- **Dependencies**: ./store.js
- **Category**: State Management / Business Logic
- **React Transition**: This file accesses the global `State` or `appStore`. Since `appStore` uses Zustand, it is already React-compatible (use `useStore` hook). For the vanilla `State` object, consider migrating it to a Zustand store or React Context to ensure UI components re-render when properties change. No DOM changes are needed.

### `js/modules/state.test.js`
- **Lines of Code**: 145
- **Dependencies**: vitest, ./state.js, ./store.js
- **Category**: State Management / Business Logic
- **React Transition**: This file accesses the global `State` or `appStore`. Since `appStore` uses Zustand, it is already React-compatible (use `useStore` hook). For the vanilla `State` object, consider migrating it to a Zustand store or React Context to ensure UI components re-render when properties change. No DOM changes are needed.

### `js/modules/storage-adapter.js`
- **Lines of Code**: 14
- **Exports**: localStore
- **Category**: Pure Logic
- **React Transition**: This file contains pure JavaScript logic. It requires NO CHANGES for React. Keep it as-is and import the exported functions directly into your React components.

### `js/modules/storage.js`
- **Lines of Code**: 2
- **Category**: Pure Logic
- **React Transition**: This file contains pure JavaScript logic. It requires NO CHANGES for React. Keep it as-is and import the exported functions directly into your React components.

### `js/modules/storage.web.js`
- **Lines of Code**: 137
- **Exports**: openMediaDB
- **Dependencies**: ./state.js
- **Category**: State Management / Business Logic
- **React Transition**: This file accesses the global `State` or `appStore`. Since `appStore` uses Zustand, it is already React-compatible (use `useStore` hook). For the vanilla `State` object, consider migrating it to a Zustand store or React Context to ensure UI components re-render when properties change. No DOM changes are needed.

### `js/modules/store.js`
- **Lines of Code**: 214
- **Exports**: appStore
- **Dependencies**: zustand/vanilla, zustand/middleware
- **Category**: Pure Logic
- **React Transition**: This file contains pure JavaScript logic. It requires NO CHANGES for React. Keep it as-is and import the exported functions directly into your React components.

### `js/modules/store.test.js`
- **Lines of Code**: 206
- **Dependencies**: vitest, ./store.js
- **Category**: State Management / Business Logic
- **React Transition**: This file accesses the global `State` or `appStore`. Since `appStore` uses Zustand, it is already React-compatible (use `useStore` hook). For the vanilla `State` object, consider migrating it to a Zustand store or React Context to ensure UI components re-render when properties change. No DOM changes are needed.

### `js/modules/swearjar.js`
- **Lines of Code**: 10
- **Category**: Pure Logic
- **React Transition**: This file contains pure JavaScript logic. It requires NO CHANGES for React. Keep it as-is and import the exported functions directly into your React components.

### `js/modules/user-profile.js`
- **Lines of Code**: 269
- **Exports**: calculateCurrentStreak
- **Dependencies**: ./appwrite.js, ./api.js, ./storage-adapter.js
- **Category**: State Management / Business Logic
- **React Transition**: This file accesses the global `State` or `appStore`. Since `appStore` uses Zustand, it is already React-compatible (use `useStore` hook). For the vanilla `State` object, consider migrating it to a Zustand store or React Context to ensure UI components re-render when properties change. No DOM changes are needed.

### `js/modules/utils.js`
- **Lines of Code**: 26
- **Exports**: getLocalizedTranslation
- **Category**: Pure Logic
- **React Transition**: This file contains pure JavaScript logic. It requires NO CHANGES for React. Keep it as-is and import the exported functions directly into your React components.

### `js/modules/utils.test.js`
- **Lines of Code**: 39
- **Dependencies**: vitest, ./utils.js
- **Category**: Pure Logic
- **React Transition**: This file contains pure JavaScript logic. It requires NO CHANGES for React. Keep it as-is and import the exported functions directly into your React components.

### `js/modules/video-loader.js`
- **Lines of Code**: 2
- **Category**: Pure Logic
- **React Transition**: This file contains pure JavaScript logic. It requires NO CHANGES for React. Keep it as-is and import the exported functions directly into your React components.

### `js/modules/video-loader.web.js`
- **Lines of Code**: 125
- **Exports**: loadVideoForStep
- **Dependencies**: ../components/interactive-video-player.js, ../components/simple-video-player.js, ../components/intro-background-video.js, ../components/point-loss-animation.js, ./store.js, ../data/strings.js, ./utils.js
- **Category**: Platform Handler / Imperative Module (16 DOM interactions found)
- **React Transition**: This file mixes logic with DOM API access. You should refactor this to remove `document.getElementById` calls. Instead, the functions should accept React `Ref` objects (`ref.current`) or DOM nodes passed from the React components that render them. Initialization logic should be wrapped in `useEffect`.

### `js/modules/video-processor-logic.js`
- **Lines of Code**: 160
- **Exports**: VideoRenderPlanner
- **Category**: Pure Logic
- **React Transition**: This file contains pure JavaScript logic. It requires NO CHANGES for React. Keep it as-is and import the exported functions directly into your React components.

### `js/modules/video-processor.js`
- **Lines of Code**: 2
- **Category**: Pure Logic
- **React Transition**: This file contains pure JavaScript logic. It requires NO CHANGES for React. Keep it as-is and import the exported functions directly into your React components.

### `js/modules/video-processor.web.js`
- **Lines of Code**: 373
- **Dependencies**: ./storage.js, ./video-processor-logic.js, ./video-share.web.js
- **Category**: Platform Handler / Imperative Module (18 DOM interactions found)
- **React Transition**: This file mixes logic with DOM API access. You should refactor this to remove `document.getElementById` calls. Instead, the functions should accept React `Ref` objects (`ref.current`) or DOM nodes passed from the React components that render them. Initialization logic should be wrapped in `useEffect`.

### `js/modules/video-share.js`
- **Lines of Code**: 2
- **Category**: Pure Logic
- **React Transition**: This file contains pure JavaScript logic. It requires NO CHANGES for React. Keep it as-is and import the exported functions directly into your React components.

### `js/modules/video-share.web.js`
- **Lines of Code**: 141
- **Dependencies**: ../data/strings.js
- **Category**: Platform Handler / Imperative Module (3 DOM interactions found)
- **React Transition**: This file mixes logic with DOM API access. You should refactor this to remove `document.getElementById` calls. Instead, the functions should accept React `Ref` objects (`ref.current`) or DOM nodes passed from the React components that render them. Initialization logic should be wrapped in `useEffect`.

### `js/workers/nlp-worker-web.js`
- **Lines of Code**: 463
- **Dependencies**: @huggingface/transformers, wink-tokenizer
- **Recommendation**: This is a Web Worker. React does not natively change how Web Workers operate. Keep this file as Vanilla JS. In a React context, you will initialize this worker within a `useEffect` hook in a high-level component or context provider.

### `js/workers/whisper/app-vad-asr-web.js`
- **Lines of Code**: 123
- **Exports**: preloadWhisperEngine, transcribeAudioBuffer, analyzeAudioBufferWithVAD, stopWhisperEngine
- **Dependencies**: ../../modules/store.js
- **Recommendation**: This is a Web Worker. React does not natively change how Web Workers operate. Keep this file as Vanilla JS. In a React context, you will initialize this worker within a `useEffect` hook in a high-level component or context provider.

### `js/workers/whisper/audio-processor.js`
- **Lines of Code**: 15
- **Recommendation**: This is a Web Worker. React does not natively change how Web Workers operate. Keep this file as Vanilla JS. In a React context, you will initialize this worker within a `useEffect` hook in a high-level component or context provider.

### `js/workers/whisper/whisper-worker-demo.js`
- **Lines of Code**: 139
- **Dependencies**: @huggingface/transformers
- **Recommendation**: This is a Web Worker. React does not natively change how Web Workers operate. Keep this file as Vanilla JS. In a React context, you will initialize this worker within a `useEffect` hook in a high-level component or context provider.

### `js/workers/whisper/whisper-worker-web.js`
- **Lines of Code**: 231
- **Recommendation**: This is a Web Worker. React does not natively change how Web Workers operate. Keep this file as Vanilla JS. In a React context, you will initialize this worker within a `useEffect` hook in a high-level component or context provider.


### `index.html`
- **Lines of Code**: 2200+
- **Recommendation**: This file is the core wrapper for the entire application. It contains nested logic, hidden modals, and styling.
- **React Transition**: This file needs to be deleted and replaced with a React `App.jsx` and `Index.jsx` components. The raw HTML has been translated into `Index_react.jsx`. State management (like modal visibility, active tabs) should be handled via React `useState`. Self closing tags, attribute names (e.g., class vs className) have been updated to the JSX standard. Inline scripts have been moved to `useEffect`.
