# Code Review: Separation of Concerns & Modularity

## Executive Summary
This review analyzes the frontend architecture of the project, focusing primarily on the separation of concerns and modularity. The codebase demonstrates a clear trajectory towards a modern ES module-based architecture, successfully extracting various distinct domains into separate modules. However, several critical areas suffer from tight coupling—most notably the intertwining of business logic, state management, and direct DOM manipulation.

## Strengths
1. **ES Module Adoption**: The codebase is migrating towards ES modules (`js/modules/`), which helps namespace and separate distinct capabilities like `api.js`, `storage.js`, `scoring.js`, and `swearjar.js`.
2. **Offloading Heavy Operations**: Utilizing a Web Worker (`js/nlp-worker.js`) for background NLP tasks is an excellent architectural choice to ensure the main UI thread remains performant and responsive.
3. **Dedicated UI Module Intent**: The presence of `js/modules/ui.js` with a centralized `DOM` object (e.g., `export const DOM = { ... }`) shows a concerted effort to isolate UI components from business logic.

## Areas for Improvement

### 1. Monolithic `script.js`
Despite the extraction of many modules, `js/script.js` remains exceptionally large (over 1,400 lines) and acts as an all-encompassing god object. It handles everything from:
- Instantiating Web Workers.
- Catching global `window` events (`transcriptRejected`, `preflightRejected`).
- Defining business logic (e.g., `submitAnswerPrecheck`, `handleAnswer`).
- Directing complex UI flows and animations.

**Impact**: This makes `script.js` difficult to test, maintain, and safely refactor, as changes to UI flows can inadvertently break core business logic.

### 2. Leaky DOM Abstractions
While `js/modules/ui.js` is intended to isolate DOM queries, direct DOM manipulation leaks extensively into other logical modules:
- **`script.js`**: Still heavily references properties like `DOM.phrasesScore` and `DOM.micStatusText` directly to alter state and fire animations (e.g., `pointLoss.show(DOM.phrasesScore, 20)`).
- **`js/modules/speech.js`**: This module should strictly handle Web Speech API, microphone handling, and Deepgram/Whisper integration. Instead, it is littered with DOM queries (e.g., `document.getElementById('speechButton')`, appending `<video>` elements to the DOM) and directly updating button `innerHTML`.
- **Component Modules**: `simpleVideo.js` and `video.js` construct their own dynamic HTML strings and directly manipulate the DOM. While acceptable for encapsulated components, they often reach out and assume the existence of external container selectors.

**Impact**: A change in the HTML structure or CSS class names requires hunting down `document.getElementById` and `document.querySelector` calls across multiple business logic files, defeating the purpose of a centralized `ui.js`.

### 3. Global Mutable State
The `js/modules/state.js` module defines a single `State` object that is exported and directly mutated by any module that imports it. For example, `script.js` directly modifies `State.speakingScore = Math.max(0, State.speakingScore - 20)`.

**Impact**: Uncontrolled state mutation makes the application unpredictable. It becomes very difficult to trace *when* and *why* a particular piece of state changed, which is a common source of bugs in complex interactive applications.

## Concrete Recommendations

1. **Strictly Enforce the UI Layer Boundary**:
   - Refactor `js/modules/ui.js` to expose well-defined functions (e.g., `setSpeechButtonLoading()`, `showPhraseScoreDeduction(points)`) rather than exposing raw `DOM` element properties.
   - Remove all `document.getElementById` and `document.querySelector` calls from `script.js` and `speech.js`. They should call functions from `ui.js` instead.

2. **Refactor `speech.js`**:
   - Extract the UI-related code (like creating webcam previews and rendering transcript accept/reject buttons) into `ui.js`. `speech.js` should only emit events or return Promises containing the final transcript, leaving the UI layer to decide how to display it.

3. **Decouple Business Logic from `script.js`**:
   - Move question handling, lesson initialization, and answer evaluation logic into dedicated controllers (e.g., `lessonController.js`, `evaluationController.js`). `script.js` should serve purely as the entry point (`main`) that wires up the controllers and event listeners.

4. **Implement State Mutators/Reducers**:
   - Prevent direct reassignment of properties on the `State` object. Implement setter methods (e.g., `State.deductSpeakingScore(points)`) or a lightweight Pub/Sub system. This allows you to easily log state changes and automatically trigger UI updates when the state changes, further decoupling state from the view layer.
