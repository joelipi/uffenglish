# Spec for Hesitation Analytics in Flow Score

## 1. Overarching Goals
- Introduce a "hesitation" metric measuring the time (in ms) between the start of recording and when the user begins speaking.
- Calculate this metric purely locally, leveraging our existing local audio processing logic prior to Whisper inference.
- Incorporate this hesitation metric into the overall Flow Score to provide more nuanced feedback on a user's speech fluidity.
- Display the metric clearly within the Flow Score chat bubble in the feedback UI, adhering strictly to separation of concerns (content vs logic vs styles).

## 2. Rationale for Decisions
- **Local Calculation:** Since `trimSilenceWithPadding` in `js/modules/speech.web.js` already iterates through the raw audio array to find the first sample crossing the volume threshold, we can trivially calculate the hesitation duration. The index of the first valid sample divided by the sample rate (16000) gives the exact hesitation time in seconds. This avoids modifying the WebAssembly Whisper worker, keeps logic accessible, and requires zero external dependencies.
- **Scoring Integration:** Flow currently comprises `wpm` and `pauses`. Adding `hesitation` as a third component makes the Flow score more comprehensive. We will score hesitation such that small natural hesitations (e.g., < 500ms) are not penalized, but longer delays reduce the score.
- **Separation of Concerns:** Strings for the chat bubble will be housed in `js/data/strings.js`. No inline styles will be added; instead, we rely on existing Bootstrap classes in the HTML structure. Logic modules will not manipulate the DOM directly.

## 3. Files to be Edited
- `js/modules/speech.web.js`: To calculate hesitation and pass it along with extraction stats.
- `js/app.js`: To pass the `hesitation` metric into `calculateFluencyScore`.
- `js/modules/scoring.js`: To update the Flow Score calculation to include the hesitation penalty.
- `js/modules/feedback-builder.js`: To append the hesitation metric to the Flow Score chat bubble.
- `js/data/strings.js`: To add localized strings for displaying the hesitation metric.

## 4. Existing Files to be Called but NOT Edited
- `js/workers/whisper/app-vad-asr-web.js`
- `js/workers/whisper/whisper-worker-web.js`
- `js/components/ui.js`
- `js/modules/answers.js`

## 5. Functions to be Added, Deleted, or Changed

### `js/modules/speech.web.js`
**Function to Change:** `trimSilenceWithPadding(data, options)`
- **How:** In the while loop that determines `start`, compute `hesitation = Math.round((start / sampleRate) * 1000)`. Return `hesitation` in the output object alongside `trimmed`, `pauseCount`, and `netDuration`.

**Function to Change:** `toggleSpeechRecognition(event)`
- **How:** When calling `trimSilenceWithPadding`, extract `hesitation` from `extractionResult` and include it in `stats`. Ensure `stats.hesitation` is assigned correctly so it can be passed up the pipeline into `speechAnalytics` in `js/app.js` and `updateSpeechRecording`.

### `js/app.js`
**Function to Change:** The callback block for `calculateFluencyScore`
- **How:** When constructing `scoreData` via `calculateFluencyScore()`, pass `hesitation: speechAnalytics?.hesitation || 0` in the params object.

### `js/modules/scoring.js`
**Function to Change:** `calculateFluencyScore(params)`
- **How:** Add `hesitation` to the destructured parameters.
- Calculate `hesitationScore`. Example logic: `const hesitationScore = Math.max(0, 100 - Math.floor(Math.max(0, hesitation - 500) / 20));` (This gives a 100 score up to 500ms, and penalizes by 5 points for every 100ms thereafter).
- Update `flow` calculation to average all three: `const flow = (wpmScore + pausesScore + hesitationScore) / 3;`.
- Include `hesitationScore` and `hesitation` in the returned `subScores` object.

### `js/modules/feedback-builder.js`
**Function to Change:** `buildFeedback(scoreData, lang, attemptNumber)`
- **How:** In the "3. Flow" section, append an `<li>` element to the `ul` block that reads the hesitation string from `Strings.get()`. Render the metric dynamically.
  Example:
  ```html
  <li>${Strings.get('stats_hesitation', lang)} ${scoreData.subScores.hesitation}ms (${scoreData.subScores.hesitationScore}%)</li>
  ```

### `js/data/strings.js`
**Change:** Add new key-value pairs for `stats_hesitation`.
- **How:** Add `stats_hesitation: { en: 'Hesitation:', es: 'Vacilación:' }` (and other supported languages) so that the content is strictly separated from the logic module.

## 6. Detail: Displaying the Score in the Chat Bubble
The Flow score chat bubble is generated inside `buildFeedback` in `js/modules/feedback-builder.js`.
Currently, it generates a header and an unordered list (`<ul>`) with list items (`<li>`) for WPM and Pauses.
We will add a new `<li>` to this existing list to display:
"Hesitation: [hesitation_ms]ms ([hesitation_score]%)".
The label "Hesitation:" will be retrieved from the multi-language string dictionary in `js/data/strings.js`. The HTML will purely use existing structural tags (`<li>`) without introducing new classes or inline CSS, ensuring a strict separation between content, logic, and style.

## 7. Detail: Inclusion in Flow Score Calculation
The Flow score will be recalculated to incorporate `hesitation`.
Currently, Flow Score is an average of `wpmScore` and `pausesScore`:
`const flow = (wpmScore + pausesScore) / 2;`

With the hesitation addition, the calculation will be:
1. Determine `hesitationScore`. A standard threshold approach allows for natural latency:
   - Delay < 500ms: Score = 100
   - Delay >= 500ms: Deduct points linearly or proportionally.
   - Example calculation: `const hesitationScore = Math.max(0, 100 - Math.floor((Math.max(0, hesitation - 500)) / 20));`
2. Update the `flow` variable to weight hesitation equally:
   `const flow = (wpmScore + pausesScore + hesitationScore) / 3;`
3. Pass both the raw `hesitation` and `hesitationScore` out via the `subScores` return object so it can be accessed by the UI layer.
