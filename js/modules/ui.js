// --- modules/ui.js ---

// 1. Centralize DOM Elements
export const DOM = {
    phrasesScore: document.getElementById('phrasesScore'),
    mediaContainer: document.getElementById('media-container'),
    speechText: document.getElementById("speech-text-here"),
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

// 3. Chat Interface Rendering
export function renderChatInterface(isAI, bodyContent) {
    const headerStyle = "background: linear-gradient(135deg, #1a3a5a 0%, #0d4b8c 100%);";
    const headerHTML = isAI 
        ? `<div class='card-header text-white p-0' style='${headerStyle}' id='correct'><div class='d-flex align-items-center p-3'><video autoplay loop muted playsinline class='rounded-circle me-3' style='width:75px;height:75px;object-fit:cover'><source src='/avatar-ai.mp4' type='video/mp4'></video><div>Prof FluIntel <div class='mt-1'><small>UFF Artificial Intelligence</small></div></div></div></div>`
        : `<div class='card-header text-white p-0' style='${headerStyle}' id='correct'><div class='d-flex align-items-center p-3'><img src='/teacherprofile.png' alt='' class='rounded-circle me-3' style='width:75px;height:75px;object-fit:cover'><div>Prof. Joe Walsh<div class='mt-1'><small>English Fluency Coach, UFF</small></div></div></div></div>`;
    
    return `${headerHTML}<div class='card-body messenger-body text-dark' style='overflow-y: auto; height: 300px; scroll-behavior: smooth; scrollbar-width: auto; scrollbar-color: #00000 #f0f0f0;'>${bodyContent}</div>`;
}

export function safeRenderChatInterface(isAI, bodyContent) {
    const existingBody = DOM.speechText.querySelector('.messenger-body');
    const expectedName = isAI ? 'Prof FluIntel' : 'Prof. Joe Walsh';
    
    if (existingBody && DOM.speechText.innerHTML.includes(expectedName)) {
        const loadingStatus = existingBody.querySelector('#ai-loading-status');
        if (loadingStatus) {
            loadingStatus.remove();
            const userBubbles = existingBody.querySelectorAll('.chat-bubble-sent');
            if (userBubbles.length > 0) {
                userBubbles[userBubbles.length - 1].remove();
            }
        }
        existingBody.insertAdjacentHTML('beforeend', bodyContent);
        existingBody.scrollTop = existingBody.scrollHeight;
    } else {
        DOM.speechText.innerHTML = renderChatInterface(isAI, bodyContent);
        setTimeout(() => {
            const newBody = DOM.speechText.querySelector('.messenger-body');
            if (newBody) newBody.scrollTop = newBody.scrollHeight;
        }, 10);
    }
}