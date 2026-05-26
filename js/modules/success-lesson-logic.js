// modules/success-lesson-logic.js
// Pure business logic for lesson success screen — zero DOM, React Native compatible

/**
 * Calculate lesson average from point histories or fallback to fluency score
 * @param {Object} state - Zustand store state
 * @returns {number} Lesson average percentage
 */
export function calculateLessonAverage(state) {
  const { repeatPointsHistory, rolePlayPointsHistory, fluencyScore } = state;
  const hasHistory = repeatPointsHistory.length || rolePlayPointsHistory.length;
  
  if (hasHistory) {
    return calculateAverage(repeatPointsHistory, rolePlayPointsHistory);
  }
  
  return fluencyScore || 0;
}

/**
 * Detect if fluency is improving compared to recent average
 * @param {number} currentAverage - Current lesson average
 * @param {number[]} recentAvgs - Array of recent lesson averages
 * @returns {boolean} True if improving
 */
export function detectFluencyTrend(currentAverage, recentAvgs) {
  if (!recentAvgs || recentAvgs.length === 0) return false;
  const last10Avg = recentAvgs.reduce((a, b) => a + b, 0) / recentAvgs.length;
  return currentAverage > last10Avg;
}

/**
 * Generate filename for success video
 * @param {string} lessonId - Lesson identifier
 * @returns {string} Filename without extension
 */
export function generateVideoFilename(lessonId) {
  const now = new Date();
  const timestamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0')
  ].join('');
  return `uff-${lessonId}-${timestamp}`;
}

/**
 * Determine if confetti should be shown based on score
 * @param {number} lessonAverage - Lesson average percentage
 * @returns {boolean} True if confetti should show
 */
export function shouldShowConfetti(lessonAverage) {
  return lessonAverage >= 90;
}

/**
 * Calculate average from point histories
 * @param {number[]} repeatHistory - Repeat lesson points
 * @param {number[]} rolePlayHistory - Role play points
 * @returns {number} Average score
 */
function calculateAverage(repeatHistory, rolePlayHistory) {
  const allScores = [...repeatHistory, ...rolePlayHistory].filter(s => typeof s === 'number');
  if (allScores.length === 0) return 0;
  const sum = allScores.reduce((a, b) => a + b, 0);
  return Math.round(sum / allScores.length);
}
