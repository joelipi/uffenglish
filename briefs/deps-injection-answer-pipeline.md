# Deps Injection: Answer Pipeline & Progression

## Goal

Remove hard `import` statements of browser-only code from the three shared-business-logic modules so they become pure platform-agnostic modules. Platform implementations are injected at call time, exactly as `step-loader-orchestrate.js` already does.

This means the same business logic — answer validation, scoring, feedback building, progression — can run on React Native without any file changes. Only the wiring file (`app-infra.js`) changes to inject native implementations.

## The proven pattern

`js/modules/step-loader-orchestrate.js` already uses this pattern:

```js
export function loadStepOrchestrate(step, lesson, fluencyData, deps = {}) {
    const { submitAnswerPrecheck, showFeedbackAndProceed, handleHint,
            onStepLoaded, onResponseStep, onTextStep, ... } = deps;
    // pure logic, no imports of browser code
}
```

The three modules below will adopt the identical approach.

---

## Module 1: `js/modules/answer-pipeline.jsx` → `js/modules/answer-pipeline.js`

**Size:** 930 lines. **Status:** Rename + wrap in factory + remove dead imports.

### Dead imports to remove

| Import | Line | Status |
|--------|------|--------|
| `import React from 'react'` | 17 | Unused (Vite auto JSX transform) |
| `import { BilingualText } from '../components/BilingualText.jsx'` | 18 | Imported but never referenced in file |

### Browser-only imports to extract into deps

| Current import | Resolves to | Inject as |
|----------------|-------------|-----------|
| `import { Media } from './media.js'` | `media.web.js` (Howler, DOM) | `playSound(soundName)` |
| `import { warmUpSpeechCamStream } from './speech.js'` | `speech.web.js` (getUserMedia) | `warmUpSpeechCam()` |
| `import { showChat, addAIFeedbackMessages, clearChat } from '../components/chat/chat-interface.js'` | `chat-interface.js` (no `.native.js`) | `showChat()`, `addAIFeedbackMessages(msgs)`, `clearChat()` |
| `import { logInteraction } from './scoring.js'` | `scoring.js` (pure) | `logInteraction(...)` — actually pure, but injected for consistency |
| `import { analyzeSpeech } from './analytics.js'` | `analytics.js` (pure) | `analyzeSpeech(...)` — pure module |

### What stays as direct imports

These are platform-agnostic and can remain:

- `./store.js` (Zustand, RN-compatible)
- `./answers.js` (pure)
- `./scoring.js` (pure — `calculateFluencyScore`)
- `./utils.js` (pure)
- `./feedback-builder.js` (pure)
- `./lessonRouting.js` (pure)
- `./storage.js` (platform-barrelled via `.web.js` / needs `.native.js`)
- `../data/strings.js` (data)
- `../data/praise.js` (data)
- `./bot-identity.js` (pure)

### Factory shape

```js
export function createAnswerPipeline(deps) {
    const {
        addChatMessage,
        showChat,
        clearChat,
        addAIFeedbackMessages,
        playSound,
        warmUpSpeechCam,
        logInteraction,
        analyzeSpeech,
        updateSpeechRecording,
    } = deps;

    // All existing functions unchanged except:
    //   Media.playSound('correct-sound')  →  playSound('correct-sound')
    //   warmUpSpeechCamStream()           →  warmUpSpeechCam()
    //   showChat() / clearChat() / addAIFeedbackMessages()  →  deps versions
    //   logInteraction(...)               →  deps version
    //   analyzeSpeech(...)                →  deps version
    //   updateSpeechRecording(...)        →  deps version

    return { handleHint, submitAnswerPrecheck, handleAnswer, showFeedbackAndProceed };
}
```

### Call-site substitutions (exhaustive)

| Current code | Replace with |
|---|---|
| `Media.playSound('correct-sound')` (line 303) | `playSound('correct-sound')` |
| `Media.playSound('incorrect-sound')` (line 479) | `playSound('incorrect-sound')` |
| `showChat()` (lines 179, 807, 821) | `showChat()` |
| `clearChat()` (line 764) | `clearChat()` |
| `addAIFeedbackMessages(...)` (lines 215, 220, 261, 265, 359, 374, 423, 455, 817, 833) | `addAIFeedbackMessages(...)` |
| `warmUpSpeechCamStream()` (not found — it's in step-loader-execute) | N/A |
| `logInteraction(...)` (lines 503, 668, 218) | `logInteraction(...)` — pure module, could stay direct |
| `analyzeSpeech(...)` (line 579) | `analyzeSpeech(...)` — pure module, could stay direct |
| `updateSpeechRecording(...)` (lines 527, 598) | `updateSpeechRecording(...)` — platform-barrelled |
| `appStore.getState().addChatMessage(...)` (multiple) | `addChatMessage(...)` — injected to avoid direct store coupling |

---

## Module 2: `js/modules/lesson-progression.js`

**Size:** 117 lines. **Status:** Wrap in factory.

### Browser-only imports to extract

| Current import | Resolves to | Inject as |
|----------------|-------------|-----------|
| `import { Media } from './media.js'` | `media.web.js` | `playSound(soundName)` |
| `import { addAILoadingMessage, getChatHistoryContext } from '../components/chat/chat-interface.js'` | `chat-interface.js` | `addAILoadingMessage(text)`, `getChatHistoryContext()` |
| `import { askEnglishTutor } from './api.js'` | `api.js` (fetch) | `askEnglishTutor(context, text)` — fetch works in RN |
| `import { saveLessonProgress } from './user-profile.js'` | `user-profile.js` (Appwrite) | `saveLessonProgress(...)` — works in RN with Appwrite SDK |

### Factory shape

```js
export function createProgression(deps) {
    const {
        addAILoadingMessage,
        getChatHistoryContext,
        askEnglishTutor,
        saveLessonProgress,
        playSound,
    } = deps;

    // all existing functions, using deps instead of direct imports

    return { updateProgressBar, showCompletionMessage, loadNextStep, loadNextLesson, handleTutorChatSubmit };
}
```

### Call-site substitutions (exhaustive)

| Current code | Replace with |
|---|---|
| `Media.playSound('lesson-complete-sound')` (line 78) | `playSound('lesson-complete-sound')` |
| `addAILoadingMessage(...)` (line 96) | `addAILoadingMessage(...)` |
| `getChatHistoryContext()` (line 98) | `getChatHistoryContext()` |
| `askEnglishTutor(context, rawText)` (line 100) | `askEnglishTutor(context, rawText)` |
| `saveLessonProgress(...)` (line 62) | `saveLessonProgress(...)` |

---

## Module 3: `js/modules/step-loader-execute.js`

**Size:** 317 lines. **Status:** Already uses `createLoadStep` factory — just extend the factory signature.

### Current factory signature

```js
export function createLoadStep(submitAnswerPrecheck, showFeedbackAndProceed, handleHint) {
    return function loadStep(step, lesson, fluencyData) { ... };
}
```

### New factory signature

```js
export function createLoadStep(deps) {
    const {
        submitAnswerPrecheck,
        showFeedbackAndProceed,
        handleHint,
        warmUpSpeechCam,          // new
        toggleSpeechRecognition,  // new
        listeningState,           // new
        clearChat,                // new
        addAIFeedbackMessages,    // new
    } = deps;

    return function loadStep(step, lesson, fluencyData) { ... };
}
```

### Call-site substitutions (exhaustive)

| Current import line | Use in file | Replace with |
|---|---|---|
| `import { warmUpSpeechCamStream }` (line 9) | Lines 42, 46 (warmUpSpeechCamStream) | `warmUpSpeechCam()` |
| `import { toggleSpeechRecognition, listeningState }` (line 9) | Lines 25-30 (listeningState), line 131 (toggleSpeechRecognition) | `toggleSpeechRecognition(...)`, `listeningState` |
| `import { clearChat, addAIFeedbackMessages }` (line 13) | Line 33 (clearChat), line 298 (addAIFeedbackMessages) | `clearChat()`, `addAIFeedbackMessages(...)` |

---

## Module 4: `js/hooks/app-infra.js`

**Status:** Becomes the wiring layer. No logic changes, just assembly.

```js
import { Media } from '../modules/media.js';
import { warmUpSpeechCamStream, toggleSpeechRecognition, listeningState } from '../modules/speech.js';
import { showChat, clearChat, addAILoadingMessage, addAIFeedbackMessages, getChatHistoryContext } from '../components/chat/chat-interface.js';
import { logInteraction } from '../modules/scoring.js';
import { analyzeSpeech } from '../modules/analytics.js';
import { updateSpeechRecording } from '../modules/storage.js';
import { askEnglishTutor } from '../modules/api.js';
import { saveLessonProgress } from '../modules/user-profile.js';

import { createAnswerPipeline } from '../modules/answer-pipeline.js';
import { createProgression } from '../modules/lesson-progression.js';
import { createLoadStep } from '../modules/step-loader-execute.js';

export async function setupAppInfra({ userData }) {
    // ... existing userData setup (pure store ops) ...

    // Build platform-agnostic pipelines with web dependencies
    const pipeline = createAnswerPipeline({
        addChatMessage: (msg) => appStore.getState().addChatMessage(msg),
        showChat,
        clearChat,
        addAIFeedbackMessages,
        playSound: Media.playSound.bind(Media),
        warmUpSpeechCam: warmUpSpeechCamStream,
        logInteraction,
        analyzeSpeech,
        updateSpeechRecording,
    });

    const progression = createProgression({
        addAILoadingMessage,
        getChatHistoryContext,
        askEnglishTutor,
        saveLessonProgress,
        playSound: Media.playSound.bind(Media),
    });

    // The rest of the existing wiring uses pipeline.submitAnswerPrecheck, etc.
    // The store callbacks (setAnswerPipelineDeps, etc.) will become unused but
    // are left in place for a follow-up pass.
}
```

---

## Module 5: `js/components/step-loader.web.js`

**Current:**

```js
import { createLoadStep } from '../modules/step-loader-execute.js';

export function loadStep(step, lesson, fluencyData, deps) {
    const execute = createLoadStep(deps.submitAnswerPrecheck, deps.showFeedbackAndProceed, deps.handleHint);
    return execute(step, lesson, fluencyData);
}
```

**After:**

```js
import { createLoadStep } from '../modules/step-loader-execute.js';
import { warmUpSpeechCamStream, toggleSpeechRecognition, listeningState } from '../modules/speech.js';
import { clearChat, addAIFeedbackMessages } from './chat/chat-interface.js';

export function loadStep(step, lesson, fluencyData, deps) {
    const execute = createLoadStep({
        ...deps,
        warmUpSpeechCam: warmUpSpeechCamStream,
        toggleSpeechRecognition,
        listeningState,
        clearChat,
        addAIFeedbackMessages,
    });
    return execute(step, lesson, fluencyData);
}
```

---

## What stays in the store (for now)

The following store callbacks are *not* removed in this pass — they become dead code but are left to minimize diff:

- `answerPipelineDeps` / `setAnswerPipelineDeps`
- `loadLessonContentCallback` / `setLoadLessonContentCallback`
- `tutorChatSubmitCallback` / `setTutorChatSubmitCallback`
- `introContinueCallback` / `setIntroContinueCallback`
- `introAudioOnlyCallback` / `setIntroAudioOnlyCallback`
- `onMicClickCallback` / `setOnMicClickCallback`
- `speechInputHintCallback` / `setSpeechInputHintCallback`
- `speechInputRevealCallback` / `setSpeechInputRevealCallback`
- `speechInputToggleCallback` / `setSpeechInputToggleCallback`
- `textInputSubmitCallback` / `setTextInputSubmitCallback`

These are removed in a separate follow-up once consumers are confirmed to use the new injection paths.

---

## What does NOT change

- **`store.js`** — untouched (callbacks remain, persist middleware unchanged)
- **`chat-interface.js`** — untouched (becomes a dep injected into pipelines)
- **`speech.web.js`** / **`media.web.js`** — untouched (become injected deps)
- **`step-loader-logic.js`** — already pure, no changes needed
- **`step-loader-orchestrate.js`** — already pure, no changes needed
- **React components** (except `step-loader.web.js`) — untuched
- **Test files** — all existing tests should pass with no changes

## Execution order

1. `answer-pipeline.jsx` → rename + remove dead imports + wrap in factory
2. `lesson-progression.js` → wrap in factory
3. `step-loader-execute.js` → extend factory signature
4. `step-loader.web.js` → pass new deps
5. `app-infra.js` → wire factories
6. Run `npm run dev` + Playwright smoke test (`tests/answer-flow.spec.js`) to verify
