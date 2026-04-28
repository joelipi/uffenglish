
import { clearSpeechRecordingsForLesson, updateSpeechRecording } from './modules/storage.js';

// Initialize the background NLP Worker via blob URL to bypass service worker caching
const workerResponse = await fetch('js/nlp-worker.js');
const workerBlob = await workerResponse.blob();
const workerObjectUrl = URL.createObjectURL(workerBlob);
const aiWorker = new Worker(workerObjectUrl, { type: 'module' });
let messageIdCounter = 0;
let nlpModelsReady = false;

// Crash/parse errors on the worker surface here instead of dying silently
aiWorker.onerror = (e) => {
    console.error("❌ NLP Worker crashed or failed to load:", {
        message: e.message,
        filename: e.filename,
        lineno: e.lineno,
        colno: e.colno,
        error: e.error
    });
};

aiWorker.addEventListener('messageerror', (e) => {
    console.error("❌ Worker message error:", e);
});

// Helper function to send messages to the worker and wait for the response
function askWorker(action, payload = {}, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
        const id = ++messageIdCounter;

        const timer = setTimeout(() => {
            aiWorker.removeEventListener('message', handleMessage);
            reject(new Error(`NLP Worker timeout waiting for action: ${action}`));
        }, timeoutMs);

        const handleMessage = (event) => {
            if (event.data.id === id) {
                clearTimeout(timer);
                aiWorker.removeEventListener('message', handleMessage);
                if (event.data.status === 'error') reject(new Error(event.data.error));
                else resolve(event.data.data);
            }
        };

        aiWorker.addEventListener('message', handleMessage);
        aiWorker.postMessage({ id, action, payload });
    });
}

// REMOVE IN PRODUCTION
window.askWorker = askWorker;

// --- UI & Media Components (Root Directory) ---
import { InteractiveVideoPlayer } from './video.js'; 
import { simpleVideoPlayer } from './simpleVideo.js'; 
import { introBackgroundVideo } from './introBackgroundVideo.js'; 
import { SuccessLessonHandler } from './successLesson.js'; 
import { pointLoss } from './pointLossAnimation.js'; 
import { initVideoProcessor } from './video-processing-module.js'; 

import { calculateCurrentStreak } from './modules/userProfile.js';
import { updateActivityDisplay } from './modules/ui.js';

// --- Data & Configuration ---
import Strings from './data/strings.js';

/**
 * Gets the localized string from a translation object or string.
 * @param {string|object} translationData - The translation string or object (e.g. { es: "Hola" }).
 * @param {string} lang - The user's native language code (e.g., 'es').
 * @returns {string} - The extracted string.
 */
function getLocalizedTranslation(translationData, lang) {
    if (!translationData) return '';
    if (typeof translationData === 'string') return translationData;
    return translationData[lang] || '';
}

// --- Decoupled Business Logic (Modules Directory) ---
import { calculateRepeatAverage, calculateRolePlayAverage, calculateAverage } from './modules/scoring.js';
import { isUserLoggedIn, getUserProfile } from './modules/api.js';
import { saveCourseToUserProfile, saveLessonProgress, syncOfflineScores } from './modules/userProfile.js';

import {
    isIOS,
    warmUpSpeechCamStream,
    ensureWebcamPreview,
    hideWebcamPreview,
    removeWebcamPreview,
    startSpeechCamRecording,
    stopSpeechCamRecording,
    clearPlaybackVideo,
    toggleSpeechRecognition,
    isListening,
    initLocalVoiceAI
} from './modules/speech.js';

import {
    getCurrentQuestionIndex,
    isLastAiQuestionInLesson,
    processAnswerLogic,
    runPreflightChecks
} from './modules/answers.js';
import getRandomPraise from './modules/praise.js'; 

// --- Extracted Modules ---
import { State } from './modules/state.js';
import { analyzeSpeech } from './modules/analytics.js';
import { Media } from './modules/media.js';
import { 
    DOM, 
    flashElement, 
    updateCurrentScoreDisplay, 
    updateDayCountDisplay, 
    disableAllButtons, 
    clearChatInterface, 
    safeRenderChatInterface,
    showHintsAndScroll,
    hideHints,
    clearMicStatusAndHideMedia,
    setMicStatusText,
    updateSpeakingScoreDisplay,
    showPlaybackVideo,
    markButtonAsCorrect,
    markButtonAsIncorrect,
    animateHeartLoss,
    resetHeartsUI,
    showContinueButton,
    hideContinueButton,
    renderFallbackContinueButton,
    resetUIForNewQuestion,
    toggleScoresAndHearts,
    removeRepeatButton,
    prepareMediaUI,
    clearMediaContainerAndPreservePlayers,
    renderImageInMediaContainer,
    renderYoutubeInMediaContainer,
    resetAnswersContainer,
    renderSpeechInputUI,
    renderTextInputUI,
    updateProgressAndCloseButton,
    setProgressBarWidth,
    hideAnswerDiv,
    bindProcessButton,
    renderMultiChoiceUI,
    showMessageInQuestionsContainer,
    showErrorMessageInQuestionsContainer,
    setupLessonUI
} from './modules/ui.js';

import { idiomChecker } from './modules/idiomChecker.js';
import { calculateSyntacticComplexity } from './modules/complexity.js';
import swearjar from './modules/swearjar.js';

const hearts = [DOM.heart1, DOM.heart2, DOM.heart3];

// Speaking Score Logic ---
window.addEventListener('transcriptRejected', () => {
    // Initialize if not present
    if (typeof State.speakingScore === 'undefined') State.speakingScore = 100;
    
    // Deduct 20 points, floor at 0
    State.speakingScore = Math.max(0, State.speakingScore - 20);
    
    // Update the UI
    updateSpeakingScoreDisplay(State.speakingScore);
    if (DOM.phrasesScore) {
        flashElement(DOM.phrasesScore);
        // Show point loss animation explicitly on the score span
        pointLoss.show(DOM.phrasesScore, 20); 
    }
});

// 🤖🤖🤖🤖🤖🤖🤖🤖 LOCAL NLP HELPERS 🤖🤖🤖🤖🤖🤖🤖🤖

async function checkGrammarLocally(userInput) {
    console.groupCollapsed(`📝 [Grammar Check] Analyzing: "${userInput}"`);

    if (!nlpModelsReady) {
        console.warn("⚠️ Aborted: Local NLP models are not fully loaded yet.");
        console.groupEnd();
        return null;
    }

    if (!userInput) {
        console.log("ℹ️ Aborted: Empty input.");
        console.groupEnd();
        return null;
    }

    try {
        const result = await askWorker('CHECK_GRAMMAR', { userInput });
        console.log("🔍 Raw worker result:", JSON.stringify(result));

        if (result.escalated) {
            console.log("ℹ️ Escalated: Trivial correction (punctuation/case only). Skipping to Tier 2.");
            console.groupEnd();
            return null;
        }

        if (result.isValid) {
            console.log("✅ Passed: Model made zero changes or input too short.");
            console.groupEnd();
            return { isValid: true, correction: null };
        }

        // Valid correction found
        console.log(`✨ Valid Correction Triggered! Building diff UI...`);
        const { userHTML, corrHTML } = buildGrammarDiff(result.cleanedInput, result.correction);
        console.groupEnd();

        return {
            isValid: false,
            correction: result.correction,
            explanation: `
                <div class="diff-del-bubble">${userHTML}</div>
                <div style="margin-top:6px">${corrHTML}</div>`
        };

    } catch (error) {
        console.error("❌ Fatal Error in Local Grammar Check:", error);
        console.groupEnd();
        return null;
    }
}

// REMOVE IN PRODUCTION. Add this line right after the checkGrammarLocally function closes
window.testGrammar = checkGrammarLocally;

async function evaluateIntentLocally(userInput, targetIntents, badIntents = []) {
    if (!nlpModelsReady || !targetIntents || targetIntents.length === 0) return null;

    try {
        console.log("⏳ Running zero-shot classification check...");

        const result = await askWorker('EVALUATE_INTENT', { userInput, targetIntents, badIntents });

        if (result.isCorrect) {
            console.log(`🎯 Local Target Match! Label: "${result.winningLabel}" (Score: ${result.winningScore.toFixed(2)})`);
            return {
                isCorrect: true,
                category: result.category,
                winningLabel: result.winningLabel,
                normalizeduserResponse: userInput,
                englishLevel: State.englishLevel,
                englishLevelDeduction: 0,
                explanation: null,
                normalizedcue: result.winningLabel
            };
        }

        console.log(`❌ Local Target Check Failed. Label: "${result.winningLabel}" (Category: ${result.category}, Score: ${result.winningScore.toFixed(2)})`);
        return {
            isCorrect: false,
            category: result.category,
            winningLabel: result.winningLabel,
            normalizeduserResponse: userInput,
            normalizedcue: result.winningLabel,
            englishLevel: State.englishLevel,
            englishLevelDeduction: 0,
            explanation: null
        };

    } catch (error) {
        console.error("Local intent evaluation error:", error);
        return null;
    }
}

// REMOVE IN PRODUCTION. To be able to test it in browser console
window.testIntent = evaluateIntentLocally;

// 🎓🎓🎓🎓🎓🎓🎓🎓 CORE ANSWER HANDLING 🎓🎓🎓🎓🎓🎓🎓🎓


function handleHint(qIndex) {
    showHintsAndScroll();
}

async function submitAnswerPrecheck(val, cue, questionData, btn, explanation, translation, stats = { pauseCount: null, netDuration: null }) {
    if (questionData.inputType === "ai") {
        const wordCount = val.trim().split(/\s+/).length;
        let minWordsRequired = 3;
        let warningMessage = Strings.get('min_words_3', State.userData?.native_language);

        if (State.englishLevel === 'A2') { minWordsRequired = 4; warningMessage = Strings.get('min_words_4', State.userData?.native_language); }
        else if (State.englishLevel === 'B1') { minWordsRequired = 5; warningMessage = Strings.get('min_words_5', State.userData?.native_language); }
        else if (State.englishLevel === 'B2' || State.englishLevel === 'C1' || State.englishLevel === 'C2') { minWordsRequired = 6; warningMessage = Strings.get('min_words_6', State.userData?.native_language); }

        const hasAsterisks = /\*{2,}/.test(val);
        const isProfane = swearjar.profane(val);

        if (wordCount < minWordsRequired || hasAsterisks || isProfane) {
            if (hasAsterisks) {
                warningMessage = Strings.get('censored', State.userData?.native_language);
            } else if (isProfane) {
                warningMessage = Strings.get('inappropriate', State.userData?.native_language);
            }

            State.currentPoints = Math.max(0, State.currentPoints - 10);
            updateCurrentScoreDisplay(State.currentPoints);
            if (DOM.phrasesScore) {
                flashElement(DOM.phrasesScore);
                pointLoss.show(DOM.phrasesScore, 10);
            }

            if (DOM.micStatusText) {
                DOM.micStatusText.innerHTML = `<div class='text-center text-danger'>${warningMessage}</div>`;
            }

            if (btn) btn.disabled = false;

            return;
        }
    }
    await handleAnswer(val, cue, questionData, btn, explanation, translation, stats);
}

async function handleAnswer(userResponse, cue, questionData, button, explanation, translation, stats = { pauseCount: null, netDuration: null }) {
    try {
        const currentLessonId = (State && State.configData && State.configData.lessons && State.configData.lessons[State.currentLessonIndex]) ? State.configData.lessons[State.currentLessonIndex].lessonId : 'unknown_lesson';
        const qIndex = getCurrentQuestionIndex(questionData, State.configData, State.currentLessonIndex);
                let analyticsToSave = {};
        if (stats && stats.netDuration !== null) {
            analyticsToSave = await analyzeSpeech(userResponse, stats.netDuration, stats.pauseCount, State.courseId ? State.courseId.substring(0,2).toUpperCase() : 'A1');
        }
        await updateSpeechRecording(currentLessonId, qIndex, {
            userResponse,
            cue,
            wpm: analyticsToSave.wpm,
            pauseCount: analyticsToSave.pauseCount,
            complexityScore: analyticsToSave.complexityScore
        });
        console.log("Successfully updated speech recording with answers");
    } catch(e) {
        console.error("Error updating speech recording with answers", e);
    }

    Media.pauseVideoIfPlaying();
    
    clearMicStatusAndHideMedia();

    let speechAnalytics = null;
    let immediateStatsHtml = "";

    if (questionData.inputType === "speech" || questionData.inputType === "ai") {
        speechAnalytics = await analyzeSpeech(userResponse, stats.netDuration, stats.pauseCount, State.courseId ? State.courseId.substring(0,2).toUpperCase() : 'A1');

        // Build immediate stats bubble
        let statsParts = [];
        if (speechAnalytics.wpm !== null) {
            statsParts.push(`<strong>${Strings.get('stats_wpm', State.userData?.native_language)}:</strong> ${speechAnalytics.wpm}`);
        }
        if (speechAnalytics.pauseCount !== null) {
            statsParts.push(`<strong>${Strings.get('stats_pauses', State.userData?.native_language)}:</strong> ${speechAnalytics.pauseCount}`);
        }
        if (speechAnalytics.complexityScore !== null) {
            statsParts.push(`<strong>${Strings.get('stats_complexity', State.userData?.native_language)}:</strong> ${speechAnalytics.complexityScore} <br><small>(${speechAnalytics.complexityScoreBreakdown})</small>`);
        }

        if (statsParts.length > 0) {
            immediateStatsHtml = `
            <div class='chat-bubble chat-msg' style='margin-bottom: 12px; display: block; border-left: 4px solid #17a2b8;'>
                <div style='font-size: 0.85em; text-transform: uppercase; color: #17a2b8; margin-bottom: 5px;'><strong>${Strings.get('stats_header', State.userData?.native_language)}</strong></div>
                ${statsParts.join('<br>')}
            </div>`;
        }
    }

    if (questionData.inputType === "ai" && userResponse && DOM.speechText) {
        const bodyContent = `
            <div class='userResponse chat-bubble-sent chat-msg'>${userResponse}</div>
            ${immediateStatsHtml}
            <div class='chat-bubble chat-msg' id='ai-loading-status'>
                <strong><span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Analyzing your response...</strong>
            </div>`;
        safeRenderChatInterface(true, bodyContent);
    } else if (questionData.inputType === "speech" && userResponse && DOM.speechText && immediateStatsHtml) {
        // Just show stats for non-AI speech inputs
        const bodyContent = `
            <div class='userResponse chat-bubble-sent chat-msg'>${userResponse}</div>
            ${immediateStatsHtml}`;
        safeRenderChatInterface(true, bodyContent);
    }

    const qIndex = getCurrentQuestionIndex(questionData, State.configData, State.currentLessonIndex);
    window.__currentQuestionIndex = qIndex;
    disableAllButtons(button.parentElement);

    try {
        let result = null;

        // 🛑 TIER 0: PREFLIGHT BUSINESS LOGIC
        if (questionData.inputType === "ai") {
            const preflight = await runPreflightChecks({
                userResponse, cue, questionData, lesson: State.lesson,
                englishLevel: State.englishLevel, userData: State.userData, cuesGiven: State.cuesGiven
            });

            if (!preflight.passed) {
                console.warn("⚠️ Answer blocked by preflight safety checks.");
                result = preflight.result; 
            }
        }

        // --- TIERED EVALUATION LOGIC ---
        if (!result && questionData.inputType === "ai" && questionData.targetIntents) {
            
            // 1. The FEEDBACK_TEXT parameter (Forced visual separation)
            const originalExplanationBubble = explanation ? `<div class='chat-bubble chat-msg' style='margin-top: 12px; display: block;'>${explanation}</div>` : "";

            // 2. TIER 1: Grammar Check
            const grammarResult = await checkGrammarLocally(userResponse);
            let grammarExplanationHTML = null;
            let cleanedSentence = userResponse;
            let isGrammarPerfect = true;

            if (grammarResult && !grammarResult.isValid) {
                isGrammarPerfect = false;
                cleanedSentence = grammarResult.correction;
                const { userHTML, corrHTML } = buildGrammarDiff(userResponse, grammarResult.correction);
                grammarExplanationHTML = `
                    <div class='chat-bubble chat-msg' style='margin-top: 12px; display: block;'>
                        <div class="diff-del-bubble">${userHTML}</div>
                        <div style="margin-top:6px">${corrHTML}</div>
                    </div>`;
            } else {
                const syntComplexity = calculateSyntacticComplexity(userResponse);
                grammarExplanationHTML = `
                    <div class='chat-bubble chat-msg' style='margin-top: 12px; display: block;'>
                        ${Strings.get('grammar_perfect', State.userData?.native_language)}
                        <hr style="margin: 8px 0; opacity: 0.1;">
                        <div style="font-size: 0.85em;">
                            <strong>Syntactical Complexity:</strong> ${syntComplexity.score}%
                            <br><small style="opacity: 0.7;">(${syntComplexity.breakdown})</small>
                        </div>
                    </div>`;
            }

            // 3. TIER 2: Semantic Intent Match
            const intentResult = await evaluateIntentLocally(cleanedSentence, questionData.targetIntents, questionData.badIntents);

            if (intentResult) {
                let intentExplanationHTML = "";
                let isFinalCorrect = false;

                if (isGrammarPerfect && intentResult.category === 'target') {
                    isFinalCorrect = true;
                    intentExplanationHTML = `<div class='chat-bubble chat-msg' style='margin-top: 12px; display: block;'>${Strings.get('intent_perfect', State.userData?.native_language)}</div>`;
                }
                else if (!isGrammarPerfect && intentResult.category === 'target') {
                    isFinalCorrect = true;
                    intentExplanationHTML = `<div class='chat-bubble chat-msg' style='margin-top: 12px; display: block;'>${Strings.get('intent_good_grammar_bad', State.userData?.native_language)}</div>`;
                }
                else if (intentResult.category === 'bad') {
                    isFinalCorrect = false;
                    let badIntentStr = Strings.get('intent_specific_fail', State.userData?.native_language);
                    const localizedBadIntent = Strings.get(intentResult.winningLabel, State.userData?.native_language) || intentResult.winningLabel;
                    badIntentStr = badIntentStr.replace('{bad_intent}', localizedBadIntent);
                    intentExplanationHTML = `<div class='chat-bubble chat-msg' style='margin-top: 12px; display: block;'>${badIntentStr}</div>`;
                }
                else if (isGrammarPerfect && intentResult.category === 'distractor') {
                    isFinalCorrect = false;
                    intentExplanationHTML = `<div class='chat-bubble chat-msg' style='margin-top: 12px; display: block;'>${Strings.get('intent_bad_grammar_perfect', State.userData?.native_language)}</div>`;
                }
                else if (!isGrammarPerfect && intentResult.category === 'distractor') {
                    isFinalCorrect = false;
                    intentExplanationHTML = `<div class='chat-bubble chat-msg' style='margin-top: 12px; display: block;'>${Strings.get('intent_bad_grammar_bad', State.userData?.native_language)}</div>`;
                }

                // 🏗️ Build the final stacked output using an array to guarantee order
                const combinedExplanation = [
                    grammarExplanationHTML,        // 1st
                    intentExplanationHTML,         // 2nd
                    originalExplanationBubble      // 3rd (Feedback Text)
                ].filter(Boolean).join("");

                result = {
                    isCorrect: isFinalCorrect,
                    normalizeduserResponse: userResponse,
                    normalizedcue: intentResult.normalizedcue,
                    explanation: combinedExplanation,
                    englishLevelDeduction: intentResult.englishLevelDeduction || 0
                };
            } else {
                if (!isGrammarPerfect) {
                    const fallbackExplanation = [
                        grammarExplanationHTML,       // 1st
                        originalExplanationBubble     // 2nd (Feedback Text)
                    ].filter(Boolean).join("");

                    result = {
                        isCorrect: false,
                        normalizeduserResponse: userResponse,
                        normalizedcue: grammarResult.correction,
                        explanation: fallbackExplanation
                    };
                }
            }
        }

        if (!result) {
            console.warn("⚠️ No result from local NLP — no Gemini fallback active. Treating as passed.");
            const defaultExplanationBubble = explanation ? `<div class='chat-bubble chat-msg' style='margin-top: 12px; display: block;'>${explanation}</div>` : null;
            result = { isCorrect: true, normalizeduserResponse: userResponse, normalizedcue: cue, explanation: defaultExplanationBubble };
        }
        // --- END TIERED EVALUATION ---

        const isCorrect = result.isCorrect;

        if (isCorrect) {
            if (questionData.inputType === "ai") {
                State.cuesGiven.push(result.normalizeduserResponse);
                if (result.englishLevelDeduction > 0) {
                    State.currentPoints = Math.max(0, State.currentPoints - result.englishLevelDeduction);
                    updateCurrentScoreDisplay(State.currentPoints);
                }
            }
            handlecueUI(qIndex, questionData, button, cue, result.explanation || explanation, translation, userResponse, result.englishLevel, result.englishLevelDeduction);
        } else {
            handleIncueUI(qIndex, questionData, button, cue, userResponse, result.explanation || explanation, result.normalizeduserResponse, result.normalizedcue, questionData.question);
        }

        showFeedbackAndProceed(questionData, isCorrect, State.currentLessonIndex, qIndex);
    } catch (error) {
        console.error("Error handling answer:", error);
        handleIncueUI(qIndex, questionData, button, cue, userResponse, explanation, "", "", translation);
        showFeedbackAndProceed(questionData, false, State.currentLessonIndex, qIndex);
    }
}

function handlecueUI(qIndex, questionData, button, cue, explanation, translation, userResponse, englishLevel, englishLevelDeduction) {

  if (questionData.inputType === "speech" && questionData.videoUrl) State.repeatPointsHistory.push(State.currentPoints);
  if (questionData.inputType === "ai" && questionData.videoUrl) State.rolePlayPointsHistory.push(State.currentPoints);

  // Unified: last AI question advances via Continue button like all others.

  if (DOM.speechText) {
      let userResponseHTML = userResponse ? `<div class='userResponse chat-bubble-sent chat-msg'>${userResponse}</div>` : "";
      
      // Smart wrap - Do not double-wrap if it's already a chat bubble stack!
      let explanationHTML = "";
      if (explanation) {
          if (explanation.includes("class='chat-bubble")) {
              explanationHTML = explanation; 
          } else {
              explanationHTML = `<div class='chat-bubble chat-msg' style='margin-top: 12px;'><p class='explanation'>${explanation}</p></div>`;
          }
      }
      
      let headsUpHTML = questionData.headsUp ? `<div class='chat-bubble chat-msg' style='margin-top: 12px;'><p class='headsUp'>${questionData.headsUp}</p></div>` : "";

      if (questionData.inputType === "ai") {
          updateSpeakingScoreDisplay(State.speakingScore); // NEW SPEAKING SCORE DISPLAY
          flashElement(DOM.phrasesScore); 
          
          const lang = State.userData?.native_language;
          const feedbackText = englishLevelDeduction > 0
          ? `${Strings.get('ai_acceptable', lang)}<br>${Strings.get('ai_language_level', lang)} ${englishLevel}<br>${Strings.get('ai_fluency_reduced', lang)} <span style='color:red'>${englishLevelDeduction} ${Strings.get('ai_percentage_points', lang)}</span>.`
          : getRandomPraise();
          
          // 🛠️ FIX: Reordered so explanationHTML comes BEFORE the feedbackText
          const bodyContent = `${userResponseHTML}${explanationHTML}<div class='chat-bubble chat-msg' style='margin-top: 12px;'><strong>${feedbackText}</strong></div>${headsUpHTML}`;
          safeRenderChatInterface(true, bodyContent);
      }
      else {
          if (questionData.inputType === "speech") { 
              updateSpeakingScoreDisplay(State.speakingScore); // NEW SPEAKING SCORE DISPLAY
              flashElement(DOM.phrasesScore); 
          }
          const lang = State.userData?.native_language;
          const localizedTrans = getLocalizedTranslation(translation, lang);
          const translationStr = localizedTrans && lang && lang !== 'en' ? `<br><span lang='${lang}'><i>${localizedTrans}</i></span>` : "";
          
          // 🛠️ FIX: Reordered so explanationHTML comes BEFORE the praise
          const bodyContent = `<div class='correct-answer-display chat-bubble-sent chat-msg'>${cue}${translationStr}</div>${explanationHTML}<div class='chat-bubble chat-msg' style='margin-top: 12px;'><strong>${getRandomPraise()}</strong></div>${headsUpHTML}`;
          safeRenderChatInterface(false, bodyContent);
      }
  }

  Media.playSound('correct-sound');

  if (questionData.inputType === "lessonIntro" || questionData.inputType === "speech" || questionData.inputType === "ai") {
    showPlaybackVideo();
  }

  markButtonAsCorrect(button);
}

function handleIncueUI(qIndex, questionData, button, cue, userResponse, explanation, normalizeduserResponse, normalizedcue, question) {
  State.incorrectAttempts++;

  if (questionData.inputType === "lessonIntro" || questionData.inputType === "speech" || questionData.inputType === "ai") {
    showPlaybackVideo();
  }

  if ((questionData.inputType === "speech" || questionData.inputType === "ai") && questionData.videoUrl) {
      State.currentPoints = Math.max(0, State.currentPoints - 25);
      pointLoss.show(DOM.micStatusText, 25); // Current points acts as Listening Score penalty
      updateCurrentScoreDisplay(State.currentPoints);
      if (State.incorrectAttempts > 2) {
        State.currentPoints = 0; 
        updateCurrentScoreDisplay(State.currentPoints);
        updateSpeakingScoreDisplay(State.speakingScore); // NEW SPEAKING SCORE DISPLAY
        State.rolePlayPointsHistory.push(State.currentPoints);
      }
  }

  if (questionData.inputType === "ai" && userResponse) {
      if (State.incorrectAttempts > 2) { 
          State.currentPoints = 0; 
          State.rolePlayPointsHistory.push(State.currentPoints); 
          updateCurrentScoreDisplay(State.currentPoints); 
      }
      const teacherText = State.incorrectAttempts === 1 ? Strings.get('try_again_1', State.userData?.native_language) : State.incorrectAttempts === 2 ? Strings.get('try_again_2', State.userData?.native_language) : `${Strings.get('failed_continue_correct', State.userData?.native_language)}<br>"${cue}"`;
      const headsUpHTML = questionData.headsUp ? (State.incorrectAttempts <= 2 ? `<div class='chat-bubble chat-msg' style='margin-top: 12px;'><p class="headsUp">${Strings.get('heads_up_try_again', State.userData?.native_language)}</p></div>` : `<div class='chat-bubble chat-msg' style='margin-top: 12px;'><p class="headsUp">${questionData.headsUp}</p></div>`) : '';
      const possibleAnswerHTML = questionData.possibleAnswer && State.incorrectAttempts > 2 ? `<div class='chat-bubble chat-msg' style='margin-top: 12px;'><p>${Strings.get('example_correct_answer', State.userData?.native_language)}<br>${questionData.possibleAnswer}</p></div>` : '';
      
      // Smart wrap
      let explanationHTML = "";
      if (explanation) {
          if (explanation.includes("class='chat-bubble")) {
              explanationHTML = explanation; 
          } else {
              explanationHTML = `<div class='chat-bubble chat-msg' style='margin-top: 12px;'><p class='explanation'>${explanation}</p></div>`;
          }
      }

      // 🛠️ FIX: Reordered so explanationHTML comes BEFORE the teacherText bubble
      const bodyContent = `<div class='chat-bubble-sent chat-msg'>${userResponse}</div>${explanationHTML}<div class='chat-bubble chat-msg' style='margin-top: 12px;'><strong> ${teacherText} </strong></div>${possibleAnswerHTML}${headsUpHTML}`;
      safeRenderChatInterface(true, bodyContent);
  }

  if (questionData.inputType === "speech" && userResponse && DOM.speechText) {
      const selectedWords = [...new Set(normalizeduserResponse.split(/\s+/))]; 
      const correctWords = [...new Set(normalizedcue.split(/\s+/))]; 
      const correctWordSet = new Set(correctWords.map(w => w.toLowerCase()));
      const correct = new Set(); const incorrect = new Set();

      selectedWords.forEach(w => correctWordSet.has(w.toLowerCase()) ? correct.add(w) : incorrect.add(w));

      const correctUl = `<ul class='card-text correctWords list-inline' id='correctWords'>${Array.from(correct).map(w => `<li class='list-inline-item'>${w}</li>`).join('')}</ul>`;
      const incorrectUl = `<ul class='card-text incorrectWords list-inline' id='incorrectWords'>${Array.from(incorrect).map(w => `<li class='list-inline-item'>${w}</li>`).join('')}</ul>`;   

      const teacherText = State.incorrectAttempts === 1 ? Strings.get('try_again_1', State.userData?.native_language) : State.incorrectAttempts === 2 ? Strings.get('try_again_2', State.userData?.native_language) : `${Strings.get('failed_continue', State.userData?.native_language)}<br><br>Correct:<br>"${cue}"`;
      const headsUpHTML = questionData.headsUp ? (State.incorrectAttempts <= 2 ? `<p class="headsUp">${Strings.get('heads_up_repeat_video', State.userData?.native_language)}</p>` : `<p class="headsUp">${questionData.headsUp}</p>`) : '';
      
      const bodyContent = `<div class='chat-bubble chat-msg' style='margin-top: 12px;'><strong> ${teacherText} </strong><br><br>${correctUl}${incorrectUl}</div><div class='chat-bubble chat-msg' style='margin-top: 12px;'>${headsUpHTML}</div>`;
      safeRenderChatInterface(false, bodyContent);
  }

  animateHeartLoss(State.incorrectAttempts);
  
  Media.playSound('incorrect-sound');

  const answersContainer = button.parentElement;
  if (questionData.inputType !== "text") {
      markButtonAsIncorrect(button, answersContainer, cue);
  } else {
      markButtonAsIncorrect(button, null, null);
  }
}

function showFeedbackAndProceed(questionData, isCorrect) {
  if ((questionData.inputType === "speech" || questionData.inputType === "ai") && questionData.videoUrl) State.questionCount++;

  try {
    hideHints();

    const continueButton = showContinueButton(questionData.inputType === "lessonIntro", () => {
      if (questionData.inputType === "lessonIntro") {    
          const initializeMedia = async () => {
              await Media.enableAudioSystem();
              await warmUpSpeechCamStream();
          };
          initializeMedia();
      }
      
      hideContinueButton();
      if (questionData.inputType === "lessonIntro") {    
        setTimeout(() => loadNextQuestion(questionData), 2000);
      } else {
        if (isCorrect || State.incorrectAttempts > 2) loadNextQuestion(questionData);
        else {
            const qIndex = getCurrentQuestionIndex(questionData, State.configData, State.currentLessonIndex);
            window.__currentQuestionIndex = qIndex;
            loadQuestion(State.configData.lessons[State.currentLessonIndex].questions[qIndex], State.configData.lessons[State.currentLessonIndex]);
        }
      }
    });

    if (isCorrect || State.incorrectAttempts > 2) {
      const nextQuestion = getNextQuestion(questionData);
      if (nextQuestion && nextQuestion.videoUrl) {
        const videoUrl = `https://firebasestorage.googleapis.com/v0/b/cogdexapptest.appspot.com/o/videos%2F${nextQuestion.videoUrl}.mp4?alt=media`;
        Media.preloader.preloadOnly(videoUrl);
      }
    }

  } catch (error) {
    renderFallbackContinueButton(Strings.get('btn_continue', State.userData?.native_language) || 'Continue', () => {
        if (isCorrect || State.incorrectAttempts > 2) loadNextQuestion(questionData);
        else loadQuestion(questionData, State.configData.lessons[State.currentLessonIndex]);
    });
  }
}

// ➡➡➡➡➡➡➡➡⛰🗻 ADVANCE VIEWS CORE HOLY OF HOLIES ➡➡➡➡➡➡➡➡⛰🗻

// Temporarily commented out alert
function beforeUnloadHandler(e) { /* e.preventDefault(); e.returnValue = ''; return ''; */ }

function loadQuestion(question, lesson, fluencyData) {
  window.__currentQuestionIndex = getCurrentQuestionIndex(question, State.configData, State.currentLessonIndex);
  clearChatInterface(); // Clear FIRST so the card collapses before we scroll
  window.scrollTo({ top: 0, behavior: 'smooth' });

  resetUIForNewQuestion(question.inputType === 'lessonIntro', !!State.userData);

  Media.cleanupPreviousPlayers();
  clearPlaybackVideo();

  toggleScoresAndHearts((question.inputType === 'speech' || question.inputType === 'ai') && question.videoUrl);

  if (question.inputType === 'speech' || question.inputType === 'ai') {
      ensureWebcamPreview();
      if (isIOS) {
          const closePageLink = document.getElementById('closePage');
          if (closePageLink) {
              closePageLink.removeEventListener('click', handleClosePageClick);
              function handleClosePageClick(e) { if (!confirm(Strings.get('alert_lesson_reset', State.userData?.native_language))) e.preventDefault(); }
              closePageLink.addEventListener('click', handleClosePageClick);
          }
      } else {
          window.removeEventListener('beforeunload', beforeUnloadHandler);
          window.addEventListener('beforeunload', beforeUnloadHandler);
      }
  } else {
      hideWebcamPreview();
      window.removeEventListener('beforeunload', beforeUnloadHandler);
  }

  if (question.inputType != 'lessonComplete' && question.inputType != 'unitComplete') {
      removeRepeatButton();
  }

  if (question.inputType === 'speech' || question.inputType === 'ai') {
    ensureWebcamPreview();
    State.speakingScore = 100; // Reset speaking score for this question
    updateSpeakingScoreDisplay(State.speakingScore);
  }

  prepareMediaUI();

  clearMediaContainerAndPreservePlayers();

  if (question.image) {
      renderImageInMediaContainer(question.image);
  }
  if (question.youtube) {
      renderYoutubeInMediaContainer(question.youtube);
  }

if (question.videoUrl) {
    const currentVideoUrl = (window.preloadedMedia && window.preloadedMedia[question.videoUrl]) 
        ? window.preloadedMedia[question.videoUrl] 
        : `https://firebasestorage.googleapis.com/v0/b/cogdexapptest.appspot.com/o/videos%2F${question.videoUrl}.mp4?alt=media`;
    State.player = new InteractiveVideoPlayer({
      videoUrl: currentVideoUrl, cue: question.cue, containerSelector: '#ivp-container',
      videoStyles: { maxWidth: '100%' },
      subtitleStyles: { fontSize: '24px', backgroundColor: 'rgba(0, 0, 0, 0.8)' }
    });
    window.currentVideoPlayer = State.player;

    setTimeout(() => {
      try {
        const videoEl = State.player.video; videoEl.muted = false; videoEl.setAttribute('playsinline', '');
        const playPromise = State.player.play(); 
        if (playPromise !== undefined) playPromise.catch(error => {});
      } catch (e) {}
    }, 200); 

    State.player.video.addEventListener('playing', () => State.player.video.controls = false);
    State.player.video.addEventListener('play', () => {
      State.videoPlays++;
      if (State.videoPlays > 2 && (question.inputType === "speech" || question.inputType === "ai")) {
          State.currentPoints = Math.max(0, State.currentPoints - 10);        
          pointLoss.show(State.player.video, 10);
          updateCurrentScoreDisplay(State.currentPoints);
      }
    });

    State.player.video.addEventListener('click', () => {
      State.videoClicks++;
      if (State.videoClicks % 2 === 1 && (question.inputType === "speech" || question.inputType === "ai")) {
        State.currentPoints = Math.max(0, State.currentPoints - 15);
        pointLoss.show(State.player.video, 15);
        updateCurrentScoreDisplay(State.currentPoints);
      }
    });
  }

if (question.simpleVideoUrl) {
    const currentVideoUrl = (window.preloadedMedia && window.preloadedMedia[question.simpleVideoUrl]) 
        ? window.preloadedMedia[question.simpleVideoUrl] 
        : `https://firebasestorage.googleapis.com/v0/b/cogdexapptest.appspot.com/o/videos%2F${question.simpleVideoUrl}.mp4?alt=media`;
    State.player = new simpleVideoPlayer({
      videoUrl: currentVideoUrl, subtitles: question.subtitles, containerSelector: '#simple-ivp-container',
      videoStyles: { maxWidth: '100%' },
      subtitleStyles: { fontSize: '24px', backgroundColor: 'rgba(0, 0, 0, 0.8)' }
    });
    window.currentSimpleVideoPlayer = State.player;

    setTimeout(() => {
      try {
        const videoEl = State.player.video; videoEl.muted = false;
        const playPromise = State.player.play(); 
        if (playPromise !== undefined) playPromise.catch(error => {});
      } catch (e) {}
    }, 200); 
  }

if (question.introBackgroundVideoUrl) {
    const currentVideoUrl = (window.preloadedMedia && window.preloadedMedia[question.introBackgroundVideoUrl]) 
        ? window.preloadedMedia[question.introBackgroundVideoUrl] 
        : `https://firebasestorage.googleapis.com/v0/b/cogdexapptest.appspot.com/o/videos%2F${question.introBackgroundVideoUrl}.mp4?alt=media`;
    
    const lang = State.userData?.native_language;
    State.player = new introBackgroundVideo({
        videoUrl: currentVideoUrl,
        title: Strings.get('incoming_video', lang) || 'INCOMING VIDEO',
        subtitle: Strings.get('video_incoming', lang) || 'VIDEO ENTRANTE',
        name: 'Joe Walsh',
        role: Strings.get('english_coach', lang) || 'English Coach, UFF',
        alertText: Strings.get('press_webcam', lang) || 'Press the webcam button below. Oprime el botón de cámara abajo.'
    });
    window.currentIntroVideoPlayer = State.player;
  }

  setMicStatusText("<div class='text-center'>" + question.question + "</div>");
  resetAnswersContainer(`<div id="answers-container" class="d-grid gap-2 d-none"></div>`);

  if (question.inputType === "speech" || question.inputType === "ai") {
      hideHints();

      const allHidden = false; let revealedFirst = false;
      const escapeHtml = (text) => {
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
        return text.replace(/[&<>"']/g, (m) => map[m]);
      };

      let answerHTML = `${question.cue.replace(/\b[\w']+\b/g, word => {
        if (allHidden && !revealedFirst) { revealedFirst = true; return escapeHtml(word); }
        return `<span class="pulse-dot" data-word="${escapeHtml(word)}"><i class="bi bi-app"></i></span>`;
      })}`;

      if (question.possibleAnswer) {
        answerHTML += `<br><strong>${Strings.get('possible_response', State.userData?.native_language)}</strong><br>${question.possibleAnswer.replace(/\b[\w']+\b/g, word => {
          if (allHidden && !revealedFirst) { revealedFirst = true; return escapeHtml(word); }
          return `<span class="pulse-dot" data-word="${escapeHtml(word)}"><i class="bi bi-app"></i></span>`;
        })}`;
      }

      const handleRevealClick = function() {
          if (!this.dataset.revealed) {
              this.textContent = this.dataset.word; 
              State.currentPoints = Math.max(0, State.currentPoints - 15);
              pointLoss.show(this, 15); updateCurrentScoreDisplay(State.currentPoints);
              this.dataset.revealed = "true"; this.removeEventListener('click', handleRevealClick);
          }
      };

      const qIndex = getCurrentQuestionIndex(question, State.configData, State.currentLessonIndex);

      renderSpeechInputUI(
          answerHTML,
          () => handleHint(qIndex),
          handleRevealClick,
          async () => {
              const speechButton = document.getElementById('speechButton');
              try {
                  await toggleSpeechRecognition({
                      button: speechButton,
                      question,
                      micStatusText: DOM.micStatusText,
                      userData: State.userData,
                      configData: State.configData,
                      currentLessonIndex: State.currentLessonIndex,
                      currentQuestionIndex: qIndex,
                      handleAnswer: submitAnswerPrecheck,
                      player: State.player
                  });
              } catch (error) {
                  console.error("Speech toggle failed", error);
              }
          }
      );

  } else if (question.inputType === 'text') {
      renderTextInputUI(
          Strings.get('placeholder_type_answer', State.userData?.native_language) || 'Type your answer here...',
          Strings.get('btn_submit', State.userData?.native_language) || 'Submit',
          (val, btn) => submitAnswerPrecheck(val, question.cue, question, btn, question.explanation, question.translation, { pauseCount: null, netDuration: null })
      );

  } else if (question.inputType === 'lessoncomplete') {
    updateProgressAndCloseButton(true); toggleScoresAndHearts(false);
    setProgressBarWidth("95%"); showFeedbackAndProceed(question, true);
    hideAnswerDiv();

  } else if (question.inputType === 'unitcomplete') {
    question.lessonId = State.configData.lessons[State.currentLessonIndex].lessonId + 's';
    State.successHandler.handleSuccessLesson(question);

  } else if (question.inputType === 'lessonIntro') {
      toggleScoresAndHearts(false);
      State.repeatPointsHistory = []; 
      State.rolePlayPointsHistory = [];
      hideAnswerDiv();
  
      if (!question.simpleVideoUrl && question.explanation) {
        const lang = State.userData?.native_language; const localizedTrans = getLocalizedTranslation(question.translation, lang); const hasTranslation = !!localizedTrans;
        const imagineStr = Strings.get('imagine', lang); const listenRepeatStr = Strings.get('listen_repeat', lang);

        const explanationHTML = `
          <div class='chat-bubble chat-msg'>
            <p class='explanation'>
              <strong>${imagineStr.split('<br>')[0]}</strong> ${question.explanation}
              <br><br>
              ➡${listenRepeatStr.split('<br>')[0]}
              ${hasTranslation && lang !== 'en' ? `<br><br><span lang='${lang}'><i><strong>🎯${imagineStr.includes('<br>') ? imagineStr.split('<i>')[1].split('<i>')[0] : imagineStr}</strong>${localizedTrans}<br><br>${listenRepeatStr.includes('<br>') ? listenRepeatStr.split('<i>')[1].split('<i>')[0] : listenRepeatStr}</i></span>` : ''}
            </p>
          </div>`;
        const bodyContent = `<p class='lesson-name chat-bubble chat-msg'><strong>Lesson: ${lesson.title}</strong></p>${explanationHTML}`;
        safeRenderChatInterface(false, bodyContent);
      }
      showFeedbackAndProceed(question, true);

  } else if (question.inputType === 'present') {
      updateProgressAndCloseButton(false); toggleScoresAndHearts(false); hideAnswerDiv();

      let headsUpHTML = question.headsUp ? `<div class='chat-bubble chat-msg'><p class='headsUp'>${question.headsUp}</p></div>` : "";

      if (!question.simpleVideoUrl) {
        let explanationHTML = "";
        if (question.explanation) {
          const lang = State.userData?.native_language;
          const expTrans = getLocalizedTranslation(question.translation, lang);
          explanationHTML = `<div class='chat-bubble chat-msg'><p class='explanation'>${question.explanation}${expTrans && lang && lang !== 'en' ? `<br><br><span lang='${lang}'><i>${expTrans}</i></span>` : ""}</p></div>`;
        }
        const bodyContent = `<p class='lesson-name chat-bubble chat-msg'><strong>${Strings.get('lesson_label', State.userData?.native_language)} ${lesson.title}</strong></p>${explanationHTML}`;
        safeRenderChatInterface(false, bodyContent);
      }
      showFeedbackAndProceed(question, true);

  } else if (question.inputType === 'success') {
      window.removeEventListener('beforeunload', beforeUnloadHandler);
      bindProcessButton(() => State.player.destroy());

      question.lessonId = State.configData.lessons[State.currentLessonIndex].lessonId;
      
      // Explicitly hand the config to the window object before calling the processor 👇
      window.__currentConfigData = State.configData;
      
      initVideoProcessor(question.cue, fluencyData, question.lessonId);
      State.successHandler.handleSuccessLesson(question);
      
      const currentLesson = State.configData.lessons[State.currentLessonIndex];
      const nextLessonId = currentLesson.nextLessonId;

      if (nextLessonId) {
        saveLessonProgress(State.courseId, nextLessonId, State.userData, {
          updateUserMeta: true,
          incrementCount: true 
        }).then(progressResult => {
            // Update State with the new calculated numbers
            State.dayCount = progressResult.newDayCount;
            State.currentStreak = progressResult.newStreak;
            
            // Update the UI spans in the header
            updateActivityDisplay(State.dayCount, State.currentStreak);
        });
      };

      try { hideWebcamPreview(); } catch (error) {}

  } else if (question.inputType === "multi") {
      const answers = [question.cue, ...question.incues];
      question.alpha ? sortAnswersAlphabetically(answers) : shuffleArray(answers); 

      renderMultiChoiceUI(
          Strings.get('btn_not_sure', State.userData?.native_language) || "I'm not sure",
          (val, btn) => submitAnswerPrecheck(val, question.cue, question, btn, question.explanation, undefined, { pauseCount: null, netDuration: null }),
          answers,
          (answer, button) => submitAnswerPrecheck(answer, question.cue, question, button, question.explanation, question.translation, { pauseCount: null, netDuration: null })
      );
  }
}

function getNextQuestion(currentQuestion) {
  if (!State.configData || !State.configData.lessons || State.currentLessonIndex >= State.configData.lessons.length) return null;
  const currentLesson = State.configData.lessons[State.currentLessonIndex];
  const currentIndex = currentLesson.questions.findIndex(q => q.question === currentQuestion.question && q.cue === currentQuestion.cue);
  if (currentIndex === -1) return currentLesson.questions[0];
  if (currentIndex >= currentLesson.questions.length - 1) return null;
  return currentLesson.questions[currentIndex + 1];
}

function updateProgressBar() {
  if (!State.configData || !State.configData.lessons || State.configData.lessons.length === 0) return;
  const currentLesson = State.configData.lessons[State.currentLessonIndex];
  const totalQuestions = currentLesson.questions.length;
  let currentQuestions = State.questionsAnswered++;
  const finalProgress = Math.min(Math.max((currentQuestions / totalQuestions) * 100, 10), 90);
  setProgressBarWidth(`${finalProgress}%`);
}

function loadNextQuestion(currentQuestion, fluencyData) {
    updateProgressBar();
    toggleScoresAndHearts(false);
    
    State.resetForNextQuestion();
    updateCurrentScoreDisplay(State.currentPoints);

    resetHeartsUI();

  if (!State.configData || !State.configData.lessons || State.configData.lessons.length === 0) return;
  const currentLesson = State.configData.lessons[State.currentLessonIndex];
  State.currentQuestionIndex++;

  if (State.currentQuestionIndex < currentLesson.questions.length) {
    loadQuestion(currentLesson.questions[State.currentQuestionIndex], currentLesson, fluencyData);
  } else {
    if (currentLesson.nextLessonId) loadNextLesson();
    else showCompletionMessage();
  }
}

function showCompletionMessage() {
  showMessageInQuestionsContainer(Strings.get('msg_lesson_complete_all', State.userData?.native_language));
}

async function loadNextLesson() {
  if (!State.configData || !State.configData.lessons || State.configData.lessons.length === 0) return;
  const currentLesson = State.configData.lessons[State.currentLessonIndex];
  const nextLessonId = currentLesson.nextLessonId;

  if (nextLessonId) {
    saveLessonProgress(State.courseId, nextLessonId, State.userData).then(progressResult => {
        if (progressResult.dayCountIncremented) {
            State.dayCount = progressResult.newDayCount;
            updateDayCountDisplay(State.dayCount);
        }
    });

    setTimeout(async () => {
      const nextLessonIndex = State.configData.lessons.findIndex(l => l.lessonId === nextLessonId);

      if (nextLessonIndex !== -1) {
        State.currentLessonIndex = nextLessonIndex;
        localStorage.setItem(`${State.courseId}_currentLessonId`, nextLessonId);
        localStorage.setItem(`${State.courseId}_currentLessonTimestamp`, new Date().toISOString());
        setProgressBarWidth("100%");
        State.questionsAnswered = 0; 
        State.currentQuestionIndex = 0;
        loadLessonContent(State.configData.lessons[nextLessonIndex]);
      } else showCompletionMessage();
    }, 1200);
  } else {
    Media.playSound('lesson-complete-sound'); showCompletionMessage();
  }
}

// 🏫🏫🏫🏫🏫🏫🏫🏫 INITIALIZATION/LESSON SETUP 🏫🏫🏫🏫🏫🏫🏫🏫

async function initializeLesson() {
  try {
    State.lessonId = await getCurrentLessonId(); 
    if (!State.configData || !State.configData.lessons) return;
    State.lesson = State.configData.lessons.find(lesson => lesson.lessonId === State.lessonId);
    if (!State.lesson) return;
    State.currentLessonIndex = State.configData.lessons.findIndex(l => l.lessonId === State.lessonId);

    if (window.preloadLessonAssets) {
        const constructFirebaseUrl = (slug) => `https://firebasestorage.googleapis.com/v0/b/cogdexapptest.appspot.com/o/videos%2F${slug}.mp4?alt=media`;
        await window.preloadLessonAssets(State.lesson, constructFirebaseUrl);
    }
    
    loadLessonContent(State.lesson);
  } catch (error) {
    showErrorMessageInQuestionsContainer(Strings.get('lesson_load_error', State.userData?.native_language));
  }
}

async function getCurrentLessonId() {
  if (!State.configData || typeof State.configData !== 'object') throw new Error('Invalid or missing course configuration.');
  const urlParams = new URLSearchParams(window.location.search);
  const urlLessonId = urlParams.get('lessonid');

  if (urlLessonId) {
    State.lessonId = urlLessonId;
    const url = new URL(window.location.href);
    url.searchParams.delete('lessonid'); url.searchParams.delete('course');
    window.history.replaceState({}, document.title, url.toString());
  }

  if (!State.courseId) State.courseId = await getCurrentcourseId();

  if (!State.lessonId) {
      let wpLessonId = null; let wpTimestamp = null;
      if (State.userData) {
          wpLessonId = State.userData[`${State.courseId}_current_lesson`] ?? null;
          const ts = State.userData[`${State.courseId}_lesson_timestamp`];
          wpTimestamp = ts && !isNaN(new Date(ts).getTime()) ? new Date(ts) : null;
      }
      
      const lsId = localStorage.getItem(`${State.courseId}_currentLessonId`);
      const lsTsStr = localStorage.getItem(`${State.courseId}_currentLessonTimestamp`);
      const lsTs = lsTsStr && !isNaN(new Date(lsTsStr).getTime()) ? new Date(lsTsStr) : null;
      
      const sources = [];
      if (wpLessonId && wpTimestamp) sources.push({ lessonId: wpLessonId, timestamp: wpTimestamp });
      if (lsId && lsTs) sources.push({ lessonId: lsId, timestamp: lsTs });
      
      if (sources.length === 1) State.lessonId = sources[0].lessonId;
      else if (sources.length > 1) {
          sources.sort((a, b) => b.timestamp - a.timestamp);
          State.lessonId = sources[0].lessonId;
      }
  }

  if (!State.lessonId) {
    if (State.configData && State.configData.lessons && State.configData.lessons.length > 0 && State.configData.lessons[0].lessonId) State.lessonId = State.configData.lessons[0].lessonId;
    else throw new Error('getCurrentLessonId No lessons found in the course configuration.');
  }

  saveLessonProgress(State.courseId, State.lessonId, State.userData, { updateUserMeta: false, incrementCount: false });
  return State.lessonId;
}

async function getCurrentcourseId() {
  State.courseId = new URLSearchParams(window.location.search).get('courseid');

  if (!State.courseId) {
    if (State.userData && typeof State.userData === 'object') {
      try {
        const userProfile = await wp.apiFetch({ path: '/custom/v1/user-profile' });
        State.courseId = userProfile.current_course || null;
      } catch (error) { State.courseId = localStorage.getItem('currentCourse'); }
    } else State.courseId = localStorage.getItem('currentCourse');
  }

  if (!State.courseId) State.courseId = 'pronunciation';
  localStorage.setItem('currentCourse', State.courseId);
  if (State.userData && typeof State.userData === 'object') await saveCourseToUserProfile(State.courseId, State.userData);
  return State.courseId;
}

function loadLessonContent(lesson) {
  clearSpeechRecordingsForLesson(lesson.lessonId).catch(e => console.error(e));
  if(State.player) State.player.destroy();
  
  State.resetForNewLesson();
  State.mission = lesson.mission || "";
  State.setting = lesson.setting || "";
  State.userRole = lesson.userRole || "";
  State.videoRole = lesson.videoRole || "";
  
  updateCurrentScoreDisplay(State.currentPoints);
  updateActivityDisplay(State.dayCount, State.currentStreak);
  
  resetHeartsUI();

  updateProgressBar(); 

  // --- TITLE LOGIC ---
  const course = State.configData?.courseName || "";
  const level = State.englishLevel ? ` (${State.englishLevel})` : "";
  const unit = (lesson.unit && String(lesson.unit).trim() !== "") ? `${lesson.unit}: ` : "";
  const titleText = (typeof lesson.title === 'object') ? (lesson.title.en || "") : (lesson.title || "");
  const fullTitle = `${course}${level}${course ? ': ' : ''}${unit}${titleText}`;

  setupLessonUI(fullTitle);

  loadQuestion(lesson.questions[State.currentQuestionIndex], lesson);
}

// 🚀🚀🚀🚀🚀🚀🚀🚀 INITIALIZE APP 🚀🚀🚀🚀🚀🚀🚀🚀

async function initializeApp() {
    try {
        requestPersistentStorage();
        const isLoggedIn = await isUserLoggedIn();

        // Client-Side Protection: Redirect to login if not authenticated
        if (!isLoggedIn) {
            console.warn('User not authenticated. Redirecting to login page.');
            const redirectUrl = encodeURIComponent(window.location.href);
            window.location.href = `login.html?redirect=${redirectUrl}`;
            return; // Stop execution
        }

        State.userData = await getUserProfile();
        State.initializeUserMetrics(State.userData, calculateCurrentStreak);

        updateActivityDisplay(State.dayCount, State.currentStreak);

        // Immediately trigger offline score sync if needed
        syncOfflineScores(State.userData);

        State.courseId = await getCurrentcourseId(); 
        
        // --- FETCH CONFIG AND SET LANGUAGE LEVEL ---
        const response = await fetch(`js/config/${State.courseId}.json`);
        State.configData = await response.json();

        // Pull level directly from the JSON field (e.g., "B1")
        State.englishLevel = State.configData.languageLevel || 'A0';
        console.log(`Course Level initialized to: ${State.englishLevel}`);

        const lang = State.userData?.native_language;
        const defaultQuestions = {
            'speech':      Strings.get('default_q_speech', lang),
            'ai':          Strings.get('default_q_ai', lang),
            'present':     Strings.get('default_q_present', lang),
            'success':     Strings.get('default_q_present', lang),
            'lessonIntro': Strings.get('default_q_lesson_intro', lang)
        };

        if (State.configData && State.configData.lessons) {
            State.configData.lessons.forEach(lesson => {
                // Normalize title to string if it's a localized object
                if (lesson.title && typeof lesson.title === 'object') {
                    lesson.title = lesson.title.en || String(lesson.title);
                }
                // Optional: Also normalize mission if you want to use it later
                if (lesson.mission && typeof lesson.mission === 'object') {
                    lesson.mission = lesson.mission.en || String(lesson.mission);
                }
                
                if (lesson.questions) {
                    lesson.questions.forEach(question => {
                        // Normalize cue to string if it's a localized object
                        if (question.cue && typeof question.cue === 'object') {
                            question.cue = question.cue.en || String(question.cue);
                        }
                        if (!question.question && defaultQuestions[question.inputType]) {
                            question.question = defaultQuestions[question.inputType];
                        }
                    });
                }
            });
        }

        State.successHandler = new SuccessLessonHandler({
            configData: State.configData, 
            loadLessonContent, 
            calculateAverage, 
            playSound: Media.playSound, 
            loadNextLesson,
            updateState: (newState) => {
              Object.assign(State, newState);
            },
            uiElements: {
              scoresAndHearts: DOM.scoresAndHearts, 
              progressbar: DOM.progressbar, 
              progressBarFill: DOM.progressBarFill, 
              speechTextHere: DOM.speechText,
              bottomButtonBarCenter: document.getElementById('bottomButtonBarCenter'), 
              bottomButtonBarLeft: document.getElementById('bottomButtonBarLeft'), 
              hearts
            }
        });

        // 🛑 CRITICAL TO PREVENT RAM OVERLOAD: Render the UI and Video FIRST
        await initializeLesson();

        // 🛑 CRITICAL TO PREVENT RAM OVERLOAD: Boot Whisper and NLP background models IN SEQUENCE
        (async () => {
            try {
                let voiceInitFn = initLocalVoiceAI;
                
                if (typeof voiceInitFn !== 'function') {
                    console.warn('initLocalVoiceAI not available statically, attempting dynamic import...');
                    const scriptDir = new URL('.', import.meta.url).href;
                    const speechModuleUrl = new URL('modules/speech.js?8', scriptDir).href;
                    const speechModule = await import(speechModuleUrl);
                    voiceInitFn = speechModule.initLocalVoiceAI;
                }
                
                if (typeof voiceInitFn === 'function') {
                    await Promise.resolve(voiceInitFn());
                    console.log('🎙️ Whisper initialization complete.');
                }
            } catch (err) {
                console.error('Voice AI initialization error:', err);
            } finally {
                loadLocalModelsInBackground();
            }
        })();

    } catch (error) {
        console.error("Initialization error:", error);
    }
}

async function requestPersistentStorage() {
    // Check if the browser supports the Storage API
    if (navigator.storage && navigator.storage.persist) {
        // Check if we already have persistent storage
        let isPersisted = await navigator.storage.persisted();
        
        if (!isPersisted) {
            // Request persistent storage
            isPersisted = await navigator.storage.persist();
        }

        if (isPersisted) {
            console.log("✅ Storage is persistent. The browser will not auto-delete the GECToR models.");
        } else {
            console.warn("⚠️ Persistent storage not granted. Models may be cleared if the device runs low on space.");
        }
    }
}

async function loadLocalModelsInBackground() {
    try {
        console.log("⏳ Telling background worker to boot models...");
        await askWorker('LOAD_MODELS', {}, 3 * 60 * 1000); // 3 min timeout
        nlpModelsReady = true;
        console.log("✅ Worker reports all models are loaded and ready in the background!");
    } catch (err) {
        // Even if we timed out, the worker may still finish loading.
        // Poll until it responds or we give up after 5 more minutes.
        console.warn("⚠️ Model load timed out — polling for late readiness...", err);
        const giveUpAt = Date.now() + 5 * 60 * 1000;
        while (Date.now() < giveUpAt) {
            await new Promise(resolve => setTimeout(resolve, 5000));
            try {
                await askWorker('CHECK_GRAMMAR', { userInput: 'test ping' }, 10000);
                nlpModelsReady = true;
                console.log("✅ Worker became ready after delayed load!");
                break;
            } catch {
                console.log("⏳ Worker not ready yet, still waiting...");
            }
        }
        if (!nlpModelsReady) {
            console.error("❌ Worker never became ready. Falling back to Server API permanently.");
        }
    }

    // 👉 SEQUENTIAL LOAD: Boot the idiom checker ONLY after the NLP worker is finished
    if (nlpModelsReady) {
        try {
            console.log("📚 NLP Models ready in RAM. Now fetching and building idiom dictionary...");
            await idiomChecker.init();
            console.log("✅ Idiom checker ready!");
        } catch (err) {
            console.error("❌ Failed to initialize idiom checker:", err);
        }
    }
}

function buildGrammarDiff(original, corrected) {
    const tokenize = str => str.trim().match(/[\w']+|[^\w\s']+|\s+/g) || [];
    const tokA = tokenize(original), tokB = tokenize(corrected);
    const m = tokA.length, n = tokB.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++)
            dp[i][j] = tokA[i-1].toLowerCase() === tokB[j-1].toLowerCase() ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);

    const ops = []; let i = m, j = n;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && tokA[i-1].toLowerCase() === tokB[j-1].toLowerCase()) { ops.unshift({ type: 'eq', val: tokB[j-1] }); i--; j--; }
        else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) { ops.unshift({ type: 'ins', val: tokB[j-1] }); j--; }
        else { ops.unshift({ type: 'del', val: tokA[i-1] }); i--; }
    }

    let userHTML = '', corrHTML = '';
    ops.forEach(({ type, val }) => {
        const v = val.replace(/</g, '&lt;');
        if (type === 'eq')  { userHTML += v; corrHTML += v; }
        if (type === 'del') { userHTML += `<span class="diff-del">${v}</span>`; }
        if (type === 'ins') { corrHTML += `<span class="diff-ins">${v}</span>`; }
    });
    return { userHTML, corrHTML };
}

// Check if the page is already loaded before adding the listener.
// This prevents the "silent hang" race condition.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}
