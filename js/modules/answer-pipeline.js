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
import { generateHangmanHint } from './utils.js';
import {
    showChat,
    addAIFeedbackMessages,
    clearChat
} from '../components/chat/chat-interface.js';

function handleCorrectFeedbackUI(stepIndex, stepData, button, cue, explanation, translation, userResponse, englishLevel, englishLevelDeduction, userData, configData, fluencyBubble = null) {
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

    showChat(true);

    const praiseResult = (stepData.stepType === "openResponse" || stepData.stepType === "closedResponse") ? getRandomPraise('general', lang) : "";
    const feedbackText = (stepData.stepType === "openResponse" && englishLevelDeduction > 0)
        ? `${Strings.get('ai_acceptable', lang)}<br>${Strings.get('ai_language_level', lang)} ${englishLevel}<br>${Strings.get('ai_fluency_reduced', lang)} <span style='color:red'>${englishLevelDe[...]
        : getPraiseHTML(praiseResult);

    if (stepData.stepType !== "openResponse" && stepData.stepType !== "closedResponse") {
        const localizedTrans = getLocalizedTranslation(translation, lang);
        const userName = appStore.getState().userData?.display_name?.split(' ')[0] || 'User';
        const userAvatarUrl = appStore.getState().userData?.profilepicurl || '/assets/img/userprofile.webp';

        const translationHTML = (localizedTrans && lang && lang !== 'en')
            ? `<br><span lang="${lang}"><i>${localizedTrans}</i></span>`
            : '';

        const correctBubbleHTML = `<div class="correct-answer-display chat-message-bubble chat-message-bubble--user"><div class="chat-bubble-header d-none">${userName}</div>${cueDisplayHTML}${tran[...]
        const correctWrapperHTML = `<div class="chat-message-row chat-message-row--user correct-answer-wrapper"><img src="${userAvatarUrl}" alt="${userName}" class="chat-avatar-inline" />${correct[...]

        const praiseHTML = getPraiseHTML(getRandomPraise('general', lang));
        const praiseWrapperHTML = `<div class="chat-message-row chat-message-row--system" style="margin-top:6px"><img src="/assets/img/teacherprofile.webp" alt="Joe Walsh" class="chat-avatar-inlin[...]

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

// Ensure languageLevel is normalized to uppercase
export async function submitAnswerPrecheck(val, cue, stepData, btn, explanation, translation, stats = { pauseCount: null, netDuration: null }, _deps = {}, userData = appStore.getState().userData, configData = { languageLevel: 'A0' }) {
    const englishLevel = configData?.languageLevel?.toUpperCase() || 'A0';
    const { isValid, warningMessage } = await validateAnswerPrecheck(
        val, cue, stepData, englishLevel, userData, appStore.getState().cuesGiven
    );

    if (!isValid) {
        const cueText = typeof cue === 'object' ? cue?.en : cue;
        logInteraction(cueText, val, "rej_pre", warningMessage, null, State.interactionLog);
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

        if (stepData.stepType === "closedResponse" && State.player && State.player.controller && State.player.controller.applySpeechResult) {
            const userWords = val.toLowerCase().replace(/[^"]