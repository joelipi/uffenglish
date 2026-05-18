// success-lesson.js
import confetti from 'canvas-confetti';
import { appStore } from '../modules/store.js';

export class SuccessLessonHandler {
  constructor({
    loadLessonContent,
    calculateAverage,
    playSound,
    loadNextLesson,
    updateState,
    uiElements = {}
  }) {
    this.loadLessonContent = loadLessonContent;
    this.calculateAverage = calculateAverage;
    this.playSound = playSound;
    this.loadNextLesson = loadNextLesson;
    this.updateState = updateState;

    // Map UI elements from current index.html
    this.uiElements = {
      statsContainer: uiElements.statsContainer || document.getElementById('stats-container'),
      progressbar: uiElements.progressbar || document.getElementById('progress'),
      progressBarFill: uiElements.progressBarFill || document.getElementById('progress-bar'),
      chatMessageList: uiElements.chatMessageList || document.getElementById('chat-message-list')
    };

    this.hasPlayed = false;
  }

  displayScore(lessonAverage) {
    // Kept for compatibility but minimal implementation
    console.log(`[Success] Lesson average: ${lessonAverage}%`);
  }

  updateUI(lessonAverage) {
    const { statsContainer, progressBarFill } = this.uiElements;

    if (statsContainer) statsContainer.classList.add('d-none');

    if (progressBarFill) {
      progressBarFill.style.width = "100%";
      progressBarFill.classList.add('bg-success');
    }

  }

  handleSuccessLesson(question) {
    if (!question?.lessonId) {
      console.error('[Success] Missing lessonId');
      return;
    }

    const lessonAverage = typeof this.calculateAverage === 'function'
      ? this.calculateAverage()
      : 0;

    this.updateUI(lessonAverage);
    this.displayScore(lessonAverage);

    if (typeof this.updateState === 'function') {
      this.updateState({ state: 'success-lesson' });
      console.log('[Success] Successfully updated application state to "success-lesson"');
    } else {
      console.warn('[Success] updateState function not provided, failed to transition state');
    }

    this.createVideoButton(question).catch(console.error);

    // Play celebration effects - pass lessonAverage to conditionally play confetti
    this.playEffects(lessonAverage);
  }

  createContinueButton() {
    let continueButton = document.getElementById('continueButton');

    if (!continueButton) {
      continueButton = document.createElement('button');
      continueButton.id = 'continueButton';
      continueButton.className = 'btn btn-primary text-white w-100';
      continueButton.innerHTML = '<i class="bi bi-chevron-right text-white" style="font-size: 40px; font-weight: 900;"></i>';
    }

    // Place in the bottom control area (where micBtn normally lives)
    const bottomOverlayContent = document.querySelector('.bottom-overlay-content');
    if (bottomOverlayContent) {
      bottomOverlayContent.innerHTML = '';
      bottomOverlayContent.appendChild(continueButton);
      bottomOverlayContent.className = 'bottom-overlay-content position-absolute start-50 translate-middle-x';
    } else {
      // Fallback: append to chat if bottom overlay not found
      const chatMessageList = this.uiElements.chatMessageList;
      if (chatMessageList) {
        const systemRow = document.createElement('div');
        systemRow.className = 'chat-message-row chat-message-row--system';
        systemRow.id = 'continueButtonRow';
        systemRow.appendChild(continueButton);
        chatMessageList.appendChild(systemRow);
      }
    }

    continueButton.style.display = 'inline-block';

    continueButton.onclick = () => {
      continueButton.style.display = 'none';
      if (typeof this.loadNextLesson === 'function') {
        this.loadNextLesson();
      }
    };
  }

  async createVideoButton(question) {
    const videoBtn = document.getElementById('createVideoButton');

    if (!videoBtn) return;
    videoBtn.classList.remove('d-none');
    videoBtn.onclick = async () => {
      videoBtn.disabled = true;
      videoBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> Generating...';

      try {
        const { processVideo } = await import('../modules/video-processor.js');
        const result = await processVideo({}, question.lessonId);

        if (result?.blob) {
          const url = URL.createObjectURL(result.blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `lesson-${question.lessonId}-summary.webm`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 5000);

          this.createContinueButton();
          this.createRepeatButton(question).catch(console.error);
        }
      } catch (err) {
        console.error('[Success] Video generation failed:', err);
        alert('Failed to generate video. Please try again.');
      } finally {
        videoBtn.disabled = false;
        videoBtn.innerHTML = '<i class="bi bi-film me-2"></i> Download Video';
      }
    };
  }

  async createRepeatButton(question) {
    const chatMessageList = this.uiElements.chatMessageList;
    if (!chatMessageList) return;

    const baseLessonId = question.lessonId?.trim();
    if (!baseLessonId) return;

    const repeatButton = document.createElement('button');
    repeatButton.className = 'btn btn-primary text-white w-100 repeat-btn';
    repeatButton.id = 'repeatButton';
    repeatButton.innerHTML = '<i class="bi bi-arrow-counterclockwise text-white" style="font-size: 40px; font-weight: 900;"></i>';
    repeatButton.title = 'Repeat this lesson / Repetir esta lección';

    const handleRepeat = () => {
      const baseUrl = window.location.origin + window.location.pathname;
      const newUrl = `${baseUrl}?lessonId=${encodeURIComponent(baseLessonId)}`;
      window.location.href = newUrl;
    };

    repeatButton.onclick = handleRepeat;

    const existing = document.getElementById('repeatBtnSuccess');
    if (existing) existing.onclick = handleRepeat;

    chatMessageList.appendChild(repeatButton);
  }

  playEffects(lessonAverage) {
    if (typeof this.playSound === 'function') {
      this.playSound('lesson-complete-sound');
    }

    if (lessonAverage >= 90 && !this.hasPlayed) {
      confetti({
        particleCount: 120,
        spread: 80,
        origin: { y: 0.6 }
      });
      this.hasPlayed = true;
    }
  }
}
