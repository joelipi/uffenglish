// success-lesson.js
import confetti from 'canvas-confetti';
import { appStore } from '../modules/store.js';
import { showLessonSuccessState } from './ui.js';
import { clearSpeechRecordingsForLesson } from '../modules/storage.js';

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

    this.uiElements = {
      statsContainer: uiElements.statsContainer || document.getElementById('stats-container'),
      progressbar: uiElements.progressbar || document.getElementById('progress'),
      chatMessageList: uiElements.chatMessageList || document.getElementById('chat-message-list')
    };

    this.hasPlayed = false;
  }

  displayScore(lessonAverage) {
    console.log(`[Success] Lesson average: ${lessonAverage}%`);
  }

  updateUI(lessonAverage) {
    const { statsContainer } = this.uiElements;

    if (statsContainer) statsContainer.classList.add('d-none');

    appStore.getState().setProgressPercent("100%");
    appStore.getState().setStatsVisible(false);

    if (typeof showLessonSuccessState === 'function') {
      showLessonSuccessState();
    }
  }

  handleSuccessLesson(step) {
    if (!step?.lessonId) {
      console.error('[Success] Missing lessonId');
      return;
    }

    const lessonAverage = typeof this.calculateAverage === 'function' ? this.calculateAverage() : 0;
    const fluencyData = { total: lessonAverage };

    // Fluency trend detection using last-10 average
    const recent = appStore.getState().recentFluencyAvgs || [];
    const last10Avg = recent.length > 0 ? recent.reduce((a, b) => a + b, 0) / recent.length : null;
    const isImproving = last10Avg !== null && lessonAverage > last10Avg;
    appStore.getState().setFluencyImproving(isImproving);
    appStore.getState().setLastLessonFluencyAvg(lessonAverage);
    if (isImproving) {
        console.log(`[Gamification] ✅ Fluency improving! Last-10 avg: ${last10Avg}% → Current: ${lessonAverage}%`);
    }

    this.updateUI(lessonAverage);
    this.displayScore(lessonAverage);

    if (typeof this.updateState === 'function') {
      this.updateState({ state: 'success-lesson' });
    }

    this.createVideoButton(step, fluencyData).catch(console.error);
    this.playEffects(lessonAverage);
  }

  createContinueButton() {
    let continueButton = document.getElementById('continueButtonSuccess');

    if (!continueButton) {
      continueButton = document.createElement('button');
      continueButton.id = 'continueButtonSuccess';
      continueButton.className = 'btn btn-primary text-white flex-fill';
      continueButton.innerHTML = '<i class="bi bi-chevron-right text-white" style="font-size: 24px; font-weight: 900;"></i>';
    }

    const successContainer = document.getElementById('state-lesson-success');
    if (successContainer) {
      successContainer.appendChild(continueButton);
    } else {
      const chatMessageList = this.uiElements.chatMessageList;
      if (chatMessageList) {
        const systemRow = document.createElement('div');
        systemRow.className = 'chat-message-row chat-message-row--system';
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

  async createVideoButton(step, fluencyData) {
    const videoBtn = document.getElementById('processBtn') || document.getElementById('createVideoButton');
    if (!videoBtn) return;

    videoBtn.classList.remove('d-none');
    videoBtn.onclick = async () => {
      videoBtn.disabled = true;
      videoBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> Generating...';

      try {
        document.querySelectorAll('video').forEach(v => {
          if (v.id !== 'originalVideo') {
            v.pause();
            v.muted = true;
          }
        });

        let mediaViewport = document.getElementById('media-viewport');
        if (mediaViewport) {
          mediaViewport.classList.remove('d-none');
          Array.from(mediaViewport.children).forEach(c => {
            if (c.id !== 'displayCanvas' && c.id !== 'resultVideo') {
              c.style.display = 'none';
            }
          });
        }

        const { processVideo, shareVideo } = await import('../modules/video-processor.js');

        let displayCanvas = document.getElementById('displayCanvas');
        if (!displayCanvas) {
          displayCanvas = document.createElement('canvas');
          displayCanvas.id = 'displayCanvas';

          displayCanvas.style.width = '100%';
          displayCanvas.style.height = 'calc(100% - 140px)';
          displayCanvas.style.objectFit = 'contain';
          displayCanvas.style.backgroundColor = 'black';

          const container = mediaViewport || document.querySelector('.video-frame');
          container.appendChild(displayCanvas);
        }
        displayCanvas.style.display = 'block';

        let targetLessonId = step?.lessonId?.trim();
        if (!targetLessonId) {
          targetLessonId = new URLSearchParams(window.location.search).get('lessonId');
        }
        if (targetLessonId) targetLessonId = targetLessonId.replace(/s+$/, '');

        const result = await processVideo(fluencyData, targetLessonId, displayCanvas);

        if (result?.blob) {
          displayCanvas.style.display = 'none';
          this.mountResultVideo(result.blob);

          try {
            await clearSpeechRecordingsForLesson(targetLessonId);
            console.log(`[Storage] Cleaned up raw webcam blobs for lesson: "${targetLessonId}"`);
          } catch (cleanupError) {
            console.warn('[Storage] Safe cleanup of raw recordings failed:', cleanupError);
          }

          videoBtn.disabled = false;
          videoBtn.classList.remove('btn-outline-primary', 'w-100');
          videoBtn.classList.add('btn-success', 'flex-fill');
          videoBtn.innerHTML = '<i class="bi bi-share-fill text-white"></i> Share';

          const now = new Date();
          const timestamp = now.getFullYear() +
            String(now.getMonth() + 1).padStart(2, '0') +
            String(now.getDate()).padStart(2, '0') +
            String(now.getHours()).padStart(2, '0') +
            String(now.getMinutes()).padStart(2, '0') +
            String(now.getSeconds()).padStart(2, '0');

          videoBtn.onclick = async () => {
            const filename = `uff-${targetLessonId}-${timestamp}.${result.ext || 'webm'}`;
            await shareVideo(result.blob, filename, result.ext || 'webm');
          };

          this.createContinueButton();
          this.createRepeatButton(step).catch(console.error);
        }
      } catch (err) {
        console.error('[Success] Video generation failed:', err);
        alert('Failed to generate video. Please try again.');
        videoBtn.disabled = false;
        videoBtn.innerHTML = '<i class="bi bi-film text-white"></i>';
      }
    };
  }

  mountResultVideo(blob) {
    let resultVideo = document.getElementById('resultVideo');
    if (!resultVideo) {
      resultVideo = document.createElement('video');
      resultVideo.id = 'resultVideo';

      const mediaViewport = document.getElementById('media-viewport');
      const container = mediaViewport || document.querySelector('.video-frame');
      container.appendChild(resultVideo);
    }

    resultVideo.style.width = '100%';
    resultVideo.style.height = 'calc(100% - 140px)';
    resultVideo.style.objectFit = 'contain';
    resultVideo.style.backgroundColor = 'black';
    resultVideo.controls = true;
    resultVideo.playsInline = true;

    resultVideo.src = URL.createObjectURL(blob);
    resultVideo.classList.remove('d-none');
    resultVideo.style.display = 'block';
  }

  async createRepeatButton(step) {
    const baseLessonId = step.lessonId?.trim();
    if (!baseLessonId) return;

    let repeatButton = document.getElementById('repeatButtonSuccess');
    if (!repeatButton) {
      repeatButton = document.createElement('button');
      repeatButton.className = 'btn btn-primary text-white flex-fill repeat-btn';
      repeatButton.id = 'repeatButtonSuccess';
      repeatButton.innerHTML = '<i class="bi bi-arrow-counterclockwise text-white" style="font-size: 24px; font-weight: 900;"></i>';
      repeatButton.title = 'Repeat this lesson / Repetir esta lección';
    }

    const handleRepeat = () => {
      const baseUrl = window.location.origin + window.location.pathname;
      const newUrl = `${baseUrl}?lessonId=${encodeURIComponent(baseLessonId)}`;
      window.location.href = newUrl;
    };

    repeatButton.onclick = handleRepeat;

    const successContainer = document.getElementById('state-lesson-success');
    if (successContainer) {
      successContainer.insertBefore(repeatButton, successContainer.firstChild);
    } else {
      const chatMessageList = this.uiElements.chatMessageList;
      if (chatMessageList) chatMessageList.appendChild(repeatButton);
    }
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
