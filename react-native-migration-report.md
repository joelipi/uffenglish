# React Native Migration Report

This report provides a detailed, file-by-file analysis of the required changes to migrate the existing vanilla JavaScript web application to React Native. It identifies DOM manipulations, web-specific APIs (like LocalStorage, Web Workers, Web Audio/Video), and architectural considerations.

## `index.html`
**Status: REPLACE ENTIRELY**

**Details:** This is the core web entry point containing the full DOM structure. In React Native, there are no HTML files. This entire file must be replaced by an `App.js` or `index.js` React entry point. The HTML structure must be translated into a hierarchy of React Native components (e.g., `<View>`, `<Text>`, `<SafeAreaView>`). All Bootstrap classes must be converted into React Native `StyleSheet` objects. The embedded script tags must become module imports.

## `js/app.js`
**Status: REFACTOR REQUIRED.** This logic file contains web-specific APIs. It needs to be refactored to be platform-agnostic (e.g., injecting dependencies), or a `.native.js` counterpart must be created.

**Details:** Uses `localStorage` or `sessionStorage`. Must be replaced with React Native `AsyncStorage` or similar persistent storage solution. References the `window` object. This is not available in React Native. Any global state or browser-specific window APIs need to be refactored. Performs direct DOM manipulation. In React Native, DOM manipulation is not used. UI must be driven entirely by state using functional components and hooks. Uses the `navigator` API (e.g., for microphone, permissions, or storage). React Native requires specific native modules (like `expo-av` for audio or `expo-file-system`) for these capabilities. Initializes a Web Worker. React Native does not support standard Web Workers. Heavy background tasks should be moved to native modules, libraries like `react-native-worklets-core`, or managed differently.

## `js/components/feedback-renderer.js`
**Status: PLATFORM-AGNOSTIC. KEEP AS-IS.** This file appears to contain pure logic without web dependencies and should work unmodified in React Native.

## `js/components/feedback-renderer.web.js`
**Status: CREATE COUNTERPART.** This is a web-specific implementation. A `.native.js` or `.native.jsx` equivalent must be created to handle this functionality natively. This file can be kept for the web build.

## `js/components/interactive-video-player.js`
**Status: REWRITE AS REACT NATIVE COMPONENT.** This component relies on the DOM. It must be completely rewritten using React Native components (`View`, `Text`, `TouchableOpacity`, etc.) and saved as a `.native.jsx` file or a new `_react.jsx` file.

**Details:** References the `window` object. This is not available in React Native. Any global state or browser-specific window APIs need to be refactored. Performs direct DOM manipulation. In React Native, DOM manipulation is not used. UI must be driven entirely by state using functional components and hooks. Uses the `navigator` API (e.g., for microphone, permissions, or storage). React Native requires specific native modules (like `expo-av` for audio or `expo-file-system`) for these capabilities.

## `js/components/interactive-video-player.native.jsx`
**Status: KEEP.** This file is already formatted for React Native.

## `js/components/intro-background-video.js`
**Status: REWRITE AS REACT NATIVE COMPONENT.** This component relies on the DOM. It must be completely rewritten using React Native components (`View`, `Text`, `TouchableOpacity`, etc.) and saved as a `.native.jsx` file or a new `_react.jsx` file.

**Details:** Performs direct DOM manipulation. In React Native, DOM manipulation is not used. UI must be driven entirely by state using functional components and hooks.

## `js/components/mic-animation.js`
**Status: REWRITE AS REACT NATIVE COMPONENT.** This component relies on the DOM. It must be completely rewritten using React Native components (`View`, `Text`, `TouchableOpacity`, etc.) and saved as a `.native.jsx` file or a new `_react.jsx` file.

**Details:** Performs direct DOM manipulation. In React Native, DOM manipulation is not used. UI must be driven entirely by state using functional components and hooks.

## `js/components/point-loss-animation.js`
**Status: REWRITE AS REACT NATIVE COMPONENT.** This component relies on the DOM. It must be completely rewritten using React Native components (`View`, `Text`, `TouchableOpacity`, etc.) and saved as a `.native.jsx` file or a new `_react.jsx` file.

**Details:** References the `window` object. This is not available in React Native. Any global state or browser-specific window APIs need to be refactored. Performs direct DOM manipulation. In React Native, DOM manipulation is not used. UI must be driven entirely by state using functional components and hooks.

## `js/components/simple-video-player.js`
**Status: REWRITE AS REACT NATIVE COMPONENT.** This component relies on the DOM. It must be completely rewritten using React Native components (`View`, `Text`, `TouchableOpacity`, etc.) and saved as a `.native.jsx` file or a new `_react.jsx` file.

**Details:** References the `window` object. This is not available in React Native. Any global state or browser-specific window APIs need to be refactored. Performs direct DOM manipulation. In React Native, DOM manipulation is not used. UI must be driven entirely by state using functional components and hooks. Uses the `navigator` API (e.g., for microphone, permissions, or storage). React Native requires specific native modules (like `expo-av` for audio or `expo-file-system`) for these capabilities.

## `js/components/simple-video-player.native.jsx`
**Status: KEEP.** This file is already formatted for React Native.

## `js/components/step-loader.js`
**Status: PLATFORM-AGNOSTIC. KEEP AS-IS.** This file appears to contain pure logic without web dependencies and should work unmodified in React Native.

## `js/components/step-loader.web.js`
**Status: CREATE COUNTERPART.** This is a web-specific implementation. A `.native.js` or `.native.jsx` equivalent must be created to handle this functionality natively. This file can be kept for the web build.

**Details:** References the `window` object. This is not available in React Native. Any global state or browser-specific window APIs need to be refactored. Performs direct DOM manipulation. In React Native, DOM manipulation is not used. UI must be driven entirely by state using functional components and hooks.

## `js/components/success-lesson.js`
**Status: REWRITE AS REACT NATIVE COMPONENT.** This component relies on the DOM. It must be completely rewritten using React Native components (`View`, `Text`, `TouchableOpacity`, etc.) and saved as a `.native.jsx` file or a new `_react.jsx` file.

**Details:** References the `window` object. This is not available in React Native. Any global state or browser-specific window APIs need to be refactored. Performs direct DOM manipulation. In React Native, DOM manipulation is not used. UI must be driven entirely by state using functional components and hooks.

## `js/components/ui.js`
**Status: REWRITE AS REACT NATIVE COMPONENT.** This component relies on the DOM. It must be completely rewritten using React Native components (`View`, `Text`, `TouchableOpacity`, etc.) and saved as a `.native.jsx` file or a new `_react.jsx` file.

**Details:** References the `window` object. This is not available in React Native. Any global state or browser-specific window APIs need to be refactored. Performs direct DOM manipulation. In React Native, DOM manipulation is not used. UI must be driven entirely by state using functional components and hooks. Uses the `navigator` API (e.g., for microphone, permissions, or storage). React Native requires specific native modules (like `expo-av` for audio or `expo-file-system`) for these capabilities.

## `js/components/ui.test.js`
**Status: REWRITE AS REACT NATIVE COMPONENT.** This component relies on the DOM. It must be completely rewritten using React Native components (`View`, `Text`, `TouchableOpacity`, etc.) and saved as a `.native.jsx` file or a new `_react.jsx` file.

**Details:** Performs direct DOM manipulation. In React Native, DOM manipulation is not used. UI must be driven entirely by state using functional components and hooks.

## `js/components/ui_react.jsx`
**Status: PLATFORM-AGNOSTIC. KEEP AS-IS.** This file appears to contain pure logic without web dependencies and should work unmodified in React Native.

## `js/data/praise.js`
**Status: PLATFORM-AGNOSTIC. KEEP AS-IS.** This file appears to contain pure logic without web dependencies and should work unmodified in React Native.

## `js/data/strings.js`
**Status: PLATFORM-AGNOSTIC. KEEP AS-IS.** This file appears to contain pure logic without web dependencies and should work unmodified in React Native.

## `js/modules/analytics.js`
**Status: PLATFORM-AGNOSTIC. KEEP AS-IS.** This file appears to contain pure logic without web dependencies and should work unmodified in React Native.

## `js/modules/answers.js`
**Status: PLATFORM-AGNOSTIC. KEEP AS-IS.** This file appears to contain pure logic without web dependencies and should work unmodified in React Native.

## `js/modules/api.js`
**Status: REFACTOR REQUIRED.** This logic file contains web-specific APIs. It needs to be refactored to be platform-agnostic (e.g., injecting dependencies), or a `.native.js` counterpart must be created.

**Details:** Uses `localStorage` or `sessionStorage`. Must be replaced with React Native `AsyncStorage` or similar persistent storage solution.

## `js/modules/appwrite.js`
**Status: PLATFORM-AGNOSTIC. KEEP AS-IS.** This file appears to contain pure logic without web dependencies and should work unmodified in React Native.

## `js/modules/calculate-similarity.js`
**Status: PLATFORM-AGNOSTIC. KEEP AS-IS.** This file appears to contain pure logic without web dependencies and should work unmodified in React Native.

## `js/modules/calculate-similarity.test.js`
**Status: PLATFORM-AGNOSTIC. KEEP AS-IS.** This file appears to contain pure logic without web dependencies and should work unmodified in React Native.

## `js/modules/collect-signup-data.js`
**Status: REFACTOR REQUIRED.** This logic file contains web-specific APIs. It needs to be refactored to be platform-agnostic (e.g., injecting dependencies), or a `.native.js` counterpart must be created.

**Details:** Uses `localStorage` or `sessionStorage`. Must be replaced with React Native `AsyncStorage` or similar persistent storage solution.

## `js/modules/complexity.js`
**Status: PLATFORM-AGNOSTIC. KEEP AS-IS.** This file appears to contain pure logic without web dependencies and should work unmodified in React Native.

## `js/modules/config-normalizer.js`
**Status: PLATFORM-AGNOSTIC. KEEP AS-IS.** This file appears to contain pure logic without web dependencies and should work unmodified in React Native.

## `js/modules/config-normalizer.test.js`
**Status: PLATFORM-AGNOSTIC. KEEP AS-IS.** This file appears to contain pure logic without web dependencies and should work unmodified in React Native.

## `js/modules/feedback-builder.js`
**Status: PLATFORM-AGNOSTIC. KEEP AS-IS.** This file appears to contain pure logic without web dependencies and should work unmodified in React Native.

## `js/modules/geo-service.js`
**Status: PLATFORM-AGNOSTIC. KEEP AS-IS.** This file appears to contain pure logic without web dependencies and should work unmodified in React Native.

## `js/modules/geo-service.native.js`
**Status: KEEP.** This file is already formatted for React Native.

## `js/modules/geo-service.web.js`
**Status: CREATE COUNTERPART.** This is a web-specific implementation. A `.native.js` or `.native.jsx` equivalent must be created to handle this functionality natively. This file can be kept for the web build.

## `js/modules/idiom-checker.js`
**Status: REFACTOR REQUIRED.** This logic file contains web-specific APIs. It needs to be refactored to be platform-agnostic (e.g., injecting dependencies), or a `.native.js` counterpart must be created.

**Details:** References the `window` object. This is not available in React Native. Any global state or browser-specific window APIs need to be refactored.

## `js/modules/interactive-video-controller.js`
**Status: PLATFORM-AGNOSTIC. KEEP AS-IS.** This file appears to contain pure logic without web dependencies and should work unmodified in React Native.

## `js/modules/lesson-router.js`
**Status: REFACTOR REQUIRED.** This logic file contains web-specific APIs. It needs to be refactored to be platform-agnostic (e.g., injecting dependencies), or a `.native.js` counterpart must be created.

**Details:** Uses `localStorage` or `sessionStorage`. Must be replaced with React Native `AsyncStorage` or similar persistent storage solution. References the `window` object. This is not available in React Native. Any global state or browser-specific window APIs need to be refactored. Performs direct DOM manipulation. In React Native, DOM manipulation is not used. UI must be driven entirely by state using functional components and hooks.

## `js/modules/media.js`
**Status: PLATFORM-AGNOSTIC. KEEP AS-IS.** This file appears to contain pure logic without web dependencies and should work unmodified in React Native.

## `js/modules/media.native.js`
**Status: KEEP.** This file is already formatted for React Native.

## `js/modules/media.web.js`
**Status: CREATE COUNTERPART.** This is a web-specific implementation. A `.native.js` or `.native.jsx` equivalent must be created to handle this functionality natively. This file can be kept for the web build.

**Details:** References the `window` object. This is not available in React Native. Any global state or browser-specific window APIs need to be refactored. Performs direct DOM manipulation. In React Native, DOM manipulation is not used. UI must be driven entirely by state using functional components and hooks. Uses Web Audio API or `Audio` objects. Must be replaced with a native audio library like `expo-av`.

## `js/modules/navigation.js`
**Status: PLATFORM-AGNOSTIC. KEEP AS-IS.** This file appears to contain pure logic without web dependencies and should work unmodified in React Native.

## `js/modules/navigation.native.js`
**Status: KEEP.** This file is already formatted for React Native.

## `js/modules/navigation.web.js`
**Status: CREATE COUNTERPART.** This is a web-specific implementation. A `.native.js` or `.native.jsx` equivalent must be created to handle this functionality natively. This file can be kept for the web build.

**Details:** References the `window` object. This is not available in React Native. Any global state or browser-specific window APIs need to be refactored. Performs direct DOM manipulation. In React Native, DOM manipulation is not used. UI must be driven entirely by state using functional components and hooks.

## `js/modules/normalize.js`
**Status: PLATFORM-AGNOSTIC. KEEP AS-IS.** This file appears to contain pure logic without web dependencies and should work unmodified in React Native.

## `js/modules/normalize.test.js`
**Status: PLATFORM-AGNOSTIC. KEEP AS-IS.** This file appears to contain pure logic without web dependencies and should work unmodified in React Native.

## `js/modules/referrer.js`
**Status: PLATFORM-AGNOSTIC. KEEP AS-IS.** This file appears to contain pure logic without web dependencies and should work unmodified in React Native.

## `js/modules/referrer.native.js`
**Status: KEEP.** This file is already formatted for React Native.

## `js/modules/referrer.web.js`
**Status: CREATE COUNTERPART.** This is a web-specific implementation. A `.native.js` or `.native.jsx` equivalent must be created to handle this functionality natively. This file can be kept for the web build.

**Details:** References the `window` object. This is not available in React Native. Any global state or browser-specific window APIs need to be refactored. Performs direct DOM manipulation. In React Native, DOM manipulation is not used. UI must be driven entirely by state using functional components and hooks.

## `js/modules/scoring.js`
**Status: PLATFORM-AGNOSTIC. KEEP AS-IS.** This file appears to contain pure logic without web dependencies and should work unmodified in React Native.

## `js/modules/scoring.test.js`
**Status: PLATFORM-AGNOSTIC. KEEP AS-IS.** This file appears to contain pure logic without web dependencies and should work unmodified in React Native.

## `js/modules/simple-video-controller.js`
**Status: PLATFORM-AGNOSTIC. KEEP AS-IS.** This file appears to contain pure logic without web dependencies and should work unmodified in React Native.

## `js/modules/speech.core.js`
**Status: PLATFORM-AGNOSTIC. KEEP AS-IS.** This file appears to contain pure logic without web dependencies and should work unmodified in React Native.

## `js/modules/speech.js`
**Status: PLATFORM-AGNOSTIC. KEEP AS-IS.** This file appears to contain pure logic without web dependencies and should work unmodified in React Native.

## `js/modules/speech.web.js`
**Status: CREATE COUNTERPART.** This is a web-specific implementation. A `.native.js` or `.native.jsx` equivalent must be created to handle this functionality natively. This file can be kept for the web build.

**Details:** References the `window` object. This is not available in React Native. Any global state or browser-specific window APIs need to be refactored. Performs direct DOM manipulation. In React Native, DOM manipulation is not used. UI must be driven entirely by state using functional components and hooks. Uses the `navigator` API (e.g., for microphone, permissions, or storage). React Native requires specific native modules (like `expo-av` for audio or `expo-file-system`) for these capabilities. Uses Web Audio API or `Audio` objects. Must be replaced with a native audio library like `expo-av`.

## `js/modules/state.js`
**Status: PLATFORM-AGNOSTIC. KEEP AS-IS.** This file appears to contain pure logic without web dependencies and should work unmodified in React Native.

## `js/modules/state.test.js`
**Status: PLATFORM-AGNOSTIC. KEEP AS-IS.** This file appears to contain pure logic without web dependencies and should work unmodified in React Native.

## `js/modules/storage-adapter.js`
**Status: REFACTOR REQUIRED.** This logic file contains web-specific APIs. It needs to be refactored to be platform-agnostic (e.g., injecting dependencies), or a `.native.js` counterpart must be created.

**Details:** Uses `localStorage` or `sessionStorage`. Must be replaced with React Native `AsyncStorage` or similar persistent storage solution.

## `js/modules/storage.js`
**Status: PLATFORM-AGNOSTIC. KEEP AS-IS.** This file appears to contain pure logic without web dependencies and should work unmodified in React Native.

## `js/modules/storage.web.js`
**Status: CREATE COUNTERPART.** This is a web-specific implementation. A `.native.js` or `.native.jsx` equivalent must be created to handle this functionality natively. This file can be kept for the web build.

**Details:** Uses IndexedDB. Consider replacing with `AsyncStorage`, SQLite, or a state management library's persistence layer in React Native.

## `js/modules/store.js`
**Status: REFACTOR REQUIRED.** This logic file contains web-specific APIs. It needs to be refactored to be platform-agnostic (e.g., injecting dependencies), or a `.native.js` counterpart must be created.

**Details:** Uses `localStorage` or `sessionStorage`. Must be replaced with React Native `AsyncStorage` or similar persistent storage solution.

## `js/modules/store.test.js`
**Status: PLATFORM-AGNOSTIC. KEEP AS-IS.** This file appears to contain pure logic without web dependencies and should work unmodified in React Native.

## `js/modules/swearjar.js`
**Status: PLATFORM-AGNOSTIC. KEEP AS-IS.** This file appears to contain pure logic without web dependencies and should work unmodified in React Native.

## `js/modules/user-profile.js`
**Status: PLATFORM-AGNOSTIC. KEEP AS-IS.** This file appears to contain pure logic without web dependencies and should work unmodified in React Native.

## `js/modules/utils.js`
**Status: PLATFORM-AGNOSTIC. KEEP AS-IS.** This file appears to contain pure logic without web dependencies and should work unmodified in React Native.

## `js/modules/utils.test.js`
**Status: PLATFORM-AGNOSTIC. KEEP AS-IS.** This file appears to contain pure logic without web dependencies and should work unmodified in React Native.

## `js/modules/video-loader.js`
**Status: PLATFORM-AGNOSTIC. KEEP AS-IS.** This file appears to contain pure logic without web dependencies and should work unmodified in React Native.

## `js/modules/video-loader.web.js`
**Status: CREATE COUNTERPART.** This is a web-specific implementation. A `.native.js` or `.native.jsx` equivalent must be created to handle this functionality natively. This file can be kept for the web build.

**Details:** References the `window` object. This is not available in React Native. Any global state or browser-specific window APIs need to be refactored. Performs direct DOM manipulation. In React Native, DOM manipulation is not used. UI must be driven entirely by state using functional components and hooks.

## `js/modules/video-processor-logic.js`
**Status: PLATFORM-AGNOSTIC. KEEP AS-IS.** This file appears to contain pure logic without web dependencies and should work unmodified in React Native.

## `js/modules/video-processor-native.jsx`
**Status: PLATFORM-AGNOSTIC. KEEP AS-IS.** This file appears to contain pure logic without web dependencies and should work unmodified in React Native.

## `js/modules/video-processor.js`
**Status: PLATFORM-AGNOSTIC. KEEP AS-IS.** This file appears to contain pure logic without web dependencies and should work unmodified in React Native.

## `js/modules/video-processor.web.js`
**Status: CREATE COUNTERPART.** This is a web-specific implementation. A `.native.js` or `.native.jsx` equivalent must be created to handle this functionality natively. This file can be kept for the web build.

**Details:** References the `window` object. This is not available in React Native. Any global state or browser-specific window APIs need to be refactored. Performs direct DOM manipulation. In React Native, DOM manipulation is not used. UI must be driven entirely by state using functional components and hooks. Uses the `navigator` API (e.g., for microphone, permissions, or storage). React Native requires specific native modules (like `expo-av` for audio or `expo-file-system`) for these capabilities. Uses Web Audio API or `Audio` objects. Must be replaced with a native audio library like `expo-av`.

## `js/modules/video-share.js`
**Status: PLATFORM-AGNOSTIC. KEEP AS-IS.** This file appears to contain pure logic without web dependencies and should work unmodified in React Native.

## `js/modules/video-share.web.js`
**Status: CREATE COUNTERPART.** This is a web-specific implementation. A `.native.js` or `.native.jsx` equivalent must be created to handle this functionality natively. This file can be kept for the web build.

**Details:** Performs direct DOM manipulation. In React Native, DOM manipulation is not used. UI must be driven entirely by state using functional components and hooks. Uses the `navigator` API (e.g., for microphone, permissions, or storage). React Native requires specific native modules (like `expo-av` for audio or `expo-file-system`) for these capabilities.

## `js/workers/nlp-worker-web.js`
**Status: ARCHITECTURE CHANGE REQUIRED.** This is a Web Worker. Its logic cannot be used directly. The functionality must be rewritten as a native module, background task, or kept strictly for the web build if local AI isn't feasible on mobile yet.

**Details:** Initializes a Web Worker. React Native does not support standard Web Workers. Heavy background tasks should be moved to native modules, libraries like `react-native-worklets-core`, or managed differently.

## `js/workers/whisper/app-vad-asr-web.js`
**Status: ARCHITECTURE CHANGE REQUIRED.** This is a Web Worker. Its logic cannot be used directly. The functionality must be rewritten as a native module, background task, or kept strictly for the web build if local AI isn't feasible on mobile yet.

**Details:** References the `window` object. This is not available in React Native. Any global state or browser-specific window APIs need to be refactored. Performs direct DOM manipulation. In React Native, DOM manipulation is not used. UI must be driven entirely by state using functional components and hooks. Initializes a Web Worker. React Native does not support standard Web Workers. Heavy background tasks should be moved to native modules, libraries like `react-native-worklets-core`, or managed differently.

## `js/workers/whisper/audio-processor.js`
**Status: ARCHITECTURE CHANGE REQUIRED.** This is a Web Worker. Its logic cannot be used directly. The functionality must be rewritten as a native module, background task, or kept strictly for the web build if local AI isn't feasible on mobile yet.

## `js/workers/whisper/whisper-worker-demo.js`
**Status: ARCHITECTURE CHANGE REQUIRED.** This is a Web Worker. Its logic cannot be used directly. The functionality must be rewritten as a native module, background task, or kept strictly for the web build if local AI isn't feasible on mobile yet.

**Details:** Uses the `navigator` API (e.g., for microphone, permissions, or storage). React Native requires specific native modules (like `expo-av` for audio or `expo-file-system`) for these capabilities.

## `js/workers/whisper/whisper-worker-web.js`
**Status: ARCHITECTURE CHANGE REQUIRED.** This is a Web Worker. Its logic cannot be used directly. The functionality must be rewritten as a native module, background task, or kept strictly for the web build if local AI isn't feasible on mobile yet.

**Details:** Uses the `navigator` API (e.g., for microphone, permissions, or storage). React Native requires specific native modules (like `expo-av` for audio or `expo-file-system`) for these capabilities.
