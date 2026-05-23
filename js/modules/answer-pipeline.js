// --- modules/answer-pipeline.js ---
// Core answer processing: validation, submission, feedback, and step progression.
// Uses deps pattern to avoid circular imports with lesson-progression.
// Deps: { loadNextStep, callLoadStep }

import { appStore } from './store.js';
import { State } from './state.js';
import {
    getCurrentStepIndex,
    processAnswerLogic,
    validateAnswerPrecheck
} from './answers.js';
import { logInteraction, calculateFluencyScore } from './scoring.js';
import { pointLoss } from '../components/point-loss-animation.js';
import { clearPlaybackVideo } from '../components/playback.js';
import { Media } from './media.js';
import Strings from '../data/strings.js';
import { getLocalizedTranslation } from './utils.js';
import { formatBilingualHTML } from './bilingual-display.web.js';
import { analyzeSpeech } from './analytics.js';
import { updateSpeechRecording } from './storage.js';
import { buildFeedbackData, buildExplanationData } from './feedback-builder.js';
import { renderFeedbackToHTML, renderExplanationsToHTML } from '../components/feedback-renderer.js';
import { getNextStep } from './lessonRouting.js';
import { warmUpSpeechCamStream } from './speech.js';
import getRandomPraise from '../data/praise.js';
import { getPraiseHTML } from '../components/feedback-renderer.web.js';
import {
    DOM,
    showMicWarning,
    showAnswerError,
    flashElement,
    safeRenderChatInterface,
    renderAIFeedback,
    disableAllButtons,
    resetMicStatusWithStep,
    getFirstName,
    generateHangmanHint,
    updateChatHeaderScores,
    clearChatInterface
} from '../components/ui.js';

function handlecueUI(stepIndex, stepData, button, cue, explanation, translation, userResponse, englishLevel, englishLevelDeduction, userData, configData, fluencyBubble = null) {
    const cueText = typeof cue === 'object' ? cue?.en : cue;
    const lang = userData?.native_language || appStore.getState().userData?.native_language || 'en';
    const cueDisplayHTML = formatBilingualHTML(cue, lang);
    
    const currentFluencyScore = appStore.getState().fluencyScore;
    if (stepData.stepType === "closedResponse" && stepData.videoUrl) {
        appStore.setState({ repeatPointsHistory: [...appStore.getState().repeatPointsHistory, currentFluencyScore] });
        console.log('[scoring] append repeatPointsHistory', { currentFluencyScore, repeatPointsHistory: appStore.getState().repeatPointsHistory });
    }
    if (stepData.stepType === "openResponse" && stepData.videoUrl) {
        appStore.setState({ rolePlayPointsHistory: [...appStore.getState().rolePlayPointsHistory, currentFluencyScore] });
        console.log('[scoring] append rolePlayPointsHistory', { currentFluencyScore, rolePlayPointsHistory: appStore.getState().rolePlayPointsHistory });
    }

    safeRenderChatInterface(true);

    const praiseResult = (stepData.stepType === "openResponse" || stepData.stepType === "closedResponse") ? getRandomPraise('general', lang) : "";
    const feedbackText = (stepData.stepType === "openResponse" && englishLevelDeduction > 0)
        ? `${Strings.get('ai_acceptable', lang)}<br>${Strings.get('ai_language_level', lang)} ${englishLevel}<br>${Strings.get('ai_fluency_reduced', lang)} <span style='color:red'>${englishLevelDeduction} ${Strings.get('ai_percentage_points', lang)}</span>.`
        : getPraiseHTML(praiseResult);

    if (stepData.stepType !== "openResponse" && stepData.stepType !== "closedResponse") {
        const localizedTrans = getLocalizedTranslation(translation, lang);
        const userName = getFirstName(appStore.getState().userData?.display_name);
        const userAvatarUrl = appStore.getState().userData?.profilepicurl || '/assets/img/userprofile.webp';

        const translationHTML = (localizedTrans && lang && lang !== 'en')
            ? `<br><span lang="${lang}"><i>${localizedTrans}</i></span>`
            : '';

        const correctBubbleHTML = `<div class="correct-answer-display chat-message-bubble chat-message-bubble--user"><div class="chat-bubble-header d-none">${userName}</div>${cueDisplayHTML}${translationHTML}</div>`;
        const correctWrapperHTML = `<div class="chat-message-row chat-message-row--user correct-answer-wrapper"><img src="${userAvatarUrl}" alt="${userName}" class="chat-avatar-inline" />${correctBubbleHTML}</div>`;

        const praiseHTML = getPraiseHTML(getRandomPraise('general', lang));
        const praiseWrapperHTML = `<div class="chat-message-row chat-message-row--system" style="margin-top:6px"><img src="/assets/img/teacherprofile.webp" alt="Joe Walsh" class="chat-avatar-inline" /><div class="chat-message-bubble chat-message-bubble--system"><div class="chat-bubble-header">Joe Walsh</div><strong>${praiseHTML}</strong></div></div>`;

        appStore.getState().addChatMessage({ role: 'system', type: 'htmlChunk', content: correctWrapperHTML });

        if (Array.isArray(explanation)) explanation.filter(Boolean).forEach(c => appStore.getState().addChatMessage({ role: 'system', type: 'htmlChunk', content: c }));
        else if (explanation) appStore.getState().addChatMessage({ role: 'system', type: 'htmlChunk', content: explanation });

        if (fluencyBubble) appStore.getState().addChatMessage({ role: 'system', type: 'htmlChunk', content: fluencyBubble });

        appStore.getState().addChatMessage({ role: 'system', type: 'htmlChunk', content: praiseWrapperHTML });
        if (stepData.headsUp) appStore.getState().addChatMessage({ role: 'system', type: 'htmlChunk', content: stepData.headsUp });
    } else {
        if (Array.isArray(explanation)) explanation.filter(Boolean).forEach(c => appStore.getState().addChatMessage({ role: 'system', type: 'htmlChunk', content: c }));
        else if (explanation) appStore.getState().addChatMessage({ role: 'system', type: 'htmlChunk', content: explanation });

        if (fluencyBubble) appStore.getState().addChatMessage({ role: 'system', type: 'htmlChunk', content: fluencyBubble });

        if (feedbackText) appStore.getState().addChatMessage({ role: 'system', type: 'praise', content: feedbackText, botName: 'Joe Walsh', avatarUrl: '/assets/img/teacherprofile.webp' });
        if (stepData.headsUp) appStore.getState().addChatMessage({ role: 'system', type: 'htmlChunk', content: stepData.headsUp });
    }

    Media.playSound('correct-sound');
}

function handleIncueUI(stepIndex, stepData, button, cue, userResponse, explanation, normalizeduserResponse, normalizedcue, step, silent = false, userData, configData, fluencyBubble = null) {
    const cueText = typeof cue === 'object' ? cue?.en : cue;
    appStore.getState().incrementIncorrectAttempts();

    if (!silent && !State.isTextMode && (stepData.stepType === "lessonIntro" || stepData.stepType === "closedResponse" || stepData.stepType === "openResponse")) {
        const storeState = appStore.getState();
        const hasVideoBubble = storeState.chatHistory.some(msg => msg.type === 'video');
        if (!hasVideoBubble) {
            storeState.addChatMessage({
                role: 'user',
                type: 'video',
                userName: getFirstName(storeState.userData?.display_name),
                userAvatarUrl: storeState.userData?.profilepicurl || '/assets/img/userprofile.webp'
            });
        } else {
            const video = document.getElementById('playback-video');
            if (video) {
                video.muted = storeState.isPlaybackMuted;
                video.play().catch(e => console.warn('[handleIncueUI] Playback resume failed:', e));
            }
        }
    }

    if ((stepData.stepType === "closedResponse" || stepData.stepType === "openResponse") && stepData.videoUrl) {
        appStore.getState().deductListeningScore(25);
        pointLoss.show(DOM.micStatusText, 25);
        if (appStore.getState().incorrectAttempts > 2) {
            appStore.getState().setListeningScore(0);
            appStore.setState({ rolePlayPointsHistory: [...appStore.getState().rolePlayPointsHistory, appStore.getState().listeningScore] });
        }
    }

    const isSilentSpeechRetry = silent && stepData.stepType === "closedResponse";

    if (isSilentSpeechRetry) {
        return;
    }

    if (stepData.stepType === "openResponse" && userResponse) {
        if (appStore.getState().incorrectAttempts > 2) {
            appStore.getState().setListeningScore(0);
            appStore.setState({ rolePlayPointsHistory: [...appStore.getState().rolePlayPointsHistory, appStore.getState().listeningScore] });
        }

        const teacherTextStr = appStore.getState().incorrectAttempts === 1
            ? Strings.get('try_again_1', userData?.native_language)
            : appStore.getState().incorrectAttempts === 2
                ? Strings.get('try_again_2', userData?.native_language)
                : (() => {
                    const lang = userData?.native_language;
                    const localizedTrans = getLocalizedTranslation(stepData.translation, lang);
                    const transStr = (localizedTrans && lang && lang !== 'en')
                        ? `<br><span lang='${lang}'><i>${localizedTrans}</i></span>`
                        : "";
                    return `${Strings.get('failed_continue_correct', userData?.native_language)}<br>"${cueText}"${transStr}`;
                })();

        const teacherHTML = `<div><strong>${teacherTextStr}</strong></div>`;

        if (Array.isArray(explanation)) explanation.filter(Boolean).forEach(c => appStore.getState().addChatMessage({ role: 'system', type: 'htmlChunk', content: c }));
        else if (explanation) appStore.getState().addChatMessage({ role: 'system', type: 'htmlChunk', content: explanation });

        appStore.getState().addChatMessage({ role: 'system', type: 'htmlChunk', content: teacherHTML });

        if (fluencyBubble) appStore.getState().addChatMessage({ role: 'system', type: 'htmlChunk', content: fluencyBubble });

        if (stepData.possibleAnswer && appStore.getState().incorrectAttempts > 2) {
            const possibleHTML = `${Strings.get('example_correct_answer', appStore.getState().userData?.native_language)}<br>${stepData.possibleAnswer}`;
            appStore.getState().addChatMessage({ role: 'system', type: 'htmlChunk', content: possibleHTML });
        }

        if (stepData.headsUp) {
            const headsUpText = appStore.getState().incorrectAttempts <= 2 ? Strings.get('heads_up_try_again', userData?.native_language) : stepData.headsUp;
            appStore.getState().addChatMessage({ role: 'system', type: 'htmlChunk', content: headsUpText });
        }
    }

    if (stepData.stepType === "closedResponse" && userResponse && DOM.speechText) {
        const selectedWords = [...new Set(normalizeduserResponse.split(/\s+/))];
        const correctWords = [...new Set(normalizedcue.split(/\s+/))];
        const correctWordSet = new Set(correctWords.map(w => w.toLowerCase()));
        const correct = new Set(); const incorrect = new Set();

        selectedWords.forEach(w => correctWordSet.has(w.toLowerCase()) ? correct.add(w) : incorrect.add(w));

        const correctUl = correct.size > 0 ? `<ul class='card-text correctWords list-inline' id='correctWords' style='display:block'>${Array.from(correct).map(w => `<li class='list-inline-item'>${w}</li>`).join('')}</ul>` : '';
        const incorrectUl = incorrect.size > 0 ? `<ul class='card-text incorrectWords list-inline' id='incorrectWords' style='display:block; border-top: 1px solid rgba(255,255,255,0.1)'>${Array.from(incorrect).map(w => `<li class='list-inline-item'>${w}</li>`).join('')}</ul>` : '';

        const teacherText = appStore.getState().incorrectAttempts === 1
            ? Strings.get('try_again_1', appStore.getState().userData?.native_language)
            : appStore.getState().incorrectAttempts === 2
                ? Strings.get('try_again_2', appStore.getState().userData?.native_language)
                : (() => {
                    const lang = appStore.getState().userData?.native_language;
                    const localizedTrans = getLocalizedTranslation(stepData.translation, lang);
                    const transStr = (localizedTrans && lang && lang !== 'en')
                        ? `<br><span lang='${lang}'><i>${localizedTrans}</i></span>`
                        : "";
                    return `${Strings.get('failed_continue', appStore.getState().userData?.native_language)}<br><br>Correct:<br>"${cueText}"${transStr}`;
                })();

        const mainFeedbackHTML = `<strong>${teacherText}</strong><br><br>${correctUl}${incorrectUl}`;

        if (Array.isArray(explanation)) explanation.filter(Boolean).forEach(c => appStore.getState().addChatMessage({ role: 'system', type: 'htmlChunk', content: c }));
        else if (explanation) appStore.getState().addChatMessage({ role: 'system', type: 'htmlChunk', content: explanation });

        appStore.getState().addChatMessage({ role: 'system', type: 'htmlChunk', content: mainFeedbackHTML });

        if (fluencyBubble) appStore.getState().addChatMessage({ role: 'system', type: 'htmlChunk', content: fluencyBubble });

        const headsUpStr = stepData.headsUp
            ? (appStore.getState().incorrectAttempts <= 2 ? Strings.get('heads_up_repeat_video', appStore.getState().userData?.native_language) : stepData.headsUp)
            : '';
        if (headsUpStr) appStore.getState().addChatMessage({ role: 'system', type: 'htmlChunk', content: headsUpStr });
    }

    if (!silent) {
        Media.playSound('incorrect-sound');
    }
}

export function handleHint(stepIndex) {
    appStore.getState().setHintsVisible(true);
}

function resetButtonState(button) {
    if (button) {
        button.disabled = false;
        button.classList.remove('disabled');
        button.style.display = "inline-block";

        if (State.isTextMode) {
            button.innerHTML = '<i class="bi bi-send-fill"></i>';
            const inputField = document.getElementById('answer-input-field');
            if (inputField) {
                inputField.value = '';
                inputField.disabled = false;
                inputField.classList.remove('disabled');
                setTimeout(() => inputField.focus(), 100);
            }
        } else {
            button.innerHTML = '<i class="bi bi-mic-fill"></i>';
        }

        button.classList.remove('btn-danger', 'btn-danger-recording');
    }
}

export async function submitAnswerPrecheck(val, cue, stepData, btn, explanation, translation, stats = { pauseCount: null, netDuration: null }, _deps = {}, userData = appStore.getState().userData, configData = appStore.getState().configData, courseId = appStore.getState().courseId) {
    const englishLevel = configData?.languageLevel || 'A0';
    const { isValid, warningMessage } = await validateAnswerPrecheck(
        val, cue, stepData, englishLevel, userData, appStore.getState().cuesGiven
    );

    if (!isValid) {
        const cueText = typeof cue === 'object' ? cue?.en : cue;
        logInteraction(cueText, val, "rej_pre", warningMessage, null, State.interactionLog);
        if (!State.isTextMode) {
            appStore.getState().deductSpeakingScore(10);
            if (DOM.pronunciationScore) {
                pointLoss.show(DOM.pronunciationScore, 10);
            }
        } else {
            console.log('[submitAnswerPrecheck] Text mode: skipping speaking score deduction');
        }

        showMicWarning(warningMessage);

        if (State.isTextMode) {
            showAnswerError(warningMessage);
            clearPlaybackVideo();
            appStore.getState().setWebcamStream(null);
            const inputField = document.getElementById('answer-input-field');
            if (inputField) {
                inputField.disabled = false;
                inputField.classList.remove('disabled');
                inputField.focus();
                if (DOM.answerInputArea) flashElement(DOM.answerInputArea);
            }
        }

        const currentLessonId = appStore.getState().activeLessonId
            || (configData?.lessons?.[appStore.getState().currentLessonIndex]?.lessonId)
            || 'unknown_lesson';
        const stepIndex = getCurrentStepIndex(stepData, configData, appStore.getState().currentLessonIndex);
        await updateSpeechRecording(currentLessonId, stepIndex, {
            userResponse: val,
            cue: typeof cue === 'object' ? cue?.en : cue,
            isTextMode: State.isTextMode,
            duration: State.isTextMode ? 3 : null
        });

        if (stepData.stepType === "closedResponse" && State.player && State.player.controller && State.player.controller.applySpeechResult) {
            const userWords = val.toLowerCase().replace(/[^\w\s']/g, '').split(/\s+/);
            const correctIndices = [];
            const wrongIndices = [];

            State.player.controller.tokens.forEach((token, idx) => {
                if (State.player.controller.punctuationMap.get(idx)) return;
                const cleanToken = token.toLowerCase().replace(/[^\w\s']/g, '');
                if (userWords.includes(cleanToken)) {
                    correctIndices.push(idx);
                } else {
                    wrongIndices.push(idx);
                }
            });
            State.player.controller.applySpeechResult(correctIndices, wrongIndices);
        }

        if (btn) btn.disabled = false;
        return;
    }

    if (stepData.stepType === "closedResponse" && State.player && State.player.controller && State.player.controller.applySpeechResult) {
        const correctIndices = State.player.controller.tokens.map((_, i) => i);
        State.player.controller.applySpeechResult(correctIndices, []);
    }

    await handleAnswer(val, cue, stepData, btn, explanation, translation, stats, _deps, userData, configData, courseId);
}

export async function handleAnswer(userResponse, cue, stepData, button, explanation, translation, stats = { pauseCount: null, netDuration: null }, _deps = {}, userData = appStore.getState().userData, configData = appStore.getState().configData, courseId = appStore.getState().courseId) {
    const cueText = typeof cue === 'object' ? cue?.en : cue;
    if (!State.isTextMode && (stepData.stepType === "lessonIntro" || stepData.stepType === "closedResponse" || stepData.stepType === "openResponse")) {
        const storeState = appStore.getState();
        const hasVideoBubble = storeState.chatHistory.some(msg => msg.type === 'video');
        if (!hasVideoBubble) {
            storeState.addChatMessage({
                role: 'user',
                type: 'video',
                userName: getFirstName(storeState.userData?.display_name),
                userAvatarUrl: storeState.userData?.profilepicurl || '/assets/img/userprofile.webp'
            });
        } else {
            const video = document.getElementById('playback-video');
            if (video) {
                video.muted = storeState.isPlaybackMuted;
                video.play().catch(e => console.warn('[answer-pipeline] Playback resume failed:', e));
            }
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

            if (State.isTextMode) {
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
                wpm: State.isTextMode ? 0 : (speechAnalytics?.wpm || 0),
                pauseCount: State.isTextMode ? 0 : (speechAnalytics?.pauseCount || 0),
                complexityScore: speechAnalytics?.complexityScore || 100,
                isTextMode: State.isTextMode,
                duration: State.isTextMode ? 3 : (speechAnalytics?.netDuration || null)
            });
            console.log("Successfully updated speech recording with answers");
        }
    } catch (e) {
        console.error("Error updating speech recording with answers", e);
    }

    Media.pauseVideoIfPlaying();
    window.isMicActive = false;
    appStore.getState().setMicStatusText("");
    appStore.getState().setMediaVisible(false);
    appStore.getState().setTextInputVisible(false);
    appStore.getState().setHintsVisible(false);

    let immediateStatsHtmlArr = [];
    let fluencyBubbleHTML = null;
    if (button) {
        disableAllButtons(button.parentElement);
    }

    try {
        const englishLevel = configData?.languageLevel || 'A0';
        const lesson = (configData && configData.lessons) ? configData.lessons[appStore.getState().currentLessonIndex] : null;

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
                cuesGiven: appStore.getState().cuesGiven,
                apiRoot: State.apiRoot
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
        logInteraction(cueText, userResponse, status, pragmaticDetails, grammarCorrection, State.interactionLog);

        if (result?.foundIdioms?.length > 0) {
            State.recognizedIdioms.push(...result.foundIdioms);
        }
        if (result?.intentLabels?.length > 0) {
            State.pragmaticFlags.push(...result.intentLabels);
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
                isTextMode: State.isTextMode
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
                isTextMode: State.isTextMode,
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
                repetitionCount: State.videoPlays,
                whisperRejections: whisperRejections
            });

            updateChatHeaderScores(feedbackData);

            const allFeedbackHTML = renderFeedbackToHTML(feedbackData);

            if (feedbackData.sections.length > 0 && feedbackData.sections[0].isOverall) {
                fluencyBubbleHTML = allFeedbackHTML[0];
                immediateStatsHtmlArr = allFeedbackHTML.slice(1);
            } else {
                immediateStatsHtmlArr = allFeedbackHTML;
            }
        }

        if (!isCorrect && stepData.stepType === "closedResponse" && incorrectAttempts < 2) {
            handleIncueUI(stepIndex, stepData, button, cue, userResponse, result.explanations || explanation, result.normalizeduserResponse, result.normalizedcue, stepData.step, true, userData, configData);
            clearPlaybackVideo();
            clearChatInterface();
            appStore.getState().setWebcamStream(null);

            const hangmanHTML = generateHangmanHint(userResponse, cueText);
            appStore.getState().setHangmanHintHTML(hangmanHTML);
            appStore.getState().setHintsVisible(true);
            appStore.getState().setMediaVisible(true);

            const player = State.player || window.currentVideoPlayer;
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

            resetMicStatusWithStep(stepData.step);
            resetButtonState(button);
            return;
        }

        if (stepData.stepType === "openResponse" && userResponse && DOM.speechText) {
            const lang = userData?.native_language || appStore.getState().userData?.native_language || 'en';
            console.log('[handleAnswer] openResponse lang:', lang, 'cue:', typeof cue, 'native_language:', userData?.native_language);
            const cueDisplayHTML = formatBilingualHTML(cue, lang);
            const localizedTrans = getLocalizedTranslation(stepData.translation, lang);
            const translationStr = (localizedTrans && lang && lang !== 'en') ? `<br><span lang='${lang}'><i>${localizedTrans}</i></span>` : "";

            renderAIFeedback([`<strong>${cueDisplayHTML}${translationStr}</strong>`]);
            safeRenderChatInterface(false);
            appStore.getState().addChatMessage({
                role: 'user',
                type: 'standard',
                content: userResponse,
                statsHtml: "",
                userName: userData?.display_name?.split(' ')[0] || 'User',
                userAvatarUrl: userData?.profilepicurl || '/assets/img/userprofile.webp'
            });
            if (immediateStatsHtmlArr.length > 0) renderAIFeedback(immediateStatsHtmlArr);
        } else if (stepData.stepType === "closedResponse" && userResponse && DOM.speechText) {
            safeRenderChatInterface(false);
            appStore.getState().addChatMessage({
                role: 'user',
                type: 'standard',
                content: userResponse,
                statsHtml: "",
                userName: userData?.display_name?.split(' ')[0] || 'User',
                userAvatarUrl: userData?.profilepicurl || '/assets/img/userprofile.webp'
            });
            if (immediateStatsHtmlArr.length > 0) renderAIFeedback(immediateStatsHtmlArr);
        }

        const explanationData = buildExplanationData(result?.explanations, explanation);
        const webFormattedExplanations = renderExplanationsToHTML(explanationData);

        appStore.getState().setTutorChatVisible(true);

        if (isCorrect) {
            if (stepData.stepType === "openResponse") {
                appStore.setState({ cuesGiven: [...appStore.getState().cuesGiven, result.normalizeduserResponse] });
                if (result.cefrLevelDeduction > 0) {
                    appStore.getState().deductListeningScore(result.cefrLevelDeduction);
                }
            }
            handlecueUI(stepIndex, stepData, button, cue, webFormattedExplanations, translation, userResponse, result ? result.cefrLevel : undefined, result ? result.cefrLevelDeduction : undefined, userData, configData, fluencyBubbleHTML);
            showFeedbackAndProceed(stepData, isCorrect, _deps);
        } else {
            handleIncueUI(stepIndex, stepData, button, cue, userResponse, webFormattedExplanations, result ? result.normalizeduserResponse : "", result ? result.normalizedcue : "", stepData.step, false, userData, configData, fluencyBubbleHTML);
            showFeedbackAndProceed(stepData, isCorrect, _deps);
        }

    } catch (error) {
        console.error("Error handling answer:", error);
        handleIncueUI(stepIndex, stepData, button, cue, userResponse, explanation, "", "", translation, false, userData, configData);
        showFeedbackAndProceed(stepData, false, _deps);
    }
}

export function showFeedbackAndProceed(stepData, isCorrect, _deps = {}) {
    const { loadNextStep, callLoadStep } = _deps;

    if ((stepData.stepType === "closedResponse" || stepData.stepType === "openResponse") && stepData.videoUrl) State.stepCount++;
    try {
        appStore.getState().setHintsVisible(false);
        console.log('[showFeedbackAndProceed] stepType:', stepData.stepType, '| isLessonIntro:', stepData.stepType === "lessonIntro");
        const onContinue = () => {
            Media.pauseVideoIfPlaying();
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
                    window.__currentStepIndex = stepIndex;
                    if (callLoadStep) callLoadStep(appStore.getState().configData.lessons[appStore.getState().currentLessonIndex].steps[stepIndex], appStore.getState().configData.lessons[appStore.getState().currentLessonIndex]);
                }
            }
        };

        if (stepData.stepType === "lessonIntro") {
            window.__introContinueCallback = onContinue;
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
