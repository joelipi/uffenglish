// successLesson.js
import confetti from 'canvas-confetti';

import { queryClient } from '../modules/api.js';

export class SuccessLessonHandler {
  constructor({
    loadLessonContent,
    calculateAverage,
    playSound,
    loadNextLesson,
    updateState,
    uiElements
  }) {
    // Core dependencies
    this.loadLessonContent = loadLessonContent;
    this.calculateAverage = calculateAverage;
    this.playSound = playSound;
    this.loadNextLesson = loadNextLesson;
    
    // State management
    this.updateState = updateState;
    
    // UI elements
    this.uiElements = {
      scoresAndHearts: uiElements.scoresAndHearts,
      progressbar: uiElements.progressbar,
      progressBarFill: uiElements.progressBarFill,
      speechTextHere: uiElements.speechTextHere,
      bottomButtonBarCenter: uiElements.bottomButtonBarCenter,
      bottomButtonBarLeft: uiElements.bottomButtonBarLeft,
      hearts: uiElements.hearts
    };
    
    // Internal state
    this.hasPlayed = false;
  }

  displayScore(lessonAverage) {
    let interpretationHTML = '';
    let gradientStyle = '';
    
    if (lessonAverage >= 90) {
      interpretationHTML = 'You have mastered these phrases. Continue on to the next lesson with confidence! <span id="es"><i>Has dominado estas frases. ¡Continúa a la próxima lección con confianza!</i></span>';
      gradientStyle = 'linear-gradient(135deg, #4CAF50 0%, #2E7D32 100%)';
    } 
    else if (lessonAverage >= 80) {
      interpretationHTML = 'You have almost mastered these phrases. Consider repeating <i class="bi bi-arrow-counterclockwise"></i> this lesson if you really want to master them. <span id="es"><i>Casi has dominado estas frases. Considera repetir <i class="bi bi-arrow-counterclockwise"></i> esta lección si realmente quieres dominarlas.</i></span>';
      gradientStyle = 'linear-gradient(135deg, #FFC107 0%, #FF9800 100%)';
    } 
    else {
      interpretationHTML = 'You have not mastered these phrases yet. You should repeat <i class="bi bi-arrow-counterclockwise"></i> this lesson. <span id="es"><i>Aún no has dominado estas frases. Te recomiendo repetir <i class="bi bi-arrow-counterclockwise"></i> esta lección.</i></span>';
      gradientStyle = 'linear-gradient(135deg, #FF5722 0%, #F44336 100%)';
    }
    /*
    this.uiElements.averageScore.innerHTML = `
      <div class="points-display text-center mt-3">
        <h4 class="text-white">Fluency Score</h4>
        <div class="score-circle mx-auto" style="width: 120px; height: 120px; border-radius: 50%; background: ${gradientStyle}; display: flex; align-items: center; justify-content: center;">
          <span class="text-white">${lessonAverage} %</span>
        </div>
        <p class="text-white mt-2">Average score for this lesson. <span id="es"><i>Calificación promedia de esta lección.</i></span></p>
        <p class="text-white mt-3">${interpretationHTML}</p>
      </div>
    `;*/
  }

  updateUI(lessonAverage) {
    this.uiElements.speechTextHere.classList.add('d-none');
    this.uiElements.scoresAndHearts.classList.add('d-none');
    //this.uiElements.progressbar.classList.remove('invisible');
    this.uiElements.progressBarFill.style.width = "100%";
    
    // Only show success media if fluencyScore is at least 90
    /*
    if (lessonAverage >= 90) {
      this.uiElements.successMedia.classList.remove("d-none");
      setTimeout(() => {
        this.uiElements.successMedia.classList.add("d-none");
      }, 1200);
    } else {
      // Ensure it's hidden if score is below 90
      this.uiElements.successMedia.classList.add("d-none");
    }
    
    this.uiElements.courseProgress.classList.remove("d-none");
    */
    // Reset hearts display
    this.uiElements.hearts.forEach(heart => {
      if (heart) {
        heart.classList.remove("falling-image", "d-none");
      }
    });
  }

  handleSuccessLesson(question) {
    if (!question?.lessonId) {
      console.error('Missing lessonId in question:', question);
      question = { ...question, lessonId: `${currentLessonId}s` }; // Fallback
    }

    // Handle score calculation and display
    const lessonAverage = this.calculateAverage();

    // Update UI state - pass lessonAverage
    this.updateUI(lessonAverage);

    // Create interactive elements
    this.createContinueButton();
    this.createRepeatButton(question).catch(console.error);

    // Play celebration effects - pass lessonAverage to conditionally play confetti
    this.playEffects(lessonAverage);
  }

  createContinueButton() {
    let continueButton = document.getElementById('continueButton');
    const { bottomButtonBarCenter } = this.uiElements;

    if (!continueButton) {
      continueButton = document.createElement('button');
      continueButton.id = 'continueButton';
      continueButton.className = 'btn btn-primary text-white w-100';
      continueButton.innerHTML = '<i class="bi bi-chevron-right text-white" style="font-size: 40px; font-weight: 900;"></i>';
      bottomButtonBarCenter.innerHTML = '';
      bottomButtonBarCenter.appendChild(continueButton);
    }

    bottomButtonBarCenter.className = 'position-absolute start-50 translate-middle-x';
    continueButton.style.display = 'inline-block';
    
    continueButton.onclick = () => {
      continueButton.style.display = 'none';
      if (typeof this.loadNextLesson === 'function') {
        this.loadNextLesson();
      }
    };
  }

  async createRepeatButton(question) {
    const { bottomButtonBarLeft } = this.uiElements;
    if (!bottomButtonBarLeft) return;

    bottomButtonBarLeft.innerHTML = '';

    // Normalize lessonId by stripping all trailing 's'
    const originalLessonId = question.lessonId?.trim();
    if (!originalLessonId) {
      console.warn("Invalid lessonId in question:", question);
      return;
    }
    
    // I modified it so that the end of lesson "success" question/view is now in the same lesson so the alteration is not necessary
    //const baseLessonId = originalLessonId.replace(/s+$/, '');
      const baseLessonId = originalLessonId;
      console.log("baseLessonId: ", baseLessonId);
/* This is not necessary if the "success" question/view is in the same lesson
    // Find the base lesson in configData
    // We fetch configData dynamically
    const courseId = new URLSearchParams(window.location.search).get('courseid') || localStorage.getItem('currentCourse') || 'pronunciation';
    let configData = queryClient.getQueryData(['course', 'config', courseId]);
    if (!configData) {
        // Use the queryFn logic from api.js if not in cache
        const response = await fetch(`js/config/${courseId}.json`);
        configData = await response.json();
    }
    const precedingLesson = configData.lessons.find(
      l => l.lessonId === baseLessonId
    );

    if (!precedingLesson) {
      console.warn(`Lesson not found for ID "${baseLessonId}"`);
      return;
    }
*/

      const repeatButton = document.createElement('button');
repeatButton.className = 'btn btn-primary text-white w-100 repeat-btn';
repeatButton.setAttribute('id', 'repeatButton');
repeatButton.innerHTML = '<i class="bi bi-arrow-counterclockwise text-white" style="font-size: 40px; font-weight: 900;"></i>';
repeatButton.title = 'Repeat this lesson / Repetir esta lección';

// Function to handle the repeat action
const handleRepeat = () => {
  // Get current URL without query params
  const baseUrl = window.location.origin + window.location.pathname;
  console.log("baseUrl: ", baseUrl);
  // Build new URL with ?lessonId=baseLessonId
  const newUrl = `${baseUrl}?lessonId=${encodeURIComponent(baseLessonId)}`;
  console.log("newUrl: ", newUrl);
  // Reload the page with the new URL
  window.location.href = newUrl;
};

// Set click handler for the new button
repeatButton.onclick = handleRepeat;

// Also set the same handler for the existing button
const existingRepeatBtn = document.getElementById('repeatBtnSuccess');
if (existingRepeatBtn) {
  existingRepeatBtn.onclick = handleRepeat;
}

    bottomButtonBarLeft.appendChild(repeatButton);
  }

  playEffects(lessonAverage) {
    this.playSound('lesson-complete-sound');
    
    // Only play confetti if fluencyScore is at least 90
    if (lessonAverage >= 90 && !this.hasPlayed) {
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
      });
      this.hasPlayed = true;
    }
  }
}
