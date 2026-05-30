// --- modules/answer-pipeline.jsx ---
// Core answer processing: validation, submission, feedback, and step progression.
// Uses deps pattern to avoid circular imports with lesson-progression.
// Deps: { loadNextStep, callLoadStep }

import { appStore } from './store.js';
import {
    getCurrentStepIndex,
    processAnswerLogic,
    validateAnswerPrecheck
} from './answers.js';
import { logInteraction, calculateFluencyScore } from './scoring.js';

import { Media } from './media.js';
import Strings from '../data/strings.js';
import { getLocalizedTranslation } from './utils.js';
import React from 'react';
import { BilingualText } from '../components/BilingualText.jsx';
import { analyzeSpeech } from './analytics.js';
import { updateSpeechRecording } from './storage.js';
import { buildFeedbackData, buildExplanationData } from './feedback-builder.js';
import { getNextStep } from './lessonRouting.js';
import { warmUpSpeechCamStream } from './speech.js';
import getRandomPraise from '../data/praise.js';
import { generateHangmanOps } from './utils.js';
import {
    showChat,
    addAIFeedbackMessages,
    clearChat
} from '../components/chat/chat-interface.js';
import { getBotIdentity } from './bot-identity.js';

function mapSectionToMessage(section) {
    if (section.type === 'grammar') {
        return {
            role: 'system',
            type: 'grammarDiff',
            sectionKey: 'grammar',
            score: section.score,
            errorCount: section.errorCount,
            complexityScore: section.complexityScore,
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
    player.controller.tokens.forEach((token, idx) => {
        if (player.controller.punctuationMap.get(idx)) return;
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

    player.controller.applySpeechResult(correctIndices, [], extraWrongWords);
}

function handleCorrectFeedbackUI(stepIndex, stepData, button, cue, explanation, translation, userResponse, englishLevel, englishLevelDeduction, userData, configData, fluencyBubble = null) {
    const cueText = typeof cue === 'object' ? cue?.en : cue;
    const lang = userData?.native_language || appStore.getState().userData?.native_language || 'en';

    const currentFluencyScore = appStore.getState().fluencyScore;
    if (stepData.stepType === "closedResponse" && stepData.videoUrl) {
        appStore.setState({ repeatPointsHistory: [...appStore.getState().repeatPointsHistory, currentFluencyScore] });
        console.log('[scoring] append repeatPointsHistory', { currentFluencyScore, repeatPointsHistory: appStore.getState().repeatPointsHistory });
    }
    if (stepData.stepType === "openResponse" && stepData.videoUrl) {
        appStore.setState({ rolePlayPointsHistory: [...appStore.getState().rolePlayPointsHistory, currentFluencyScore] });
        console.log('[scoring] append rolePlayPointsHistory', { currentFluencyScore, rolePlayPointsHistory: appStore.getState().rolePlayPointsHistory });
    }

    showChat();

    const praiseResult = (stepData.stepType === "openResponse" || stepData.stepType === "closedResponse") ? getRandomPraise('general', lang) : "";
    const feedbackText = (stepData.stepType === "openResponse" && englishLevelDeduction > 0)
        ? (() => {
            const acceptable = Strings.getBilingual('ai_acceptable', lang);
            const level = Strings.getBilingual('ai_language_level', lang);
            const reduced = Strings.getBilingual('ai_fluency_reduced', lang);
            const points = Strings.getBilingual('ai_percentage_points', lang);
            const english = `${acceptable.english}. ${level.english} ${englishLevel}. ${reduced.english} ${englishLevelDeduction} ${points.english}.`;
            const hasTrans = acceptable.localized && level.localized && reduced.localized && points.localized;
            const translation = hasTrans
                ? `${acceptable.localized}. ${level.localized} ${englishLevel}. ${reduced.localized} ${englishLevelDeduction} ${points.localized}.`
                : undefined;
            return { type: 'text', text: english, translation, translationLang: translation ? lang : undefined };
        })()
        : praiseResult;

    if (stepData.stepType !== "openResponse" && stepData.stepType !== "closedResponse") {
        const localizedTrans = getLocalizedTranslation(translation, lang);
        const userName = appStore.getState().userData?.display_name?.split(' ')[0] || 'User';
        const userAvatarUrl = appStore.getState().userData?.profilepicurl || '/assets/img/userprofile.webp';

        // 1. User standard bubble (cue)
        appStore.getState().addChatMessage({
            role: 'user',
            type: 'standard',
            content: cueText,
            translation: localizedTrans,
            translationLang: (localizedTrans && lang && lang !== 'en') ? lang : undefined,
            userName,
            userAvatarUrl
        });

        // 2. Explanation chunks
        if (explanation && explanation.length > 0) {
            addAIFeedbackMessages(explanation);
        }

        // 3. Fluency overall bubble
        if (fluencyBubble) {
            addAIFeedbackMessages([fluencyBubble]);
        }

        // 4. Praise bubble (Joe Walsh image or text praise as standard bubble)
        const immediatePraise = getRandomPraise('general', lang);
        if (immediatePraise.type === 'image') {
            appStore.getState().addChatMessage({
                role: 'system',
                type: 'praise',
                praiseData: immediatePraise,
                botName: 'Joe Walsh',
                avatarUrl: '/assets/img/teacherprofile.webp'
            });
        } else {
            const msg = {
                role: 'system',
                type: 'standard',
                content: immediatePraise.text || immediatePraise,
                botName: 'Joe Walsh',
                avatarUrl: '/assets/img/teacherprofile.webp'
            };
            if (immediatePraise.translation) {
                msg.translation = immediatePraise.translation;
                msg.translationLang = immediatePraise.translationLang;
            }
            appStore.getState().addChatMessage(msg);
        }

        // 5. HeadsUp standard bubble
        if (stepData.headsUp) {
            appStore.getState().addChatMessage({
                role: 'system',
                type: 'standard',
                content: stepData.headsUp,
                botName: 'Joe Walsh',
                avatarUrl: '/assets/img/teacherprofile.webp'
            });
        }
    } else {
        // For open/closed response
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
                    avatarUrl: '/assets/img/teacherprofile.webp'
                });
            } else {
                const msg = {
                    role: 'system',
                    type: 'standard',
                    content: feedbackText.text || feedbackText,
                    botName: 'Joe Walsh',
                    avatarUrl: '/assets/img/teacherprofile.webp'
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
                avatarUrl: '/assets/img/teacherprofile.webp'
            });
        }
    }

    Media.playSound('correct-sound');
}

function handleIncorrectFeedbackUI(stepIndex, stepData, button, cue, userResponse, explanation, normalizeduserResponse, normalizedcue, step, silent = false, userData, configData, fluencyBubble = null) {
    const cueText = typeof cue === 'object' ? cue?.en : cue;
    appStore.getState().incrementIncorrectAttempts();

    if (!silent && !appStore.getState().isTextMode && (stepData.stepType === "lessonIntro" || stepData.stepType === "closedResponse" || stepData.stepType === "openResponse")) {
        const storeState = appStore.getState();
        const hasVideoBubble = storeState.chatHistory.some(msg => msg.type === 'video');
        if (!hasVideoBubble) {
            storeState.addChatMessage({
                role: 'user',
                type: 'video',
                userName: storeState.userData?.display_name?.split(' ')[0] || 'User',
                userAvatarUrl: storeState.userData?.profilepicurl || '/assets/img/userprofile.webp'
            });
        } else {
            appStore.getState().triggerVideoPlay(storeState.isPlaybackMuted);
        }
    }

    if ((stepData.stepType === "closedResponse" || stepData.stepType === "openResponse") && stepData.videoUrl) {
        appStore.getState().deductListeningScore(25);
        appStore.getState().triggerPointLoss('listening', 25);
        if (appStore.getState().incorrectAttempts > 2) {
            appStore.getState().setListeningScore(0);
            appStore.setState({ rolePlayPointsHistory: [...appStore.getState().rolePlayPointsHistory, appStore.getState().listeningScore] });
        }
    }

    const isSilentSpeechRetry = silent && stepData.stepType === "closedResponse";

    if (isSilentSpeechRetry) {
        return;
    }

    const lang = userData?.native_language || appStore.getState().userData?.native_language || 'en';

    if (stepData.stepType === "openResponse" && userResponse) {
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
            ? getLocalizedTranslation(stepData.translation, lang)
            : undefined;

        if (explanation && explanation.length > 0) {
            addAIFeedbackMessages(explanation);
        }

        // Add teacher feedback
        appStore.getState().addChatMessage({
            role: 'system',
            type: 'teacherFeedback',
            content: teacherBilingual.english,
            translation: teacherBilingual.localized || teacherTranslation,
            translationLang: (teacherBilingual.localized || teacherTranslation) ? teacherBilingual.lang : undefined,
            botName: 'Joe Walsh',
            avatarUrl: '/assets/img/teacherprofile.webp'
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
                avatarUrl: '/assets/img/teacherprofile.webp'
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
                avatarUrl: '/assets/img/teacherprofile.webp'
            });
        }
    }

    if (stepData.stepType === "closedResponse" && userResponse) {
        const selectedWords = [...new Set(normalizeduserResponse.split(/\s+/))];
        const correctWords = [...new Set(normalizedcue.split(/\s+/))];
        const correctWordSet = new Set(correctWords.map(w => w.toLowerCase()));
        const correct = new Set(); const incorrect = new Set();

        selectedWords.forEach(w => correctWordSet.has(w.toLowerCase()) ? correct.add(w) : incorrect.add(w));

        const teacherKey = appStore.getState().incorrectAttempts === 1
            ? 'try_again_1'
            : appStore.getState().incorrectAttempts === 2
                ? 'try_again_2'
                : 'failed_continue';
        const teacherBilingual = Strings.getBilingual(teacherKey, lang);

        if (explanation && explanation.length > 0) {
            addAIFeedbackMessages(explanation);
        }

        // Add teacher feedback (with correct/incorrect words list to render in React component)
        appStore.getState().addChatMessage({
            role: 'system',
            type: 'teacherFeedback',
            content: teacherBilingual.english,
            translation: teacherBilingual.localized,
            translationLang: teacherBilingual.localized ? teacherBilingual.lang : undefined,
            correctWords: Array.from(correct),
            incorrectWords: Array.from(incorrect),
            botName: 'Joe Walsh',
            avatarUrl: '/assets/img/teacherprofile.webp'
        });

        if (appStore.getState().incorrectAttempts > 2) {
            const translationText = getLocalizedTranslation(stepData.translation, lang);
            const labelBilingual = Strings.getBilingual('failed_continue_correct_label', lang);
            appStore.getState().addChatMessage({
                role: 'system',
                type: 'possibleAnswer',
                label: labelBilingual.english || 'Correct:',
                answer: cueText,
                translation: translationText,
                translationLang: (translationText && lang && lang !== 'en') ? lang : undefined,
                botName: 'Joe Walsh',
                avatarUrl: '/assets/img/teacherprofile.webp'
            });
        }

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
                avatarUrl: '/assets/img/teacherprofile.webp'
            });
        }
    }

    if (!silent) {
        Media.playSound('incorrect-sound');
    }
}

export function handleHint(stepIndex) {
    appStore.getState().setHintsVisible(true);
}

function resetButtonState(button) {
    appStore.getState().setSubmitBtnDisabled(false);
    appStore.getState().setSubmitBtnIcon(appStore.getState().isTextMode ? 'send' : 'mic');
    appStore.getState().setSubmitBtnDanger(false);
    appStore.getState().setInputDisabled(false);
    appStore.getState().triggerInputFocus();
}

export async function submitAnswerPrecheck(val, cue, stepData, btn, explanation, translation, stats = { pauseCount: null, netDuration: null }, _deps = {}, userData = appStore.getState().userData, configData = appStore.getState().configData, courseId = appStore.getState().courseId) {
    const englishLevel = configData?.languageLevel || 'A0';
    const { isValid, warningMessage } = await validateAnswerPrecheck(
        val, cue, stepData, englishLevel, userData, appStore.getState().responsesGiven
    );

    if (!isValid) {
        const cueText = typeof cue === 'object' ? cue?.en : cue;
        logInteraction(cueText, val, "rej_pre", warningMessage, null, appStore.getState().interactionLog);
        if (!appStore.getState().isTextMode) {
            appStore.getState().deductSpeakingScore(10);
            appStore.getState().triggerPointLoss('pronunciation', 10);
        } else {
            console.log('[submitAnswerPrecheck] Text mode: skipping speaking score deduction');
        }

        appStore.getState().setMicStatusText(`<div class='text-center text-danger'>${warningMessage}</div>`);

        if (appStore.getState().isTextMode) {
            appStore.getState().setAnswerErrorMessage(warningMessage);
            appStore.getState().triggerVideoClear();
            appStore.getState().setWebcamStream(null);
            appStore.getState().setInputDisabled(false);
            appStore.getState().setSubmitBtnDisabled(false);
            appStore.getState().triggerInputFocus();
            appStore.getState().triggerScoreUpdate();
        }

        const currentLessonId = appStore.getState().activeLessonId
            || (configData?.lessons?.[appStore.getState().currentLessonIndex]?.lessonId)
            || 'unknown_lesson';
        const stepIndex = getCurrentStepIndex(stepData, configData, appStore.getState().currentLessonIndex);
        await updateSpeechRecording(currentLessonId, stepIndex, {
            userResponse: val,
            cue: typeof cue === 'object' ? cue?.en : cue,
            isTextMode: appStore.getState().isTextMode,
            duration: appStore.getState().isTextMode ? 3 : null
        });

        const player = appStore.getState().currentVideoPlayer;
        if (stepData.stepType === "closedResponse" && player && player.controller && player.controller.applySpeechResult) {
            applySpeechResultToPlayer(val, player);
        }

        appStore.getState().setSubmitBtnDisabled(false);
        return;
    }

    const player = appStore.getState().currentVideoPlayer;
    if (stepData.stepType === "closedResponse" && player && player.controller && player.controller.applySpeechResult) {
        applySpeechResultToPlayer(val, player);
    }

    await handleAnswer(val, cue, stepData, btn, explanation, translation, stats, _deps, userData, configData, courseId);
}

export async function handleAnswer(userResponse, cue, stepData, button, explanation, translation, stats = { pauseCount: null, netDuration: null }, _deps = {}, userData = appStore.getState().userData, configData = appStore.getState().configData, courseId = appStore.getState().courseId) {
    const cueText = typeof cue === 'object' ? cue?.en : cue;
    if (!appStore.getState().isTextMode && (stepData.stepType === "lessonIntro" || stepData.stepType === "closedResponse" || stepData.stepType === "openResponse")) {
        const storeState = appStore.getState();
        const hasVideoBubble = storeState.chatHistory.some(msg => msg.type === 'video');
        if (!hasVideoBubble) {
            storeState.addChatMessage({
                role: 'user',
                type: 'video',
                userName: storeState.userData?.display_name?.split(' ')[0] || 'User',
                userAvatarUrl: storeState.userData?.profilepicurl || '/assets/img/userprofile.webp'
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

        if (stepData.stepType === "closedResponse" || stepData.stepType === "openResponse") {
            cleanWordCount = userResponse.replace(/[^\w\s]/g, '').trim().split(/\s+/).filter(Boolean).length;

            if (stats && stats.netDuration !== null) {
                speechAnalytics = await analyzeSpeech(userResponse, stats.netDuration, stats.pauseCount, courseId ? courseId.substring(0, 2).toUpperCase() : 'A1', stepData.stepType);
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

            await updateSpeechRecording(currentLessonId, stepIndex, {
                userResponse,
                cue: cueText,
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
    appStore.getState().setMicStatusText("");
    appStore.getState().setMediaVisible(false);
    appStore.getState().setTextInputVisible(false);
    appStore.getState().setHintsVisible(false);

    let immediateStatsMessages = [];
    let fluencyBubble = null;
    //appStore.getState().setSubmitBtnDisabled(true);

    try {
        const englishLevel = configData?.languageLevel || 'A0';
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
        if (stepData.stepType === "closedResponse" || stepData.stepType === "openResponse") {
            result = await processAnswerLogic({
                userResponse, cue, stepData,
                lesson: lesson,
                english_level: englishLevel,
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

        if (stepData.stepType === "closedResponse" || stepData.stepType === "openResponse") {
            const attemptNumber = incorrectAttempts + 1;
            let grammarErrorScore = 100;

            if (result && result.explanations) {
                const diffObj = result.explanations.find(e => e.type === 'grammar_diff');
                if (diffObj) {
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
                cefrLevel: englishLevel,
                grammarErrorScore: grammarErrorScore,
                complexityScore: speechAnalytics?.complexityScore || 100,
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
                cefrLevel: englishLevel,
                grammarErrorScore,
                complexityScore: speechAnalytics?.complexityScore || 100,
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
                lang: userData?.native_language, englishLevel,
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

        if (!isCorrect && stepData.stepType === "closedResponse" && incorrectAttempts < 2) {
            const explanationData = buildExplanationData(result.explanations || explanation, explanation);
            const structuredExplanations = getExplanationMessages(explanationData);

            handleIncorrectFeedbackUI(stepIndex, stepData, button, cue, userResponse, structuredExplanations, result.normalizeduserResponse, result.normalizedcue, stepData.step, true, userData, configData);
            appStore.getState().triggerVideoClear();
            clearChat();
            appStore.getState().setWebcamStream(null);

            if (!stepData.videoUrl) {
                const hangmanOps = generateHangmanOps(userResponse, cueText);
                appStore.getState().setHangmanOps(hangmanOps);
                appStore.getState().setHintsVisible(true);
            }
            appStore.getState().setMediaVisible(true);

            const player = appStore.getState().currentVideoPlayer;
            if (player) {
                if (player.video) {
                    player.video.currentTime = 0;
                }
                setTimeout(() => {
                    if (player.play) {
                        player.play().catch(e => console.warn("Video play failed:", e));
                    } else if (player.video) {
                        player.video.play().catch(e => console.warn("Video play failed:", e));
                    }
                }, 50);
            }

            appStore.getState().setMicStatusText(`<div class='text-center'>${stepData.step || ""}</div>`);
            resetButtonState(button);
            return;
        }

        if (stepData.stepType === "openResponse" && userResponse) {
            const lang = userData?.native_language || appStore.getState().userData?.native_language || 'en';
            console.log('[handleAnswer] openResponse lang:', lang, 'cue:', typeof cue, 'native_language:', userData?.native_language);

            appStore.getState().addChatMessage({
                role: 'system',
                type: 'standard',
                content: cueText,
                translation: getLocalizedTranslation(stepData.translation, lang),
                translationLang: (getLocalizedTranslation(stepData.translation, lang) && lang !== 'en') ? lang : undefined,
                botName: 'Joe Walsh',
                avatarUrl: '/assets/img/teacherprofile.webp'
            });

            showChat();

            appStore.getState().addChatMessage({
                role: 'user',
                type: 'standard',
                content: userResponse,
                userName: userData?.display_name?.split(' ')[0] || 'User',
                userAvatarUrl: userData?.profilepicurl || '/assets/img/userprofile.webp'
            });

            if (immediateStatsMessages.length > 0) addAIFeedbackMessages(immediateStatsMessages);
        } else if (stepData.stepType === "closedResponse" && userResponse) {
            const lang = userData?.native_language || appStore.getState().userData?.native_language || 'en';

            showChat();

            appStore.getState().addChatMessage({
                role: 'user',
                type: 'standard',
                content: cueText,
                translation: getLocalizedTranslation(stepData.translation, lang),
                translationLang: (getLocalizedTranslation(stepData.translation, lang) && lang !== 'en') ? lang : undefined,
                userName: userData?.display_name?.split(' ')[0] || 'User',
                userAvatarUrl: userData?.profilepicurl || '/assets/img/userprofile.webp'
            });

            if (immediateStatsMessages.length > 0) addAIFeedbackMessages(immediateStatsMessages);
        }

        const explanationData = buildExplanationData(result?.explanations, explanation);
        const structuredExplanations = getExplanationMessages(explanationData);

        appStore.getState().setTutorChatVisible(true);

        if (isCorrect) {
            if (stepData.stepType === "openResponse") {
                appStore.setState({ responsesGiven: [...appStore.getState().responsesGiven, result.normalizeduserResponse] });
                if (result.cefrLevelDeduction > 0) {
                    appStore.getState().deductListeningScore(result.cefrLevelDeduction);
                }
            }
            handleCorrectFeedbackUI(stepIndex, stepData, button, cue, structuredExplanations, translation, userResponse, result ? result.cefrLevel : undefined, result ? result.cefrLevelDeduction : undefined, userData, configData, fluencyBubble);
            showFeedbackAndProceed(stepData, isCorrect, _deps);
        } else {
            handleIncorrectFeedbackUI(stepIndex, stepData, button, cue, userResponse, structuredExplanations, result ? result.normalizeduserResponse : "", result ? result.normalizedcue : "", stepData.step, false, userData, configData, fluencyBubble);
            showFeedbackAndProceed(stepData, isCorrect, _deps);
        }

    } catch (error) {
        console.error("Error handling answer:", error);
        handleIncorrectFeedbackUI(stepIndex, stepData, button, cue, userResponse, explanation, "", "", translation, false, userData, configData);
        showFeedbackAndProceed(stepData, false, _deps);
    }
}

export function showFeedbackAndProceed(stepData, isCorrect, _deps = {}) {
    const { loadNextStep, callLoadStep } = _deps;

    if ((stepData.stepType === "closedResponse" || stepData.stepType === "openResponse") && stepData.videoUrl) {
        const gs = appStore.getState();
        gs.setStepCount(gs.stepCount + 1);
    }
    try {
        appStore.getState().setHintsVisible(false);
        console.log('[showFeedbackAndProceed] stepType:', stepData.stepType, '| isLessonIntro:', stepData.stepType === "lessonIntro");
        const onContinue = () => {
            appStore.getState().triggerPauseAllVideos();
            if (stepData.stepType === "lessonIntro") {
                const initializeMedia = async () => {
                    await Media.enableAudioSystem();
                    await warmUpSpeechCamStream();
                };
                initializeMedia();
            }
            console.log('[showFeedbackAndProceed] continue clicked, restoring mic controls');
            appStore.getState().setBottomControlState('mic');
            appStore.getState().removeContinueWidget();
            if (stepData.stepType === "lessonIntro") {
                setTimeout(() => {
                    if (loadNextStep) loadNextStep(stepData);
                }, 2000);
            } else {
                if (isCorrect || appStore.getState().incorrectAttempts > 2) {
                    if (loadNextStep) loadNextStep(stepData);
                } else {
                    const stepIndex = getCurrentStepIndex(stepData, appStore.getState().configData, appStore.getState().currentLessonIndex);
                    if (callLoadStep) callLoadStep(appStore.getState().configData.lessons[appStore.getState().currentLessonIndex].steps[stepIndex], appStore.getState().configData.lessons[appStore.getState().currentLessonIndex]);
                }
            }
        };

        if (stepData.stepType === "lessonIntro") {
            appStore.getState().setIntroContinueCallback(onContinue);
            appStore.getState().setBottomControlState('introChoices');
        } else {
            const hasWidget = appStore.getState().chatHistory.some(msg => msg.type === 'continueWidget');
            if (!hasWidget) {
                appStore.getState().addChatMessage({
                    role: 'system',
                    type: 'continueWidget',
                    onClick: onContinue
                });
            }
        }

        if (isCorrect || appStore.getState().incorrectAttempts > 2) {
            const nextStep = getNextStep(stepData, appStore.getState().configData, appStore.getState().currentLessonIndex);
            if (nextStep && nextStep.videoUrl) {
                const videoUrl = `https://r2.ultrafastfluency.com/assets/videos/${nextStep.videoUrl}.mp4`;
                Media.preloader.preloadOnly(videoUrl);
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
            }
        });
    }
}
