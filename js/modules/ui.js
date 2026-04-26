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
    playbackVideo: document.getElementById(window.innerWidth > 1000 ? 'playback-video-desktop' : 'playback-video-mobile')
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
        // Remove the previous user bubble if we are replacing a loading state
        const userBubbles = DOM.chatBody.querySelectorAll('.chat-bubble-sent');
        if (userBubbles.length > 0) {
            userBubbles[userBubbles.length - 1].remove();
        }
    }

    // Append the new bubbles
    DOM.chatBody.insertAdjacentHTML('beforeend', bodyContent);
    
    // Auto-scroll to bottom
    setTimeout(() => {
        DOM.chatBody.scrollTop = DOM.chatBody.scrollHeight;
    }, 10);
}

// 4. NEW: A clean way to wipe the chat between questions
export function clearChatInterface() {
    DOM.chatBody.innerHTML = '';
    DOM.speechText.classList.add('d-none'); // Hide widget entirely
}