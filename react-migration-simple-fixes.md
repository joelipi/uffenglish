# React Migration: Simplest Fixes

All 10 items below are self-contained, low-risk changes ordered from easiest to most involved (but still contained). Each removes imperative patterns or web-only dependencies from shared code.

---

## Tier 1 — Event Listener → JSX Prop Swaps

These are pure substitutions. Zero behavioral change because React's synthetic events use the same underlying DOM events. Each is `<5` min.

### 1. `js/components/widgets/SuccessVideo.jsx:22-24`

Remove the `useEffect` that attaches `play`/`pause`/`ended` listeners and wire them as JSX props:

```jsx
// Before
<video ref={videoRef} id="resultVideo" playsInline onClick={handleToggle} ... />

// After
<video ref={videoRef} id="resultVideo" playsInline
  onClick={handleToggle}
  onPlay={() => setPlaying(true)}
  onPause={() => setPlaying(false)}
  onEnded={() => { videoRef.current?.pause(); setPlaying(false); }}
  ... />
```

Delete lines 17-31 entirely (the `useEffect` block). The `onPlay`/`onPause`/`onEnded` closures capture `setPlaying` at the component scope — no extra cleanup needed.

### 2. `js/components/IncomingVideoWidget.jsx:27`

Replace `addEventListener('loadeddata', onLoadedData)` with `onLoadedData` JSX prop:

```jsx
// Before
<video ref={videoRef} className="intro-video" playsInline preload="auto" crossOrigin="anonymous" muted />

// After
<video ref={videoRef} className="intro-video" playsInline preload="auto"
  crossOrigin="anonymous" muted onLoadedData={onLoadedData} />
```

Delete line 27 (`video.addEventListener('loadeddata', onLoadedData)`) and its cleanup on line 34 (`video.removeEventListener('loadeddata', onLoadedData)`). Keep the `if (video.readyState >= 2)` check — it handles the synchronous-ready edge case and still needs the `useEffect`.

### 3. `js/components/chat/VideoBubble.jsx:22`

Replace `addEventListener('click', toggleMute)` with `onClick` JSX prop:

```jsx
// Before
<video ref={videoRef} playsInline loop style={...} />

// After
<video ref={videoRef} playsInline loop onClick={toggleMute} style={...} />
```

Delete line 22 (`video.addEventListener('click', toggleMute)`) and line 25 (`video.removeEventListener('click', toggleMute)`).

### 4. `js/components/PlaybackVideo.jsx:63`

Replace `addEventListener('click', onToggleMute)` with `onClick` JSX prop on the `<video>` element (line 136):

```jsx
// Before
<video ref={videoRef} id="playback-video" playsInline preload="auto" loop
  style={{ cursor: 'pointer' }} />

// After
<video ref={videoRef} id="playback-video" playsInline preload="auto" loop
  style={{ cursor: 'pointer' }}
  onClick={() => {
    const video = videoRef.current;
    if (!video) return;
    const next = !video.muted;
    video.muted = next;
    appStore.getState().setPlaybackMuted(next);
  }} />
```

Then remove:
- Lines 57-63 (the `onToggleMute` definition + `addEventListener`)
- Line 93 (`removeEventListener('click', onToggleMute)`)

---

## Tier 2 — Simple Runtime Substitutions

These swap a web-only call for its React equivalent. Each is `<10` min.

### 5. `js/components/LessonContainer.jsx:119`

Replace the `<a href="homescreen.html">` close button with React Router's `<Link>`:

```jsx
import { useParams, Link } from 'react-router-dom';   // line 2 — just add Link

// Before
<a href="homescreen.html" id="closePage" className="d-flex align-items-center ...">

// After
<Link to="/" id="closePage" className="d-flex align-items-center ...">
```

(If there isn't a home route registered yet, create a `/` route in `App.jsx` that navigates to the homescreen, or use `<Link to="/course/gt2/lesson/a">` as a fallback.)

### 6. `js/index.jsx:10-17` — Clean React mount

Replace the `document.querySelector`/`createElement`/`appendChild` bootstrap with a standard mount point.

First, add `id="root"` to the `.video-frame` div in `index.html`:

```html
<div id="root" class="video-frame position-relative shadow-lg">
```

Then simplify `index.jsx` to:

```jsx
const rootEl = document.getElementById('root');
const root = createRoot(rootEl);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

**Caveat:** `<video id="originalVideo">` lives inside `.video-frame` (same container). If this approach is taken, the video element must be moved outside `#root` or rendered by React. The simplest path for now: move the `<video id="originalVideo">` just before the `</main>` closing tag in `index.html`, outside any React container.

### 7. `js/modules/store.js:525-536` — Remove `window.isMicActive` bridge

Delete the `Object.defineProperty(window, 'isMicActive', ...)` block at the bottom of `store.js`.

Update the one consumer in `js/components/InteractiveVideoWrapper.jsx:90`:

```jsx
// Before
if (window.isMicActive) {

// After
if (appStore.getState().isMicActive) {
```

`InteractiveVideoWrapper.jsx` already imports `appStore` (line 4), so no new import is needed.

### 8. `js/modules/step-loader-execute.js:33` — Remove `window.__currentStepIndex`

Replace the global write with a Zustand set:

```jsx
// Before
window.__currentStepIndex = getCurrentStepIndex(step, appStore.getState().configData, appStore.getState().currentLessonIndex);

// After
appStore.setState({ currentStepIndex: getCurrentStepIndex(step, appStore.getState().configData, appStore.getState().currentLessonIndex) });
```

Search the codebase for any reader of `window.__currentStepIndex`. If none exists, this is purely dead code. If there is one, update it to read from `appStore.getState().currentStepIndex` instead.

---

## Tier 3 — Contained Refactors

These touch one file each but change more logic. Still self-contained.

### 9. `js/components/chat/chat-interface.js:23-46` — Remove DOM checks from `addAIFeedbackMessages`

Currently the function receives DOM `Element` objects and inspects `classList.contains`, `innerHTML`, and `outerHTML`. It should work purely with data objects instead.

**Before** (the function accepts a mix of `Element` nodes and HTML strings, inspects DOM properties):
```js
contentChunks.filter(Boolean).forEach(chunk => {
  const isPraise = chunk instanceof Element && chunk.classList.contains('chat-message-row--system') && chunk.querySelector('strong');
  if (isPraise) {
    const strongEl = chunk.querySelector('strong');
    const praiseText = strongEl ? strongEl.innerHTML : '';
    appStore.getState().addChatMessage({
      role: 'system', type: 'praise', content: praiseText, ...
    });
  } else {
    const htmlContent = typeof chunk === 'string' ? chunk : chunk.outerHTML;
    appStore.getState().addChatMessage({
      role: 'system', type: 'htmlChunk', content: htmlContent
    });
  }
});
```

**After** (the function only accepts plain objects, uses the typed message system that `ChatInterface.jsx` already supports):

Update the callers in `feedback-builder.js` and `step-loader-execute.js` to pass typed message objects instead of HTML strings. Each feedback bubble type (`stats`, `grammarDiff`, `pragmatics`, `praise`) already has a component in `ChatInterface.jsx` — use those directly via Zustand message objects rather than building HTML and re-parsing it.

This fix eliminates `dangerouslySetInnerHTML` in `HtmlChunk` (line 28 of `ChatInterface.jsx`) and makes the chat pipeline portable to React Native.

### 10. `js/components/InteractiveVideoWrapper.jsx` — Remove `document.getElementById('ivp-container')` portal target

Replace the `portalTarget()` function (line 7-9) that calls `document.getElementById('ivp-container')` with in-component rendering. Instead of creating a portal to an out-of-tree DOM node, render the video wrapper div directly:

```jsx
// Replace the portal at lines 144-147
return target && isActive ? createPortal(
  <div ref={containerRef} className="video-wrapper" style={{ width: '100%', height: '100%' }}></div>,
  target
) : null;

// With an inline render
return isActive ? (
  <div ref={containerRef} className="video-wrapper"
    style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
  </div>
) : null;
```

This makes the interactive video player's lifecycle fully React-managed and removes the `document.getElementById` dependency. The `player.video` element is still accessed via `playerInstance.current` ref, but the container is now part of the React tree.

---

## What Not To Fix Yet

| File | Reason to postpone |
|---|---|
| `interactive-video-player.js` | Full class rewrite — large scope, needs dedicated effort |
| `feedback-renderer.web.js` | 226 lines of HTML templates — best done as proper React components in a batch |
| `video-processor.web.js` | Heavy web API usage (`AudioContext`, `canvas`, `MediaRecorder`) — needs native equivalent first |
| `speech.web.js` | Same — dependent on web-only APIs (`getUserMedia`, `AudioWorklet`) |
| `useInitializeLesson.js` / `useAppBootstrap.js` | `window.location` and `localStorage` extraction is premature without knowing the RN routing strategy |
| Store splitting | Not needed until RN profiling shows a bottleneck |
| Appwrite → TanStack mutations | Works as-is; not a blocker |
