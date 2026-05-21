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
import { Media } from './media.js';
import Strings from '../data/strings.js';
import { getLocalizedTranslation } from './utils.js';
import { analyzeSpeech } from './analytics.js';
import { updateSpeechRecording } from './storage.js';
import { buildFeedbackData, buildExplanationData } from './feedback-builder.js';
import { renderFeedbackToHTML, renderExplanationsToHTML } from '../components/feedback-renderer.js';
import { getNextStep } from './lessonRouting.js';
import { warmUpSpeechCamStream } from './speech.js';
import {
    DOM,
    showHintsAndScroll,
    hideHints,
    clearMicStatusAndHideMedia,
    showMicWarning,
    showAnswerError,
    clearPlaybackVideo,
    removeWebcamPreview,
    flashElement,
    renderUserChatMessage,
    renderAIFeedback,
    disableAllButtons,
    showContinueButton,
    hideContinueButton,
    renderFallbackContinueButton,
    resetMicStatusWithStep,
    handlecueUI,
    handleIncueUI,
    generateHangmanHint,
    renderHangmanHint,
    prepareMediaUI,
    showPlaybackVideo,
    showTutorChatInput,
    updateChatHeaderScores,
    clearChatInterface
} from '../components/ui.js';

export function handleHint(stepIndex) {
    showHintsAndScroll();
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
        logInteraction(cue, val, "rej_pre", warningMessage, null, State.interactionLog);
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
            removeWebcamPreview();
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
            cue: cue,
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
    if (!State.isTextMode && (stepData.stepType === "lessonIntro" || stepData.stepType === "closedResponse" || stepData.stepType === "openResponse")) {
        showPlaybackVideo();
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
                cue,
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
    clearMicStatusAndHideMedia();
    hideHints();

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
                result = { isCorrect: true, normalizeduserResponse: userResponse, normalizedcue: cue, explanation: explanation, intentLabels: [] };
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
        logInteraction(cue, userResponse, status, pragmaticDetails, grammarCorrection, State.interactionLog);

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

            appStore.getState().setFluencyMetrics({
                fluencyScore: scoreData.fluencyScore,
                flowScore: scoreData.subScores.flow,
                vocabularyScore: scoreData.subScores.vocabulary,
                grammarScore: scoreData.subScores.grammar,
                formalityScore: scoreData.subScores.formality,
                nativeLikeScore: scoreData.subScores.nativeLike,
                understandingScore: scoreData.subScores.understanding
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
            removeWebcamPreview();

            const hangmanHTML = generateHangmanHint(userResponse, cue);
            renderHangmanHint(hangmanHTML);

            showHintsAndScroll();
            prepareMediaUI();

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
            const lang = userData?.native_language;
            const localizedTrans = getLocalizedTranslation(stepData.translation, lang);
            const translationStr = (localizedTrans && lang && lang !== 'en') ? `<br><span lang='${lang}'><i>${localizedTrans}</i></span>` : "";

            renderAIFeedback([`<strong>${cue}${translationStr}</strong>`]);
            renderUserChatMessage(userResponse, "");
            if (immediateStatsHtmlArr.length > 0) renderAIFeedback(immediateStatsHtmlArr);
        } else if (stepData.stepType === "closedResponse" && userResponse && DOM.speechText) {
            renderUserChatMessage(userResponse, "");
            if (immediateStatsHtmlArr.length > 0) renderAIFeedback(immediateStatsHtmlArr);
        }

        const explanationData = buildExplanationData(result?.explanations, explanation);
        const webFormattedExplanations = renderExplanationsToHTML(explanationData);

        showTutorChatInput();

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
        hideHints();
        const continueButton = showContinueButton(stepData.stepType === "lessonIntro", () => {
            Media.pauseVideoIfPlaying();
            if (stepData.stepType === "lessonIntro") {
                const initializeMedia = async () => {
                    await Media.enableAudioSystem();
                    await warmUpSpeechCamStream();
                };
                initializeMedia();
            }
            hideContinueButton();
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
        });

        if (isCorrect || appStore.getState().incorrectAttempts > 2) {
            const nextStep = getNextStep(stepData, appStore.getState().configData, appStore.getState().currentLessonIndex);
            if (nextStep && nextStep.videoUrl) {
                const videoUrl = `https://firebasestorage.googleapis.com/v0/b/cogdexapptest.appspot.com/o/videos%2F${nextStep.videoUrl}.mp4?alt=media`;
                Media.preloader.preloadOnly(videoUrl);
            }
        }
    } catch (error) {
        renderFallbackContinueButton(Strings.get('btn_continue', appStore.getState().userData?.native_language) || 'Continue', () => {
            if (isCorrect || appStore.getState().incorrectAttempts > 2) {
                if (loadNextStep) loadNextStep(stepData);
            } else if (callLoadStep) callLoadStep(stepData, appStore.getState().configData.lessons[appStore.getState().currentLessonIndex]);
        });
    }
}
