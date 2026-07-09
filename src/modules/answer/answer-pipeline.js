// --- modules/answer-pipeline.js ---
// Core answer processing: validation, submission, feedback, and step progression.
// Uses deps pattern to avoid circular imports with lesson-progression.
// Deps: { loadNextStep, callLoadStep }

import { appStore, getCurrentVideoPlayer, setWebcamStream } from '../store/store.js';
import { getVideoUrl } from '../video/video-url.js';

// Module-level ref for intro continue handler, avoiding store callback anti-pattern
let _introContinueHandler = null;
export function setIntroContinueHandler(fn) { _introContinueHandler = fn; }
export function getIntroContinueHandler() { return _introContinueHandler; }
import {
    getCurrentStepIndex,
    processAnswerLogic,
    validateAnswerPrecheck,
    findMatchingCueText
} from './answers.js';
import { logInteraction, calculateFluencyScore } from './scoring.js';
import Strings from '../../data/strings.js';
import { getCueText, getLocalizedTranslation, getLocalizedCueTranslation, generateHangmanOps } from '../utils/utils.js';
import { analyzeSpeech } from '../utils/analytics.js';
import { saveSpeechRecording, updateSpeechRecording } from '../storage/storage.js';
import { buildFeedbackData, buildExplanationData } from './feedback-builder.js';
import { getNextStep } from '../lesson/lesson-routing.js';
import getRandomPraise from '../../data/praise.js';
import { getBotIdentity } from '../user/bot-identity.js';
import teacherAvatarUrl from '../../assets/img/teacherprofile.webp';
import userAvatarUrl from '../../assets/img/userprofile.png';
import aiAvatarUrl from '../../assets/img/ai.webp';
import { trackEvent } from '../utils/posthog.js';

function mapSectionToMessage(section) {
    if (section.type === 'grammar') {
        return {
            role: 'system',
            type: 'grammarDiff',
            sectionKey: 'grammar',
            score: section.score,
            isPerfect: section.score === 100,
            errorCount: section.errorCount,
            original: section.diff?.original || '',
            correction: section.diff?.corrected || ''
        };
    }
    if (section.type === 'vocab') {
        return {
            role: 'system',
            type: 'vocabDiff',
            sectionKey: 'vocabulary',
            score: section.score,
            isPerfect: section.score === 100,
            errorCount: section.errorCount,
            original: section.diff?.original || '',
            correction: section.diff?.corrected || ''
        };
    }
    if (section.key === 'vocabulary') {
        const vocabPart = section.parts && section.parts[0];
        return {
            role: 'system',
            type: 'stat',
            sectionKey: 'vocabulary',
            score: section.score,
            isPerfect: section.score === 100,
            isOverall: false,
            parts: vocabPart ? [{
                display: 'block',
                type: 'idioms',
                count: vocabPart.idiomCount || 0,
                items: vocabPart.idioms || []
            }] : []
        };
    }
    if (section.key === 'flow') {
        return {
            role: 'system',
            type: 'stat',
            sectionKey: 'flow',
            score: section.score,
            isPerfect: section.score === 100,
            isOverall: false,
            parts: (section.parts || []).map(p => ({
                display: 'inline',
                label: p.label,
                value: p.value
            }))
        };
    }
    return {
        role: 'system',
        type: 'stat',
        sectionKey: section.key,
        score: section.score,
        isPerfect: section.score === 100,
        isOverall: !!section.isOverall,
        attemptLabel: section.attemptLabel,
        attemptCount: section.attemptCount,
        parts: (section.parts || []).map(p => {
            if (p.type === 'notice') {
                return { display: 'block', type: 'notice', message: p.message };
            }
            if (p.message) {
                return { display: 'block', message: p.message };
            }
            return { display: 'block', label: p.label, value: p.value };
        })
    };
}

function getExplanationMessages(explanationData) {
    if (!explanationData) return [];
    if (explanationData.useFallback) {
        if (!explanationData.fallback) return [];
        return [{
            role: 'system',
            type: 'standard',
            content: explanationData.fallback
        }];
    }
    return explanationData.chunks.map(chunk => {
        if (chunk.type === 'message' || chunk.type === 'raw') {
            return {
                role: 'system',
                type: 'standard',
                content: chunk.content
            };
        }
        if (chunk.type === 'pragmatics') {
            return {
                role: 'system',
                type: 'pragmatics',
                header: chunk.header,
                correction: chunk.correction
            };
        }
        return null;
    }).filter(Boolean);
}

function applySpeechResultToPlayer(val, player) {
    const cueTokens = [];
    player.tokens.forEach((token, idx) => {
        if (player.punctuationMap.get(idx)) return;
        cueTokens.push({
            clean: token.toLowerCase().replace(/[^\w\s']/g, ''),
            idx
        });
    });

    const userWords = val.toLowerCase().replace(/[^\w\s']/g, '').split(/\s+/);
    const correctIndices = [];
    const extraWrongWords = [];

    let cuePos = 0;
    for (let userPos = 0; userPos < userWords.length; userPos++) {
        const userWord = userWords[userPos];
        let found = -1;
        for (let i = cuePos; i < cueTokens.length; i++) {
            if (cueTokens[i].clean === userWord) {
                found = i;
                break;
            }
        }
        if (found !== -1) {
            correctIndices.push(cueTokens[found].idx);
            cuePos = found + 1;
        } else {
            const position = cuePos < cueTokens.length ? cueTokens[cuePos].idx : null;
            extraWrongWords.push({ text: userWord, position });
        }
    }

    player.applySpeechResult(correctIndices, [], extraWrongWords);
}

export function createAnswerPipeline(deps) {
    const {
        showChat,
        clearChat,
        addAIFeedbackMessages,
        playSound,
        enableAudioSystem,
        preloadVideo,
        warmUpSpeechCam,
    } = deps;

    function handleCorrectFeedbackUI(stepIndex, stepData, button, cue, explanation, userResponse, courseLevel, englishLevelDeduction, userData, configData, fluencyBubble = null) {
        const cueText = getCueText(cue);
        const lang = userData?.native_language || appStore.getState().userData?.native_language || 'en';

        const currentFluencyScore = appStore.getState().fluencyScore;
        if (stepData.responseType === "closedResponse" && stepData.interactiveVideoUrl) {
            appStore.setState({ repeatPointsHistory: [...appStore.getState().repeatPointsHistory, currentFluencyScore] });
            console.log('[scoring] append repeatPointsHistory', { currentFluencyScore, repeatPointsHistory: appStore.getState().repeatPointsHistory });
        }
        // friendClosedResponse: no scoring — omit repeatPointsHistory append.
        if (stepData.responseType === "openResponse" && stepData.interactiveVideoUrl) {
            appStore.setState({ rolePlayPointsHistory: [...appStore.getState().rolePlayPointsHistory, currentFluencyScore] });
            console.log('[scoring] append rolePlayPointsHistory', { currentFluencyScore, rolePlayPointsHistory: appStore.getState().rolePlayPointsHistory });
        }

        showChat();

        const praiseResult = (stepData.responseType === "openResponse" || stepData.responseType === "closedResponse" || stepData.responseType === "friendClosedResponse") ? getRandomPraise('general', lang) : "";
        const feedbackText = (stepData.responseType === "openResponse" && englishLevelDeduction > 0)
            ? (() => {
                const acceptable = Strings.getBilingual('ai_acceptable', lang);
                const level = Strings.getBilingual('ai_course_level', lang);
                const reduced = Strings.getBilingual('ai_fluency_reduced', lang);
                const points = Strings.getBilingual('ai_percentage_points', lang);
                const english = `${acceptable.english}. ${level.english} ${courseLevel}. ${reduced.english} ${englishLevelDeduction} ${points.english}.`;
                const hasTrans = acceptable.localized && level.localized && reduced.localized && points.localized;
                const translation = hasTrans
                    ? `${acceptable.localized}. ${level.localized} ${courseLevel}. ${reduced.localized} ${englishLevelDeduction} ${points.localized}.`
                    : undefined;
                return { type: 'text', text: english, translation, translationLang: translation ? lang : undefined };
            })()
            : praiseResult;

        if (stepData.responseType !== "openResponse" && stepData.responseType !== "closedResponse" && stepData.responseType !== "friendClosedResponse") {
            const localizedCue = getLocalizedTranslation(cue, lang);
            const userName = appStore.getState().userData?.display_name?.split(' ')[0] || 'User';
            const localAvatarUrl = appStore.getState().userData?.profilePictureUrl || userAvatarUrl;

            appStore.getState().addChatMessage({
                role: 'user',
                type: 'standard',
                content: cueText,
                translation: localizedCue,
                translationLang: (localizedCue && lang && lang !== 'en') ? lang : undefined,
                userName,
                userAvatarUrl: localAvatarUrl
            });

            if (explanation && explanation.length > 0) {
                addAIFeedbackMessages(explanation);
            }

            if (fluencyBubble) {
                addAIFeedbackMessages([fluencyBubble]);
            }

            const immediatePraise = getRandomPraise('general', lang);
            if (immediatePraise.type === 'image') {
                appStore.getState().addChatMessage({
                    role: 'system',
                    type: 'praise',
                    praiseData: immediatePraise,
                    botName: 'Joe Walsh',
                    avatarUrl: teacherAvatarUrl
                });
            } else {
                const msg = {
                    role: 'system',
                    type: 'standard',
                    content: immediatePraise.text || immediatePraise,
                    botName: 'Joe Walsh',
                    avatarUrl: teacherAvatarUrl
                };
                if (immediatePraise.translation) {
                    msg.translation = immediatePraise.translation;
                    msg.translationLang = immediatePraise.translationLang;
                }
                appStore.getState().addChatMessage(msg);
            }

            if (stepData.headsUp) {
                appStore.getState().addChatMessage({
                    role: 'system',
                    type: 'standard',
                    content: stepData.headsUp,
                    botName: 'Joe Walsh',
                    avatarUrl: teacherAvatarUrl
                });
            }
        } else {
            if (explanation && explanation.length > 0) {
                addAIFeedbackMessages(explanation);
            }

            if (fluencyBubble) {
                addAIFeedbackMessages([fluencyBubble]);
            }

            if (feedbackText) {
                if (feedbackText.type === 'image') {
                    appStore.getState().addChatMessage({
                        role: 'system',
                        type: 'praise',
                        praiseData: feedbackText,
                        botName: 'Joe Walsh',
                        avatarUrl: teacherAvatarUrl
                    });
                } else {
                    const msg = {
                        role: 'system',
                        type: 'standard',
                        content: feedbackText.text || feedbackText,
                        botName: 'Joe Walsh',
                        avatarUrl: teacherAvatarUrl
                    };
                    if (feedbackText.translation) {
                        msg.translation = feedbackText.translation;
                        msg.translationLang = feedbackText.translationLang;
                    }
                    appStore.getState().addChatMessage(msg);
                }
            }
            if (stepData.headsUp) {
                appStore.getState().addChatMessage({
                    role: 'system',
                    type: 'standard',
                    content: stepData.headsUp,
                    botName: 'Joe Walsh',
                    avatarUrl: teacherAvatarUrl
                });
            }
        }

        playSound('correct-sound');
    }

    function handleIncorrectFeedbackUI(stepIndex, stepData, button, cue, userResponse, explanation, normalizeduserResponse, normalizedcue, step, silent = false, userData, configData, matchedCue = null, fluencyBubble = null) {
        const cueText = getCueText(cue);
        appStore.getState().incrementIncorrectAttempts();

        if (!silent && !appStore.getState().isTextMode && (stepData.responseType === "lessonIntro" || stepData.responseType === "closedResponse" || stepData.responseType === "openResponse" || stepData.responseType === "friendClosedResponse")) {
            const storeState = appStore.getState();
            const hasVideoBubble = storeState.chatHistory.some(msg => msg.type === 'video');
            if (!hasVideoBubble) {
                storeState.addChatMessage({
                    role: 'user',
                    type: 'video',
                    userName: storeState.userData?.display_name?.split(' ')[0] || 'User',
                    userAvatarUrl: storeState.userData?.profilePictureUrl || userAvatarUrl
                });
            } else {
                appStore.getState().triggerVideoPlay(storeState.isPlaybackMuted);
            }
        }

        if ((stepData.responseType === "closedResponse" || stepData.responseType === "openResponse") && stepData.interactiveVideoUrl) {
            appStore.getState().deductListeningScore(25);
            appStore.getState().triggerPointLoss('listening', 25);
            if (appStore.getState().incorrectAttempts > 2) {
                appStore.getState().setListeningScore(0);
                appStore.setState({ rolePlayPointsHistory: [...appStore.getState().rolePlayPointsHistory, appStore.getState().listeningScore] });
            }
        }
        // friendClosedResponse: no scoring — omit the listening point deductions above.

        const isSilentSpeechRetry = silent && stepData.responseType === "closedResponse";

        if (isSilentSpeechRetry) {
            return;
        }

        const lang = userData?.native_language || appStore.getState().userData?.native_language || 'en';

        if (stepData.responseType === "openResponse" && userResponse) {
            if (appStore.getState().incorrectAttempts > 2) {
                appStore.getState().setListeningScore(0);
                appStore.setState({ rolePlayPointsHistory: [...appStore.getState().rolePlayPointsHistory, appStore.getState().listeningScore] });
            }

            const teacherKey = appStore.getState().incorrectAttempts === 1
                ? 'try_again_1'
                : appStore.getState().incorrectAttempts === 2
                    ? 'try_again_2'
                    : 'failed_continue_correct';
            const teacherBilingual = Strings.getBilingual(teacherKey, lang);
            const teacherTranslation = appStore.getState().incorrectAttempts > 2
                ? getLocalizedTranslation(cue, lang)
                : undefined;

            if (explanation && explanation.length > 0) {
                addAIFeedbackMessages(explanation);
            }

            appStore.getState().addChatMessage({
                role: 'system',
                type: 'teacherFeedback',
                content: teacherBilingual.english,
                translation: teacherBilingual.localized || teacherTranslation,
                translationLang: (teacherBilingual.localized || teacherTranslation) ? teacherBilingual.lang : undefined,
                botName: 'Joe Walsh',
                avatarUrl: teacherAvatarUrl
            });

            if (fluencyBubble) {
                addAIFeedbackMessages([fluencyBubble]);
            }

            if (stepData.possibleAnswer && appStore.getState().incorrectAttempts > 2) {
                const labelBilingual = Strings.getBilingual('example_correct_answer', lang);
                appStore.getState().addChatMessage({
                    role: 'system',
                    type: 'possibleAnswer',
                    label: labelBilingual.english || 'A possible answer:',
                    answer: stepData.possibleAnswer,
                    translation: labelBilingual.localized,
                    translationLang: labelBilingual.localized ? labelBilingual.lang : undefined,
                    botName: 'Joe Walsh',
                    avatarUrl: teacherAvatarUrl
                });
            }

            if (stepData.headsUp) {
                const isLowAttempt = appStore.getState().incorrectAttempts <= 2;
                const headsUpBilingual = isLowAttempt ? Strings.getBilingual('heads_up_try_again', lang) : null;
                const headsUpContent = isLowAttempt ? headsUpBilingual.english : stepData.headsUp;
                appStore.getState().addChatMessage({
                    role: 'system',
                    type: 'standard',
                    content: headsUpContent,
                    translation: isLowAttempt ? headsUpBilingual.localized : undefined,
                    translationLang: isLowAttempt && headsUpBilingual.localized ? headsUpBilingual.lang : undefined,
                    botName: 'Joe Walsh',
                    avatarUrl: teacherAvatarUrl
                });
            }
        }

        if ((stepData.responseType === "closedResponse" || stepData.responseType === "friendClosedResponse") && userResponse) {
            const selectedWords = [...new Set(normalizeduserResponse.split(/\s+/))];
            const correctWords = [...new Set(normalizedcue.split(/\s+/))];
            const correctWordSet = new Set(correctWords.map(w => w.toLowerCase()));
            const correct = new Set(); const incorrect = new Set();

            selectedWords.forEach(w => correctWordSet.has(w.toLowerCase()) ? correct.add(w) : incorrect.add(w));

            const teacherKey = appStore.getState().incorrectAttempts > 2
                ? 'failed_continue_correct'
                : appStore.getState().incorrectAttempts === 1
                    ? 'try_again_1'
                    : 'try_again_2';
            const teacherBilingual = Strings.getBilingual(teacherKey, lang);

            if (explanation && explanation.length > 0) {
                addAIFeedbackMessages(explanation);
            }

            let teacherContent = teacherBilingual.english;
            let teacherTranslation = teacherBilingual.localized;

            if (appStore.getState().incorrectAttempts > 2) {
                const displayCue = matchedCue || cueText;
                const cueLocalized = getLocalizedCueTranslation(cue, matchedCue, lang);
                teacherContent = teacherBilingual.english + ' ' + displayCue;
                teacherTranslation = teacherBilingual.localized
                    ? teacherBilingual.localized + (cueLocalized ? ' ' + cueLocalized : '')
                    : null;
            }

            appStore.getState().addChatMessage({
                role: 'system',
                type: 'teacherFeedback',
                content: teacherContent,
                translation: teacherTranslation,
                translationLang: teacherBilingual.localized ? teacherBilingual.lang : undefined,
                correctWords: Array.from(correct),
                incorrectWords: Array.from(incorrect),
                botName: 'Joe Walsh',
                avatarUrl: teacherAvatarUrl
            });

            if (fluencyBubble) {
                addAIFeedbackMessages([fluencyBubble]);
            }

            const isLowAttemptHeadsUp = appStore.getState().incorrectAttempts <= 2;
            const headsUpBilingual = isLowAttemptHeadsUp && stepData.headsUp
                ? Strings.getBilingual('heads_up_repeat_video', lang)
                : null;
            const headsUpStr = stepData.headsUp
                ? (isLowAttemptHeadsUp ? headsUpBilingual.english : stepData.headsUp)
                : '';
            if (headsUpStr) {
                appStore.getState().addChatMessage({
                    role: 'system',
                    type: 'standard',
                    content: headsUpStr,
                    translation: isLowAttemptHeadsUp && headsUpBilingual?.localized ? headsUpBilingual.localized : undefined,
                    translationLang: isLowAttemptHeadsUp && headsUpBilingual?.localized ? headsUpBilingual.lang : undefined,
                    botName: 'Joe Walsh',
                    avatarUrl: teacherAvatarUrl
                });
            }
        }

        if (!silent) {
            playSound('incorrect-sound');
        }
    }

    function resetButtonState(button) {
        appStore.getState().setSubmitBtnDisabled(false);
        appStore.getState().setSubmitBtnIcon(appStore.getState().isTextMode ? 'send' : 'mic');
        appStore.getState().setSubmitBtnDanger(false);
        appStore.getState().setInputDisabled(false);
        appStore.getState().triggerInputFocus();
    }

    async function submitAnswerPrecheck(val, cue, stepData, btn, explanation, stats = { pauseCount: null, netDuration: null }, _deps = {}, userData = appStore.getState().userData, configData = appStore.getState().configData, courseId = appStore.getState().courseId) {
        const courseLevel = configData?.courseLevel || 'A0';
        const { isValid, warningMessage } = await validateAnswerPrecheck(
            val, cue, stepData, courseLevel, userData, appStore.getState().responsesGiven
        );

        if (!isValid) {
            const cueText = getCueText(cue);
            trackEvent('answer_rejected', {
                reason: warningMessage,
                is_text_mode: appStore.getState().isTextMode,
                step_type: stepData.responseType,
            });
            logInteraction(cueText, val, "rej_pre", warningMessage, null, appStore.getState().interactionLog);
            if (!appStore.getState().isTextMode) {
                appStore.getState().deductSpeakingScore(10);
                appStore.getState().triggerPointLoss('pronunciation', 10);
            } else {
                console.log('[submitAnswerPrecheck] Text mode: skipping speaking score deduction');
            }

            appStore.getState().setSystemMessage({ type: 'danger', text: warningMessage });

            if (appStore.getState().isTextMode) {
                appStore.getState().setAnswerErrorMessage(warningMessage);
                appStore.getState().triggerVideoClear();
                setWebcamStream(null);
                appStore.getState().setInputDisabled(false);
                appStore.getState().setSubmitBtnDisabled(false);
                appStore.getState().triggerInputFocus();
                appStore.getState().triggerScoreUpdate();
            }

            const currentLessonId = appStore.getState().activeLessonId
                || (configData?.lessons?.[appStore.getState().currentLessonIndex]?.lessonId)
                || 'unknown_lesson';
            const stepIndex = getCurrentStepIndex(stepData, configData, appStore.getState().currentLessonIndex);

            let matchedCue = null;
            if (stepData.responseType === "closedResponse" || stepData.responseType === "friendClosedResponse") {
                matchedCue = await findMatchingCueText(val, cue, stepData);
            }

            const lang = userData?.native_language || appStore.getState().userData?.native_language || 'en';
            const translation = getLocalizedCueTranslation(cue, matchedCue, lang);

            if (appStore.getState().isTextMode) {
                await saveSpeechRecording(null, {
                    lessonId: currentLessonId,
                    stepIndex,
                    userResponse: val,
                    isTextMode: true,
                    duration: 3,
                    cue: getCueText(cue),
                    ...(matchedCue ? { matchedCue } : {}),
                    ...(translation ? { translation } : {}),
                });
            }

            await updateSpeechRecording(currentLessonId, stepIndex, {
                userResponse: val,
                cue: getCueText(cue),
                ...(matchedCue ? { matchedCue } : {}),
                ...(translation ? { translation } : {}),
                isTextMode: appStore.getState().isTextMode,
                duration: appStore.getState().isTextMode ? 3 : null
            });

            const player = getCurrentVideoPlayer();
            if ((stepData.responseType === "closedResponse" || stepData.responseType === "friendClosedResponse") && player && typeof player.applySpeechResult === 'function') {
                applySpeechResultToPlayer(val, player);
            }

            appStore.getState().setSubmitBtnDisabled(false);
            return;
        }

        const player = getCurrentVideoPlayer();
        if ((stepData.responseType === "closedResponse" || stepData.responseType === "friendClosedResponse") && player && typeof player.applySpeechResult === 'function') {
            applySpeechResultToPlayer(val, player);
        }

        await handleAnswer(val, cue, stepData, btn, explanation, stats, _deps, userData, configData, courseId);
    }

    async function handleAnswer(userResponse, cue, stepData, button, explanation, stats = { pauseCount: null, netDuration: null }, _deps = {}, userData = appStore.getState().userData, configData = appStore.getState().configData, courseId = appStore.getState().courseId) {
        const cueText = getCueText(cue);
        let matchedCue = null;
        if (!appStore.getState().isTextMode && (stepData.responseType === "lessonIntro" || stepData.responseType === "closedResponse" || stepData.responseType === "openResponse" || stepData.responseType === "friendClosedResponse")) {
            const storeState = appStore.getState();
            const hasVideoBubble = storeState.chatHistory.some(msg => msg.type === 'video');
            if (!hasVideoBubble) {
                storeState.addChatMessage({
                    role: 'user',
                    type: 'video',
                    userName: storeState.userData?.display_name?.split(' ')[0] || 'User',
                    userAvatarUrl: storeState.userData?.profilePictureUrl || userAvatarUrl
                });
            } else {
                appStore.getState().triggerVideoPlay(storeState.isPlaybackMuted);
            }
        }

        let speechAnalytics = null;
        let cleanWordCount = 0;
        const stepIndex = getCurrentStepIndex(stepData, configData, appStore.getState().currentLessonIndex);

        try {
            const currentLessonId = (configData && configData.lessons && configData.lessons[appStore.getState().currentLessonIndex]) ? configData.lessons[appStore.getState().currentLessonIndex].lessonId : 'unknown_lesson';

            if (stepData.responseType === "closedResponse" || stepData.responseType === "openResponse" || stepData.responseType === "friendClosedResponse") {
                cleanWordCount = userResponse.replace(/[^\w\s]/g, '').trim().split(/\s+/).filter(Boolean).length;

                if (stats && stats.netDuration !== null) {
                    speechAnalytics = await analyzeSpeech(userResponse, stats.netDuration, stats.pauseCount, configData?.courseLevel || 'A1', stepData.responseType);
                    if (speechAnalytics && stats.hesitation !== undefined) {
                        speechAnalytics.hesitation = stats.hesitation;
                    }
                } else {
                    speechAnalytics = {};
                }

                if (appStore.getState().isTextMode) {
                    if (speechAnalytics) {
                        speechAnalytics.pronunciationScore = null;
                        speechAnalytics.flowScore = null;
                        speechAnalytics.wpm = 0;
                        speechAnalytics.pauseCount = 0;
                        speechAnalytics.netDuration = 3;
                    }
                    console.log('[handleAnswer] Text mode: overridden speech metrics for scoring');
                }

                // For closedResponse, find which specific cue variant matches the user's speech
                // so the canonical display text (not the raw template/pattern) can be used
                // in the whisper review, chat bubble, and end-of-lesson video subtitles.
                if (stepData.responseType === "closedResponse" || stepData.responseType === "friendClosedResponse") {
                    matchedCue = await findMatchingCueText(userResponse, cue, stepData);
                }

                const lang = userData?.native_language || appStore.getState().userData?.native_language || 'en';
                const translation = getLocalizedCueTranslation(cue, matchedCue, lang);

                if (appStore.getState().isTextMode) {
                    await saveSpeechRecording(null, {
                        lessonId: currentLessonId,
                        stepIndex,
                        userResponse,
                        isTextMode: true,
                        duration: 3,
                        cue: cueText,
                        ...(matchedCue ? { matchedCue } : {}),
                        ...(translation ? { translation } : {}),
                    });
                }

                await updateSpeechRecording(currentLessonId, stepIndex, {
                    userResponse,
                    cue: cueText,
                    ...(matchedCue ? { matchedCue } : {}),
                    ...(translation ? { translation } : {}),
                    wpm: appStore.getState().isTextMode ? 0 : (speechAnalytics?.wpm || 0),
                    pauseCount: appStore.getState().isTextMode ? 0 : (speechAnalytics?.pauseCount || 0),
                    complexityScore: speechAnalytics?.complexityScore || 100,
                    isTextMode: appStore.getState().isTextMode,
                    duration: appStore.getState().isTextMode ? 3 : (speechAnalytics?.netDuration || null)
                });
                console.log("Successfully updated speech recording with answers");
            }
        } catch (e) {
            console.error("Error updating speech recording with answers", e);
        }

        appStore.getState().triggerPauseAllVideos();
        appStore.getState().setMicActive(false);
        appStore.getState().setSystemMessage(null);
        appStore.getState().setMediaVisible(false);
        appStore.getState().setTextInputVisible(false);
        appStore.getState().setHintsVisible(false);

        // Show user message + cue bubble immediately before API call returns.
        // Stats bubbles (addAIFeedbackMessages) arrive later in the openResponse block.
        if (stepData.responseType === "openResponse" && userResponse) {
            const lang = userData?.native_language || appStore.getState().userData?.native_language || 'en';
            console.log('[handleAnswer] openResponse lang:', lang, 'cue:', typeof cue, 'native_language:', userData?.native_language);

            appStore.getState().addChatMessage({
                role: 'system',
                type: 'standard',
                content: cueText,
                translation: getLocalizedTranslation(cue, lang),
                translationLang: (getLocalizedTranslation(cue, lang) && lang !== 'en') ? lang : undefined,
                botName: 'Joe Walsh',
                avatarUrl: teacherAvatarUrl
            });

            showChat();
            appStore.getState().transitionTo('feedback');

            const hasUserTextBubble = appStore.getState().chatHistory.some(
                msg => msg.role === 'user' && msg.type === 'standard'
            );
            if (!hasUserTextBubble) {
                appStore.getState().addChatMessage({
                    role: 'user',
                    type: 'standard',
                    content: userResponse,
                    userName: userData?.display_name?.split(' ')[0] || 'User',
                    userAvatarUrl: userData?.profilePictureUrl || userAvatarUrl
                });
            }
        }

        let immediateStatsMessages = [];
        let fluencyBubble = null;

        try {
            const courseLevel = configData?.courseLevel || 'A0';
            const lesson = (configData && configData.lessons) ? configData.lessons[appStore.getState().currentLessonIndex] : null;
            console.log('[pipeline] lesson ', lesson);
            if (!lesson) {
                console.error('[handleAnswer] DEBUG:', {
                    configDataKeys: configData ? Object.keys(configData) : null,
                    lessonCount: configData?.lessons?.length,
                    currentLessonIndex: appStore.getState().currentLessonIndex,
                    activeLessonId: appStore.getState().activeLessonId,
                    courseId: appStore.getState().courseId,
                    firstLessonId: configData?.lessons?.[0]?.lessonId,
                    hasSteps: configData?.lessons?.[0]?.steps ? 'yes' : 'no',
                    hasQuestions: configData?.lessons?.[0]?.questions ? 'yes' : 'no'
                });
                throw new Error("configData or lessons missing in handleAnswer");
            }

            let result = null;
            if (stepData.responseType === "closedResponse" || stepData.responseType === "openResponse" || stepData.responseType === "friendClosedResponse") {
                result = await processAnswerLogic({
                    userResponse, cue, stepData,
                    lesson: lesson,
                    courseLevel: courseLevel,
                    userData: userData,
                    apiRoot: null
                });

                if (!result) {
                    console.warn("  No result from local NLP — no Gemini fallback active. Treating as passed.");
                    result = { isCorrect: true, normalizeduserResponse: userResponse, normalizedcue: cueText, explanation: explanation, intentLabels: [] };
                }
            }

            const isCorrect = result ? result.isCorrect : true;
            let grammarCorrection = null;

            if (result && result.explanations) {
                const diffObj = result.explanations.find(e => e.type === 'grammar_diff');
                if (diffObj && diffObj.correction) grammarCorrection = diffObj.correction;
            }

            trackEvent('answer_submitted', {
                is_correct: isCorrect,
                step_type: stepData.responseType,
                is_text_mode: appStore.getState().isTextMode,
                word_count: cleanWordCount,
                attempt_number: appStore.getState().incorrectAttempts + 1,
                fluency_score: appStore.getState().fluencyScore,
                course_level: configData?.courseLevel,
                wpm: speechAnalytics?.wpm,
                pause_count: stats.pauseCount,
            });

            let status = isCorrect ? "ok" : "inc";
            let pragmaticDetails = result?.intentLabels?.length > 0 ? result.intentLabels : null;
            logInteraction(cueText, userResponse, status, pragmaticDetails, grammarCorrection, appStore.getState().interactionLog);

            if (result?.foundIdioms?.length > 0) {
                result.foundIdioms.forEach(id => appStore.getState().addRecognizedIdiom(id));
            }
            if (result?.intentLabels?.length > 0) {
                result.intentLabels.forEach(label => appStore.getState().addPragmaticFlag(label));
            }

            const { listeningScore, speakingScore, incorrectAttempts, whisperRejections } = appStore.getState();

            if ((stepData.responseType === "closedResponse" || stepData.responseType === "openResponse") && stepData.responseType !== "friendClosedResponse") {
                const attemptNumber = incorrectAttempts + 1;
                let grammarErrorScore = 100;

                if (result && result.explanations) {
                    const grammarDiffObj = result.explanations.find(e => e.type === 'grammar_diff');
                    if (grammarDiffObj) {
                        grammarErrorScore = 0;
                    }
                }

                const scoreData = calculateFluencyScore({
                    pronunciationScore: speakingScore,
                    listeningScore: listeningScore,
                    wpm: speechAnalytics?.wpm || 0,
                    pauseCount: stats.pauseCount || 0,
                    hesitation: speechAnalytics?.hesitation || 0,
                    wordCount: cleanWordCount,
                    idiomCount: speechAnalytics?.foundIdioms ? speechAnalytics.foundIdioms.length : 0,
                    courseLevel: courseLevel,
                    grammarErrorScore: grammarErrorScore,
                    labels: result && result.intentLabels ? result.intentLabels : [],
                    attemptNumber: attemptNumber,
                    isTextMode: appStore.getState().isTextMode
                });
                console.log('[scoring] calculateFluencyScore', {
                    pronunciationScore: speakingScore,
                    listeningScore: listeningScore,
                    wpm: speechAnalytics?.wpm || 0,
                    pauseCount: stats.pauseCount || 0,
                    hesitation: speechAnalytics?.hesitation || 0,
                    idiomCount: speechAnalytics?.foundIdioms ? speechAnalytics.foundIdioms.length : 0,
                    courseLevel: courseLevel,
                    grammarErrorScore,
                    labels: result && result.intentLabels ? result.intentLabels : [],
                    attemptNumber,
                    isTextMode: appStore.getState().isTextMode,
                    scoreData
                });

                appStore.getState().setFluencyMetrics({
                    fluencyScore: scoreData.fluencyScore,
                    flowScore: scoreData.subScores.flow,
                    vocabularyScore: scoreData.subScores.vocabulary,
                    grammarScore: scoreData.subScores.grammar,
                    formalityScore: scoreData.subScores.formality,
                    nativeLikeScore: scoreData.subScores.nativeLike,
                    understandingScore: scoreData.subScores.understanding
                });
                console.log('[scoring] setFluencyMetrics applied', {
                    fluencyScore: appStore.getState().fluencyScore,
                    flowScore: appStore.getState().flowScore,
                    vocabularyScore: appStore.getState().vocabularyScore,
                    grammarScore: appStore.getState().grammarScore,
                    formalityScore: appStore.getState().formalityScore,
                    nativeLikeScore: appStore.getState().nativeLikeScore,
                    understandingScore: appStore.getState().understandingScore
                });

                const feedbackData = buildFeedbackData({
                    scoreData, speechAnalytics, result, stepData,
                    lang: userData?.native_language, courseLevel,
                    attemptNumber: incorrectAttempts + 1,
                    repetitionCount: appStore.getState().videoPlays,
                    whisperRejections: whisperRejections
                });

                const allFeedbackMessages = (feedbackData.sections || []).map(mapSectionToMessage);

                if (allFeedbackMessages.length > 0 && allFeedbackMessages[0].isOverall) {
                    fluencyBubble = allFeedbackMessages[0];
                    immediateStatsMessages = allFeedbackMessages.slice(1);
                } else {
                    immediateStatsMessages = allFeedbackMessages;
                }
            }
            // friendClosedResponse: no scoring — skip calculateFluencyScore, setFluencyMetrics,
            // and buildFeedbackData entirely. immediateStatsMessages stays empty.

            if (!isCorrect && ((stepData.responseType === "closedResponse" && incorrectAttempts < 2) || stepData.responseType === "friendClosedResponse")) {
                const explanationData = buildExplanationData(result.explanations || explanation, explanation);
                const structuredExplanations = getExplanationMessages(explanationData);

                handleIncorrectFeedbackUI(stepIndex, stepData, button, cue, userResponse, structuredExplanations, result.normalizeduserResponse, result.normalizedcue, stepData.step, true, userData, configData, matchedCue);
                appStore.getState().clearPlaybackBlob();
                appStore.getState().clearRecordedAudioPeaks();
                appStore.getState().triggerVideoClear();
                clearChat();
                setWebcamStream(null);

                if (!stepData.interactiveVideoUrl) {
                    const hangmanOps = generateHangmanOps(userResponse, result.rawCue || result.normalizedcue || cueText);
                    appStore.getState().setHangmanOps(hangmanOps);
                    appStore.getState().setHintsVisible(true);
                }
                appStore.getState().setMediaVisible(true);

                const player = getCurrentVideoPlayer();
                if (player && typeof player.replay === 'function') {
                    player.replay();
                }

                appStore.getState().setSystemMessage({ type: 'info', text: stepData.step || '' });
                appStore.getState().transitionTo('recording/answering');
                resetButtonState(button);
                return;
            }

            if (stepData.responseType === "openResponse" && userResponse) {
                // User message + cue bubble were dispatched immediately before the API call.
                // Now that scoring is complete, append the stats bubbles.
                if (immediateStatsMessages.length > 0) addAIFeedbackMessages(immediateStatsMessages);
            } else if ((stepData.responseType === "closedResponse" || stepData.responseType === "friendClosedResponse") && userResponse) {
                const lang = userData?.native_language || appStore.getState().userData?.native_language || 'en';

                showChat();
                appStore.getState().transitionTo('feedback');

                const translation = getLocalizedCueTranslation(cue, matchedCue, lang);
                const userTextContent = matchedCue || cueText;
                const hasUserTextBubble = appStore.getState().chatHistory.some(
                    msg => msg.role === 'user' && msg.type === 'standard'
                );
                if (!hasUserTextBubble) {
                    appStore.getState().addChatMessage({
                        role: 'user',
                        type: 'standard',
                        content: userTextContent,
                        translation,
                        translationLang: (translation && lang !== 'en') ? lang : undefined,
                        userName: userData?.display_name?.split(' ')[0] || 'User',
                        userAvatarUrl: userData?.profilePictureUrl || userAvatarUrl
                    });
                }

                if (immediateStatsMessages.length > 0) addAIFeedbackMessages(immediateStatsMessages);
            }

            const explanationData = buildExplanationData(result?.explanations, explanation);
            const structuredExplanations = getExplanationMessages(explanationData);

            appStore.getState().setTutorChatVisible(true);

            if (isCorrect) {
                if (stepData.responseType === "openResponse") {
                    appStore.setState({ responsesGiven: [...appStore.getState().responsesGiven, result.normalizeduserResponse] });
                    if (result.cefrLevelDeduction > 0) {
                        appStore.getState().deductListeningScore(result.cefrLevelDeduction);
                    }
                }
                handleCorrectFeedbackUI(stepIndex, stepData, button, cue, structuredExplanations, userResponse, courseLevel, result ? result.cefrLevelDeduction : undefined, userData, configData, fluencyBubble);
                showFeedbackAndProceed(stepData, isCorrect, _deps);
            } else {
                appStore.getState().clearPlaybackBlob();
                appStore.getState().clearRecordedAudioPeaks();
                handleIncorrectFeedbackUI(stepIndex, stepData, button, cue, userResponse, structuredExplanations, result ? result.normalizeduserResponse : "", result ? result.normalizedcue : "", stepData.step, false, userData, configData, matchedCue, fluencyBubble);
                showFeedbackAndProceed(stepData, isCorrect, _deps);
            }

        } catch (error) {
            console.error("Error handling answer:", error);
            handleIncorrectFeedbackUI(stepIndex, stepData, button, cue, userResponse, explanation, "", "", stepData.step, false, userData, configData);
            showFeedbackAndProceed(stepData, false, _deps);
        }
    }

    function showFeedbackAndProceed(stepData, isCorrect, _deps = {}) {
        const { loadNextStep, callLoadStep } = _deps;

        if ((stepData.responseType === "closedResponse" || stepData.responseType === "openResponse" || stepData.responseType === "friendClosedResponse") && stepData.interactiveVideoUrl) {
            const gs = appStore.getState();
            gs.setStepCount(gs.stepCount + 1);
        }
        try {
            appStore.getState().setHintsVisible(false);
            console.log('[showFeedbackAndProceed] responseType:', stepData.responseType, '| isLessonIntro:', stepData.responseType === "lessonIntro");
            const onContinue = () => {
                appStore.getState().triggerPauseAllVideos();
                if (stepData.responseType === "lessonIntro") {
                    enableAudioSystem();
                }
                console.log('[showFeedbackAndProceed] continue clicked, restoring mic controls');
                appStore.getState().removeContinueWidget();
                if (stepData.responseType === "lessonIntro") {
                    if (loadNextStep) loadNextStep(stepData);
                } else {
                    if (isCorrect || appStore.getState().incorrectAttempts > 2) {
                        if (loadNextStep) loadNextStep(stepData);
                    } else {
                        const stepIndex = getCurrentStepIndex(stepData, appStore.getState().configData, appStore.getState().currentLessonIndex);
                        const currentLesson = appStore.getState().configData.lessons[appStore.getState().currentLessonIndex];
                        if (callLoadStep) callLoadStep(currentLesson.steps[stepIndex], currentLesson);
                    }
                }
            };

            let nextStepVideoUrl = null;
            if (isCorrect || appStore.getState().incorrectAttempts > 2) {
                const nextStep = getNextStep(stepData, appStore.getState().configData, appStore.getState().currentLessonIndex);
                if (nextStep) {
                    const videoSlug = nextStep.interactiveVideoUrl || nextStep.simpleVideoUrl || nextStep.introBackgroundVideoUrl;
                    if (videoSlug) {
                        nextStepVideoUrl = getVideoUrl(videoSlug);
                        preloadVideo(nextStepVideoUrl);
                    }
                }
            }

            if (stepData.responseType === "lessonIntro") {
                setIntroContinueHandler(onContinue);
            } else if (stepData.responseType === 'viewAndContinue' && stepData.simpleVideoUrl) {
                // Decision overlay's Continue button triggered this call — advance directly
                onContinue();
            } else {
                const hasWidget = appStore.getState().chatHistory.some(msg => msg.type === 'continueWidget');
                if (!hasWidget) {
                    appStore.getState().addChatMessage({
                        role: 'system',
                        type: 'continueWidget',
                        onClick: onContinue,
                        nextStepVideoUrl
                    });
                }
            }
        } catch (error) {
            appStore.getState().addChatMessage({
                role: 'system',
                type: 'continueWidget',
                onClick: () => {
                    if (isCorrect || appStore.getState().incorrectAttempts > 2) {
                        if (loadNextStep) loadNextStep(stepData);
                    } else if (callLoadStep) callLoadStep(stepData, appStore.getState().configData.lessons[appStore.getState().currentLessonIndex]);
                },
                nextStepVideoUrl: null
            });
        }
    }

    return { submitAnswerPrecheck, handleAnswer, showFeedbackAndProceed };
}
