// --- modules/ui.js ---

// 1. Centralize DOM Elements
export const DOM = {
    phrasesScore: document.getElementById('phrasesScore'),
    mediaContainer: document.getElementById('media-container'),
    speechText: document.getElementById("speech-text-here"),
    chatBody: document.getElementById("chat-messenger-body"),
    avatarAi: document.getElementById("chat-avatar-ai"),
    nameAi: document.getElementById("chat-name-ai"),
    avatarHuman: document.getElementById("chat-avatar-human"),
    nameHuman: document.getElementById("chat-name-human"),
    heart3: document.getElementById("heart3"),
    heart2: document.getElementById("heart2"),
    heart1: document.getElementById("heart1"),
    scoresAndHearts: document.getElementById("scoresAndHearts"),
    progressbar: document.getElementById('progress'),
    progressBarFill: document.getElementById("progress-bar"),
    closeAndProgress: document.getElementById('closeAndProgress'),
    micStatusText: document.getElementById("micStatusText"),
    dayCountSpan: document.getElementById("dayCountSpan"),
    // NEW: Added the streak span from app.php
    streakCountSpan: document.getElementById("streakCountSpan"), 
    arrowContainer: document.getElementById("arrow-container"),
    playbackVideo: document.getElementById(window.innerWidth >= 1200 ? 'playback-video-desktop' : 'playback-video-mobile')
};

// 2. Helper to switch between AI and Human headers
function setChatHeader(isAI) {
    DOM.avatarAi.classList.toggle('d-none', !isAI);
    DOM.nameAi.classList.toggle('d-none', !isAI);
    DOM.avatarHuman.classList.toggle('d-none', isAI);
    DOM.nameHuman.classList.toggle('d-none', isAI);
}

// 2. UI Helper Functions
export function flashElement(element) {
    if (!element) return;
    element.classList.remove('score-update');
    // Force a reflow to restart the animation
    void element.offsetWidth; 
    element.classList.add('score-update');
    setTimeout(() => element.classList.remove('score-update'), 300);
}

export function updateCurrentScoreDisplay(currentPoints) {
    const element = document.getElementById('currentScore');
    if (element) {
        flashElement(element);
        element.textContent = currentPoints;
    }
}

/**
 * Updates the streak and day count displays simultaneously
 * @param {number} totalDays - Total count from completed_dates.length
 * @param {number} currentStreak - Result from calculateCurrentStreak()
 */
export function updateActivityDisplay(totalDays, currentStreak) {
    if (DOM.dayCountSpan) {
        DOM.dayCountSpan.textContent = totalDays;
        // Optional: flash only if value changes
        flashElement(DOM.dayCountSpan);
    }
    
    if (DOM.streakCountSpan) {
        DOM.streakCountSpan.textContent = currentStreak;
        // Visual feedback for the streak is highly encouraging for users
        flashElement(DOM.streakCountSpan);
    }
}

// Keep the old function for backward compatibility with other parts of your app
export function updateDayCountDisplay(dayCount) {
    if (DOM.dayCountSpan) {
        flashElement(DOM.dayCountSpan);
        DOM.dayCountSpan.textContent = dayCount;
    }
}

export function disableAllButtons(container) {
    if (!container) return;  
    const buttons = container.querySelectorAll('button');
    buttons.forEach(btn => { 
        if (btn) { 
            btn.disabled = true; 
            btn.classList.add('disabled'); 
        } 
    });
}

// 3. The new Data-Driven render function
export function safeRenderChatInterface(isAI, bodyContent) {
    DOM.speechText.classList.remove('d-none'); // Unhide the whole widget
    setChatHeader(isAI); // Swap the avatar/name
    
    // Remove the loading spinner if it exists
    const loadingStatus = DOM.chatBody.querySelector('#ai-loading-status');
    if (loadingStatus) {
        loadingStatus.remove();
    }

    // Append the new bubbles
    if (bodyContent) {
        DOM.chatBody.insertAdjacentHTML('beforeend', bodyContent);
    }
    
    // Auto-scroll to bottom
    setTimeout(() => {
        DOM.chatBody.scrollTop = DOM.chatBody.scrollHeight;
    }, 10);
}

/**
 * 🎨 UI BUILDER: Renders the user's spoken or typed response
 */
export function renderUserResponse(text, statsHtml = "") {
    const html = `
        <div class='userResponse chat-bubble-sent chat-msg'>${text}</div>
        ${statsHtml}`;
    safeRenderChatInterface(false, html);
}

/**
 * 🎨 UI BUILDER: Renders a loading indicator while AI is thinking
 */
export function renderAIAnalysisLoading(text = "Analyzing your response...") {
    const html = `
        <div class='chat-bubble chat-msg' id='ai-loading-status'>
            <strong><span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> ${text}</strong>
        </div>`;
    safeRenderChatInterface(true, html);
}

/**
 * 🎨 UI BUILDER: Renders a standardized stats bubble
 */

export function createHeaderHTML(text) {
    if (!text) return "";
    return `<div style='font-size: 0.85em; text-transform: uppercase; color: #17a2b8; margin-bottom: 5px;'><strong>${text}</strong></div>`;
}

export function createPragmaticsBubbleHTML(headingHTML, contentHTML) {
    return `<div class='chat-bubble chat-msg' style='margin-top: 12px; display: block;'>
        ${headingHTML ? headingHTML : ''}
        ${contentHTML}
    </div>`;
}

export function createStatsBubbleHTML(header, statsParts) {
    const listHtml = statsParts && statsParts.length > 0 ? `<ul>${statsParts.map(part => `<li>${part}</li>`).join('')}</ul>` : '';
    return `
        <div class='chat-bubble chat-msg' style='margin-bottom: 12px; display: block; border-left: 4px solid #17a2b8;'>
            ${createHeaderHTML(header)}
            ${listHtml}
        </div>`;
}

/**
 * 🎨 UI BUILDER: Renders a grammar correction bubble with a diff
 */
export function createGrammarDiffHTML(original, correction, headingText = "") {
    const { userHTML, corrHTML } = buildGrammarDiff(original, correction);
    return `
        <div class='chat-bubble chat-msg' style='margin-top: 12px; display: block;'>
            ${createHeaderHTML(headingText)}
            <div class="diff-del-bubble">${userHTML}</div>
            <div style="margin-top:6px">${corrHTML}</div>
        </div>`;
}

/**
 * 🎨 UI BUILDER: Renders a general AI feedback bubble (explanation, heads-up, etc.)
 */
export function renderAIFeedback(contentChunks = []) {
    // Filter out empty strings and wrap each chunk in a bubble if not already wrapped
    const html = contentChunks
        .filter(Boolean)
        .map(chunk => {
            if (chunk.includes("chat-bubble")) return chunk;
            return `<div class='chat-bubble chat-msg' style='margin-top: 12px; display: block;'>${chunk}</div>`;
        })
        .join("");
    
    safeRenderChatInterface(true, html);
}

/**
 * 🎨 UI BUILDER: Internal helper to generate diff HTML
 */
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

// 4. NEW: A clean way to wipe the chat between questions
export function clearChatInterface() {
    DOM.chatBody.innerHTML = '';
    DOM.speechText.classList.add('d-none'); // Hide widget entirely
}

// 5. Encapsulated DOM Logic
export function showHintsAndScroll() {
    const hints = document.getElementById("hints");
    if (hints) {
        hints.classList.remove("d-none", "invisible");
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    }
}

export function hideHints() {
    const hints = document.getElementById("hints");
    if (hints) hints.classList.add("d-none");
    const hintButton = document.getElementById('hintButton');
    if (hintButton) hintButton.classList.add('invisible');
}

export function clearMicStatusAndHideMedia() {
    if (DOM.micStatusText) DOM.micStatusText.innerHTML = "";
    if (DOM.mediaContainer) DOM.mediaContainer.classList.add('d-none');
}

export function setMicStatusText(text) {
    if (DOM.micStatusText) DOM.micStatusText.innerHTML = text;
}

export function updateSpeakingScoreDisplay(score) {
    if (DOM.phrasesScore) DOM.phrasesScore.textContent = `${score}`;
}

export function showPlaybackVideo() {
    if (DOM.playbackVideo) DOM.playbackVideo.style.display = 'block';
}

export function markButtonAsCorrect(button) {
    if (!button) return;
    button.classList.add('btn-success', 'correct-answer');
    button.addEventListener('animationend', () => button.classList.remove('correct-answer'), { once: true });
}

export function markButtonAsIncorrect(button, answersContainer, cue) {
    if (!button) return;
    button.classList.remove('btn-outline-primary');
    button.classList.add('btn-secondary', 'disabled', 'incorrect-answer');

    if (answersContainer && cue) {
        const cueButton = Array.from(answersContainer.querySelectorAll('button')).find(btn => btn.textContent.trim().toLowerCase() === cue.trim().toLowerCase());
        if (cueButton) cueButton.classList.add('correct-answer-highlight');
    }

    button.addEventListener('animationend', () => button.classList.remove('incorrect-answer'), { once: true });
}

export function animateHeartLoss(incorrectAttempts) {
    if (incorrectAttempts == 1 && DOM.heart1) DOM.heart1.classList.add("falling-image");
    else if (incorrectAttempts == 2 && DOM.heart2) DOM.heart2.classList.add("falling-image");
    else if (incorrectAttempts == 3 && DOM.heart3) DOM.heart3.classList.add("falling-image");
}

export function resetHeartsUI() {
    const hearts = [DOM.heart1, DOM.heart2, DOM.heart3];
    hearts.forEach(heart => {
        if (heart) {
            heart.classList.remove("falling-image");
            heart.classList.remove("d-none");
        }
    });
}

export function showContinueButton(isLessonIntro, onClickCallback) {
    let continueButton = document.getElementById('continueButton');
    if (!continueButton) {
        continueButton = document.createElement('button');
        continueButton.id = 'continueButton';
        continueButton.className = 'btn btn-primary text-white w-100';
        const centerBar = document.getElementById('bottomButtonBarCenter');
        if (centerBar) centerBar.appendChild(continueButton);
    }
    continueButton.innerHTML = isLessonIntro ? '<i class="bi bi-camera-video-fill text-white" style="font-size: 40px; font-weight: 900;"></i>' : '<i class="bi bi-chevron-right text-white" style="font-size: 40px; font-weight: 900;"></i>';
    continueButton.onclick = onClickCallback;
    continueButton.style.display = 'inline-block';
    return continueButton;
}

export function hideContinueButton() {
    const continueButton = document.getElementById('continueButton');
    if (continueButton) continueButton.style.display = 'none';
}

export function renderFallbackContinueButton(text, onClickCallback) {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.onclick = onClickCallback;
    document.body.appendChild(btn);
}

export function resetUIForNewQuestion(isLessonIntro, hasUserData) {
    const resultVideo = document.getElementById('resultVideo');
    if (resultVideo) resultVideo.remove();
    const displayCanvas = document.getElementById('displayCanvas');
    if (displayCanvas) displayCanvas.remove();

    if (DOM.arrowContainer) DOM.arrowContainer.classList.toggle('d-none', !isLessonIntro);

    const lessonIntroHeader = document.getElementById('lessonIntroHeader');
    if (lessonIntroHeader) lessonIntroHeader.classList.toggle('d-none', !isLessonIntro || hasUserData);

    if (DOM.closeAndProgress) DOM.closeAndProgress.classList.toggle('d-none', isLessonIntro && !hasUserData);

    const myToastClose = document.querySelector('#myToast .btn-close');
    if (myToastClose) myToastClose.click();

    const successMedia = document.getElementById("success-media");
    if (successMedia) successMedia.classList.add("d-none");

    const courseProgress = document.getElementById("courseProgress");
    if (courseProgress) courseProgress.classList.add("d-none");
}

export function toggleScoresAndHearts(show) {
    if (DOM.scoresAndHearts) {
        if (show) DOM.scoresAndHearts.classList.remove('d-none');
        else DOM.scoresAndHearts.classList.add('d-none');
    }
}

export function removeRepeatButton() {
    let repeatButton = document.getElementById('repeatButton');
    if (repeatButton) repeatButton.remove();
}

export function prepareMediaUI() {
    if (DOM.mediaContainer) DOM.mediaContainer.classList.remove('d-none');
}

export function clearMediaContainerAndPreservePlayers() {
    if (!DOM.mediaContainer) return;
    
    // 1. Identify containers we want to keep
    const preserved = DOM.mediaContainer.querySelectorAll('#ivp-container, #simple-ivp-container, #intro-call-widget, #webcam-preview');
    
    // 2. Wipe the parent container
    DOM.mediaContainer.innerHTML = '';
    
    // 3. Re-append preserved shells and RESET any leftover inline style overrides or hidden classes.
    // This allows the CSS :empty pseudo-class in style.css to manage visibility
    // dynamically (hiding them when empty, showing them when they have children).
    preserved.forEach(el => {
        el.style.display = '';
        el.style.minHeight = '';
        
        // Neutral state: Shells are available (unhidden), but the Call Widget is hidden by default
        if (el.id === 'intro-call-widget') {
            el.classList.add('d-none');
        } else if (el.id === 'webcam-preview') {
            // Keep the webcam's current visibility state as managed by speech.js
            // and do NOT clear its innerHTML (video element)
        } else {
            el.classList.remove('d-none');
            // Always clear innerHTML of video shells during reset. This ensures they 
            // are truly empty so CSS :empty can collapse them (0px height).
            el.innerHTML = '';
        }
        
        DOM.mediaContainer.appendChild(el);
    });
}

export function renderImageInMediaContainer(imageUrl) {
    if (!DOM.mediaContainer) return;
    const div = document.createElement('div');
    div.className = 'text-center mb-3';
    div.innerHTML = `<img src="${imageUrl}" class="img-fluid rounded" alt="Question illustration" style="max-height: 300px;">`;
    DOM.mediaContainer.prepend(div);
}

export function renderYoutubeInMediaContainer(youtubeId) {
    if (!DOM.mediaContainer) return;
    const div = document.createElement('div');
    div.className = 'text-center mb-3';
    div.innerHTML = `<iframe width="315" height="560" src="https://www.youtube.com/embed/${youtubeId}?autoplay=1&rel=0&modestbranding=1&controls=0&disablekb=1&fs=0&playsinline=1&short=1&playback_rate=0.8" title="Intro" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope" referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
    DOM.mediaContainer.prepend(div);
}

export function resetAnswersContainer(html) {
    const container = document.getElementById('questions-container');
    if (container) {
        container.innerHTML = html;
    }
    const answerDiv = document.getElementById("answerDiv");
    if (answerDiv) answerDiv.classList.add("d-none");
    const answersContainer = document.getElementById("answers-container");
    if (answersContainer) answersContainer.classList.remove("d-none");
}

export function renderSpeechInputUI(hintHTML, handleHintCallback, handleRevealClickCallback, toggleSpeechCallback) {
    const hintUncommonWords = document.getElementById("hintUncommonWords");
    if (hintUncommonWords) {
        hintUncommonWords.innerHTML = hintHTML;
        document.querySelectorAll('.pulse-dot').forEach(span => {
            // Need a wrapper to handle the callback and clean up event listener, but handleRevealClickCallback inside script.js does it already
            span.addEventListener('click', handleRevealClickCallback);
        });
    }

    const bottomButtonBarLeft = document.getElementById("bottomButtonBarLeft");
    if (bottomButtonBarLeft) {
        const hintButton = document.createElement('button');
        hintButton.className = 'btn bg-transparent text-white border-0';
        hintButton.id = 'hintButton';
        hintButton.innerHTML = '<i class="bi bi-life-preserver fs-1"></i>';
        hintButton.onclick = () => {
            handleHintCallback();
            hintButton.style.visibility = 'hidden';
        };
        bottomButtonBarLeft.innerHTML = '';
        bottomButtonBarLeft.appendChild(hintButton);
    }

    const answersContainer = document.getElementById('answers-container');
    if (answersContainer) {
        const speechInput = document.createElement('div');
        speechInput.className = 'speech-input';

        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'button-container';
        buttonContainer.id = 'buttonContainer';

        const speechButton = document.createElement('button');
        speechButton.className = 'btn btn-primary';
        speechButton.id = 'speechButton';
        speechButton.innerHTML = '<i class="bi bi-mic-fill"></i>';
        speechButton.onclick = toggleSpeechCallback;

        const bottomButtonBarCenter = document.getElementById("bottomButtonBarCenter");
        if (bottomButtonBarCenter) {
            bottomButtonBarCenter.innerHTML = '';
            bottomButtonBarCenter.appendChild(buttonContainer);
            buttonContainer.appendChild(speechButton);
        }

        const speechText = document.createElement('p');
        speechInput.appendChild(speechText);
        answersContainer.appendChild(speechInput);
    }
}

export function renderTextInputUI(placeholder, submitText, handleSubmitCallback) {
    if (DOM.closeAndProgress) DOM.closeAndProgress.classList.remove('d-none');
    if (DOM.scoresAndHearts) DOM.scoresAndHearts.classList.remove('d-none');
    const answerDiv = document.getElementById("answerDiv");
    if (answerDiv) answerDiv.classList.add("d-none");

    const answersContainer = document.getElementById('answers-container');
    if (answersContainer) {
        const inputField = document.createElement('input');
        inputField.type = 'text';
        inputField.className = 'form-control mb-3';
        inputField.placeholder = placeholder;

        const submitButton = document.createElement('button');
        submitButton.className = 'btn btn-primary';
        submitButton.textContent = submitText;
        submitButton.onclick = () => handleSubmitCallback(inputField.value.trim(), submitButton);

        answersContainer.appendChild(inputField);
        answersContainer.appendChild(submitButton);
    }
}

export function updateProgressAndCloseButton(showClose) {
    if (DOM.closeAndProgress) {
        if (showClose) DOM.closeAndProgress.classList.remove('d-none');
        else DOM.closeAndProgress.classList.add('d-none');
    }
}

export function setProgressBarWidth(percentage) {
    if (DOM.progressBarFill) DOM.progressBarFill.style.width = percentage;
}

export function hideAnswerDiv() {
    const answerDiv = document.getElementById("answerDiv");
    if (answerDiv) answerDiv.classList.add("d-none");
}

export function bindProcessButton(onClickCallback) {
    const processBtn = document.getElementById('processBtn');
    if (processBtn) processBtn.addEventListener('click', onClickCallback);
}

export function renderMultiChoiceUI(notSureText, handleNotSureCallback, answers, handleAnswerCallback) {
    if (DOM.closeAndProgress) DOM.closeAndProgress.classList.remove('d-none');
    if (DOM.scoresAndHearts) DOM.scoresAndHearts.classList.remove('d-none');

    const answersContainer = document.getElementById('answers-container');
    if (answersContainer) {
        const notSureButton = document.createElement('button');
        notSureButton.className = 'btn btn-outline-secondary';
        notSureButton.textContent = notSureText;
        notSureButton.onclick = () => handleNotSureCallback("I'm not sure", notSureButton);
        answersContainer.appendChild(notSureButton);

        answers.forEach((answer) => {
            const button = document.createElement('button');
            button.className = 'btn btn-outline-primary';
            button.textContent = answer;
            button.onclick = () => handleAnswerCallback(answer, button);
            answersContainer.appendChild(button);
        });
    }
}

export function showMessageInQuestionsContainer(messageHTML) {
    const container = document.getElementById('questions-container');
    if (container) {
        container.innerHTML = `<div class="text-center">${messageHTML}</div>`;
    }
}

export function showErrorMessageInQuestionsContainer(messageHTML) {
    const container = document.getElementById('questions-container');
    if (container) {
        container.innerHTML = `<div class="alert alert-danger">${messageHTML}</div>`;
    }
}

export function setupLessonUI(fullTitle) {
    const ivpWrapper = document.querySelector('.ivp-main-wrapper');
    if (ivpWrapper) ivpWrapper.classList.remove('d-none');

    const footer = document.querySelector('footer');
    if (footer) footer.classList.remove("d-none");

    const bottomBar = document.getElementById('bottomButtonBar');
    if (bottomBar) bottomBar.classList.remove('d-none');

    const bottomBarSuccess = document.getElementById('bottomButtonBarSuccess');
    if (bottomBarSuccess) bottomBarSuccess.classList.add('d-none');

    document.body.classList.remove('bg-dark');
    if (DOM.mediaContainer) DOM.mediaContainer.classList.remove('d-none');

    const lessonHeader = document.getElementById('lesson-header');
    if (lessonHeader) {
        lessonHeader.style.display = 'block';
        lessonHeader.classList.remove('lesson-header');
        void lessonHeader.offsetWidth; // Trigger reflow for animation
        lessonHeader.classList.add('lesson-header');
    }

    const titles = document.getElementsByClassName('lesson-title');
    for (let i = 0; i < titles.length; i++) {
        if (titles[i]) {
            titles[i].textContent = fullTitle;
        }
    }
}