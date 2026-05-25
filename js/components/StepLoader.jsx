/**
 * StepLoader.jsx — React Step Loader (Web)
 *
 * Orchestrates step loading using the platform-agnostic loadStepOrchestrate.
 * Provides web-specific render callbacks that integrate with the existing
 * Zustand store and React component architecture.
 *
 * This component is a "controller" — it doesn't render visible UI itself.
 * Instead, it calls loadStepOrchestrate which triggers Zustand store updates
 * that the existing React components (AnswerInput, MicrophoneToggle, etc.) react to.
 *
 * For response-type steps, the heavy DOM-based speech pipeline is delegated
 * to the web implementation via imported callback functions.
 */

import React, { useEffect, useRef, useCallback } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../modules/store.js';
import { loadStepOrchestrate } from '../modules/step-loader-orchestrate.js';
import { handleTextStep, handleLessonComplete, handleUnitComplete, handleSuccessStep } from '../modules/step-loader-logic.js';
import { clearChat, addAIFeedbackMessages } from './chat/chat-interface.js';
import { getLocalizedTranslation } from '../modules/utils.js';
import { formatBilingualHTML } from '../modules/bilingual-display.web.js';
import { getCurrentStepIndex } from '../modules/answers.js';
import { isIOS, warmUpSpeechCamStream, listeningState } from '../modules/speech.js';
import Strings from '../data/strings.js';

export default function StepLoader({ submitAnswerPrecheck, showFeedbackAndProceed, handleHint }) {
    const currentStepIndex = useStore(appStore, (state) => state.currentStepIndex);
    const activeLessonId = useStore(appStore, (state) => state.activeLessonId);
    const configData = useStore(appStore, (state) => state.configData);
    const currentLessonIndex = useStore(appStore, (state) => state.currentLessonIndex);
    const isTextMode = useStore(appStore, (state) => state.isTextMode);
    const isCameraOff = useStore(appStore, (state) => state.isCameraOff);
    const userData = useStore(appStore, (state) => state.userData);

    const prevStepIndexRef = useRef(-1);
    const prevLessonIdRef = useRef(null);

    // Reset tracking when lesson changes
    useEffect(() => {
        if (activeLessonId !== prevLessonIdRef.current) {
            prevLessonIdRef.current = activeLessonId;
            prevStepIndexRef.current = -1;
        }
    }, [activeLessonId]);

    // Build the step object from store state
    const getCurrentStep = useCallback(() => {
        if (!configData?.lessons) return null;
        const lesson = configData.lessons[currentLessonIndex];
        if (!lesson?.steps) return null;
        return lesson.steps[currentStepIndex] || null;
    }, [configData, currentLessonIndex, currentStepIndex]);

    // Build the lesson object from store state
    const getCurrentLesson = useCallback(() => {
        if (!configData?.lessons) return null;
        return configData.lessons[currentLessonIndex] || null;
    }, [configData, currentLessonIndex]);

    // Web-specific: reset UI for new step
    const resetUIForNewStep = useCallback((isLessonIntro) => {
        const store = appStore.getState();
        store.setBottomControlState('mic');
        store.setStatsVisible(false);
        store.setTextInputVisible(false);
        store.setHintsVisible(false);
        store.setMicStatusText('');

        // Remove DOM elements that step-loader.web.js used to manage
        const resultVideo = document.getElementById('resultVideo');
        if (resultVideo) resultVideo.remove();
        const displayCanvas = document.getElementById('displayCanvas');
        if (displayCanvas) displayCanvas.remove();
        const continueSuccess = document.getElementById('continueButtonSuccess');
        if (continueSuccess) continueSuccess.remove();
        const repeatSuccess = document.getElementById('repeatButtonSuccess');
        if (repeatSuccess) repeatSuccess.remove();

        // Reset mic/txt buttons
        const micBtn = document.getElementById('micBtn');
        if (micBtn) {
            micBtn.style.removeProperty('display');
            micBtn.disabled = false;
            micBtn.classList.remove('disabled');
        }
        const txtBtn = document.getElementById('txtBtn');
        if (txtBtn) {
            txtBtn.style.removeProperty('display');
            txtBtn.disabled = false;
            txtBtn.classList.remove('disabled');
        }

        // Hide success media
        const successMedia = document.getElementById('success-media');
        if (successMedia) successMedia.classList.add('d-none');
        const courseProgress = document.getElementById('courseProgress');
        if (courseProgress) courseProgress.classList.add('d-none');

        // Remove repeat button
        const repeatButton = document.getElementById('repeatButton');
        if (repeatButton) repeatButton.remove();

        // Clear media container
        const mediaViewport = document.getElementById('media-viewport');
        if (mediaViewport) {
            const preserved = mediaViewport.querySelectorAll('#ivp-container, #simple-video-container, #intro-call-widget, #webcam-preview');
            mediaViewport.innerHTML = '';
            preserved.forEach(el => {
                el.style.display = '';
                el.style.minHeight = '';
                if (el.id === 'intro-call-widget') {
                    el.classList.add('d-none');
                } else {
                    el.classList.remove('d-none');
                }
                mediaViewport.appendChild(el);
            });
        }
    }, []);

    // Web-specific: render response step (speech/text input)
    const renderResponseStep = useCallback((step, lesson, deps) => {
        const { submitAnswerPrecheck, handleHint } = deps;
        const store = appStore.getState();

        store.setHintsVisible(false);

        const stepIndex = getCurrentStepIndex(step, store.configData, store.currentLessonIndex);

        if (store.isTextMode) {
            store.setStatsVisible(true);
            const placeholder = Strings.get('placeholder_type_answer', store.userData?.native_language) || 'Type your answer here...';
            store.setTextInputPlaceholder(placeholder);
            store.setTextInputSubmitCallback((val, btn) => {
                submitAnswerPrecheck(val, step.cue, step, btn, step.explanation, step.translation, { pauseCount: 0, netDuration: 3 });
            });
        } else {
            // Speech mode — set up the speech input toggle callback
            const userLang = store.userData?.native_language;
            const cueHTML = formatBilingualHTML(step.cue, userLang);

            store.setSpeechInputContent(cueHTML);
            store.setSpeechInputHintCallback(step.stepType === 'closedResponse' ? null : () => handleHint(stepIndex));
            store.setSpeechInputRevealCallback(() => {});
            store.setSpeechInputToggleCallback(async () => {
                // Delegate to speech.js toggleSpeechRecognition
                const { toggleSpeechRecognition } = await import('../modules/speech.js');
                const speechButton = document.getElementById('micBtn');
                try {
                    await toggleSpeechRecognition({
                        button: speechButton,
                        step,
                        micStatusText: document.getElementById('react-root-micstatus'),
                        userData: store.userData,
                        configData: store.configData,
                        currentLessonIndex: store.currentLessonIndex,
                        currentStepIndex: stepIndex,
                        handleAnswer: submitAnswerPrecheck,
                        player: null,
                        uiHooks: {
                            onHesitation: (points) => {},
                            onPauseVideo: () => {},
                            onMicDisable: () => {},
                            onRecordingStart: () => {},
                            onEngineNotReady: () => {},
                            onEngineReady: () => {},
                            onRecordingActive: () => {},
                            onRecordingStop: () => {},
                            onStopEarly: () => {},
                            onGibberishDetected: () => {},
                            onPreflightRejected: () => {},
                            onTranscriptRejected: () => {},
                            onReviewStart: () => {},
                            onReviewUpdate: () => {},
                            onReviewEnd: () => {}
                        }
                    });
                } catch (error) {
                    console.error('Speech toggle failed', error);
                }
            });
        }
    }, [submitAnswerPrecheck, handleHint]);

    // Web-specific: render lesson intro
    const renderLessonIntro = useCallback((step, lesson) => {
        const store = appStore.getState();
        store.setStatsVisible(false);

        if (!step.simpleVideoUrl && step.explanation) {
            const lang = store.userData?.native_language;
            const localizedTrans = getLocalizedTranslation(step.translation, lang);
            const hasTranslation = !!localizedTrans;
            const imagineStr = Strings.get('imagine', lang);
            const listenRepeatStr = Strings.get('listen_repeat', lang);

            const explanationStr = `
                <p class='explanation'>
                  <strong>${imagineStr.split('<br>')[0]}</strong> ${step.explanation}
                  <br><br>
                  ➡${listenRepeatStr.split('<br>')[0]}
                  ${hasTranslation && lang !== 'en' ? `<br><br><span lang='${lang}'><i><strong>🎯${imagineStr.includes('<br>') ? imagineStr.split('<i>')[1].split('<i>')[0] : imagineStr}</strong>${localizedTrans}<br><br>${listenRepeatStr.includes('<br>') ? listenRepeatStr.split('<i>')[1].split('<i>')[0] : listenRepeatStr}</i></span>` : ''}
                </p>`;

            addAIFeedbackMessages([
                `<p class='lesson-name'><strong>Lesson: ${lesson.title}</strong></p>`,
                explanationStr
            ]);
        }
    }, []);

    // Web-specific: render present step
    const renderPresent = useCallback((step, lesson) => {
        const store = appStore.getState();

        if (!step.simpleVideoUrl) {
            let explanationHTML = '';
            if (step.explanation) {
                const lang = store.userData?.native_language;
                const expTrans = getLocalizedTranslation(step.translation, lang);
                const localized = expTrans && lang && lang !== 'en' ? `<br><br><span lang='${lang}'><i>${expTrans}</i></span>` : '';
                explanationHTML = `<p class='explanation'>${step.explanation}${localized}</p>`;
            }

            addAIFeedbackMessages([
                `<p class='lesson-name'><strong>${Strings.get('lesson_label', store.userData?.native_language)} ${getLocalizedTranslation(lesson.title)}</strong></p>`,
                explanationHTML
            ]);
        }
    }, []);

    // Web-specific: render success step
    const renderSuccess = useCallback((step) => {
        const store = appStore.getState();
        step.lessonId = store.configData.lessons[store.currentLessonIndex].lessonId;
        handleSuccessStep(step, null);
    }, []);

    // Main step loading effect
    useEffect(() => {
        const step = getCurrentStep();
        const lesson = getCurrentLesson();

        if (!step || !lesson) return;
        if (currentStepIndex === prevStepIndexRef.current) return;

        prevStepIndexRef.current = currentStepIndex;

        // Voice state isolation
        if (listeningState) {
            listeningState.active = false;
            listeningState.transitioning = false;
            if (listeningState.hesitationTimer) {
                clearInterval(listeningState.hesitationTimer);
                listeningState.hesitationTimer = null;
            }
        }

        clearChat();
        window.scrollTo({ top: 0, behavior: 'smooth' });

        resetUIForNewStep(step.stepType === 'lessonIntro');

        // Speech warmup for response steps
        if (step.stepType === 'closedResponse' || step.stepType === 'openResponse') {
            if (!isCameraOff && !isTextMode) {
                warmUpSpeechCamStream();
            } else if (isTextMode) {
                console.log('[StepLoader] Text mode: bypassing hardware prompt');
            } else {
                warmUpSpeechCamStream();
            }
        }

        // Platform-agnostic orchestration
        loadStepOrchestrate(step, lesson, null, {
            submitAnswerPrecheck,
            showFeedbackAndProceed,
            handleHint,
            onStepLoaded: () => {},
            onResponseStep: renderResponseStep,
            onTextStep: (step, deps) => {
                handleTextStep(step, deps.submitAnswerPrecheck);
            },
            onLessonIntro: renderLessonIntro,
            onPresent: renderPresent,
            onSuccess: renderSuccess,
            onLessonComplete: (step, deps) => {
                handleLessonComplete(step, deps.showFeedbackAndProceed);
            },
            onUnitComplete: (step) => {
                handleUnitComplete(step);
            }
        });

    }, [currentStepIndex, activeLessonId, configData, currentLessonIndex, isTextMode, isCameraOff, userData, submitAnswerPrecheck, showFeedbackAndProceed, handleHint, getCurrentStep, getCurrentLesson, resetUIForNewStep, renderResponseStep, renderLessonIntro, renderPresent, renderSuccess]);

    // This component doesn't render visible UI — it's a controller
    return null;
}
