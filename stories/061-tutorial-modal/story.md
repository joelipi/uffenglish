# Per-step-type tutorial modal with portrait videos and localized subtitles

## Context

Three decision rows each mount a tutorial button that opens a placeholder `TutorialModal` (`src/components/widgets/TutorialModal.jsx:3`): `ViewAndContinueButtons.jsx:50` (`#tutorialBtn`), `ResponseDecisionButtons.jsx:74` (`#responseTutorialBtn`), `BranchChoiceButtons.jsx:56` (`#branchTutorialBtn`). The modal today renders only "Tutorial video coming soon" (`TutorialModal.jsx:31-34`), takes no `stepType` prop, and has no video, no scrollable takeover, no corner X, no subtitles, and no localized Continue. The existing Playwright contract (`tests/simple-response-overlay.spec.js:172-183`) locks backdrop-click dismiss of `.tutorial-modal-overlay`. This story wires the button as requested: a full-screen scrollable modal with a corner X styled like the app's existing close X, a localized Continue under a portrait tutorial video unique to the step type, app-rendered subtitles in the learner's session language (guest-first, so a guest's chosen language outranks the browser default), plus the spoken scripts and their translations and a placeholder-mp4 generator that uses only dependencies already in the repo.

## Out of Scope

- Recording, uploading, or editing the final narrated tutorial videos. This story ships text-on-screen placeholders to R2; the polished voiceover render is a later story.
- `lessonIntro` and `success` step types. They have no tutorial button and get no tutorial video.
- Tutorial posters. Posters are R2-only siblings of lesson media (`src/modules/video/video-url.js:30-34`); the tutorial modal uses `preload="metadata"` with no poster, so no `.jpg` is generated or uploaded.
- Autoplay of the tutorial video. Per the request it is tap-to-play with controls.
- Timed (SRC cue-by-cue) tutorial subtitles, per-language VTT files on R2, and `hi`/`bn` translations of the tutorial scripts — the scripts ship with en/es/pt/fr and `hi`/`bn` fall back to English, matching the documented partial localization.
- Bilingual (English + translation stacked) tutorial subtitles; the subtitle band shows the session language only.
- Any change to the lesson video pipeline, config generator, sheet columns, captions, recap, or publish flows.

## Implementation approach

New pure module `src/modules/video/tutorial-logic.js` owns every decision: the supported set (`viewAndContinue`, `closedResponse`, `openResponse`, `friendClosedResponse`, `branching`), the slug rule `` `tutorial-${stepType}` `` (bare slugs avoided per the `tutorial` prefix decision; no lesson slug collides because lesson slugs are content names such as `do_you_have_rolls_too` while tutorial slugs carry the prefix), URL resolution delegated to the existing `getVideoUrl(slug)` (`src/modules/video/video-url.js:12-28`, dev `/assets/videos/<slug>.mp4` via the Vite proxy at `vite.config.js:73-77`, prod `https://r2.ultrafastfluency.com/assets/videos/<slug>.mp4`), the five spoken scripts and their es/pt/fr translations (Task 5, verbatim), portrait constants `720x1280` (9:16, matching the app frame `aspect-ratio: 9/16` and the recap `1080x1920` composite at half scale for fast R2 load), and the close/backdrop handler factory plus the step-type opener factory (both pure, so the component only attaches handlers). Escape and a backdrop tap always dismiss — there is no per-step-type variation to thread through, so no policy flags exist. Subtitles are rendered by the app, never as a `<track>`: the repo has no `addTextTrack`/`<track>` usage and lesson subtitles are supplied as localized SRT strings that `SimpleVideoStateController` parses (`src/modules/video/simple-video-controller.js:54-89`), so hosting a per-language VTT is unnecessary — `getTutorialSubtitleText(stepType, lang)` returns the script translated for the session language and the modal renders it with the existing `.ivp-subtitle-scroll-container`/`.ivp-subtitles` classes. The session language comes only from the standard `useNativeLanguage()` hook (`src/hooks/use-native-language.js`, which resolves `guestNativeLanguage || userData?.native_language || 'en'` through `resolveConfigLanguage`), so a guest's chosen/adopted language outranks the browser default exactly as everywhere else in the app; no component reads `navigator.language` directly. The store side-effect has exactly one call site — the modal's mount effect — so every row inherits it and no row needs progression access; it lives in the existing effect home `src/modules/lesson/lesson-progression.js` as `pauseLessonVideoForTutorial()` following the same `createProgression` + module-level passthrough pattern as `replaySimpleVideo()` (`lesson-progression.js:115-116` defined inside, `234` re-exported; `ResponseDecisionButtons.jsx:6` already imports from there): inside it calls `getCurrentVideoPlayer()?.pause()` (already imported at `lesson-progression.js:8` from `../store/store.js`) plus `triggerPauseAllVideos()` (store action at `store.js:399`, which `PlaybackVideo.jsx:110-118` already subscribes to). `TutorialModal.jsx` becomes render-only: it receives `{ stepType, onClose }`, resolves everything through `tutorial-logic.js` plus the existing `useNativeLanguage()` hook (`src/hooks/use-native-language.js`) and `getBilingual('continue', lang)` (`src/data/strings.js:2083-2090`), and renders markup/CSS with no inline gates, mapping, URL building, or text selection. Each caller passes a context-determined type with no fallback guessing: `ViewAndContinueButtons` passes the literal `'viewAndContinue'` (it only renders in the view-and-continue decision phase), `BranchChoiceButtons` passes the literal `'branching'` (it only renders for `bottomState === 'branchChoices'` at `LessonContainer.jsx:269-278`), and `ResponseDecisionButtons` passes `currentVideo?.responseType` (already subscribed at `ResponseDecisionButtons.jsx:15`; `currentVideo` carries `responseType` per the `setCurrentVideo` contract in `store.js:369-371`). The placeholder generator `scripts/generate-tutorial-placeholders.mjs` uses only existing dev/dependencies (`@playwright/test` to drive real Chrome with H.264 per the repo rule, native `MediaRecorder` + `canvas.captureStream` for encoding, `wrangler` for upload) and writes outside the repo (gitignored `public/assets/videos/*.mp4` at `.gitignore:25-26` forbids committing mp4s), because Node has no `VideoEncoder` (`typeof VideoEncoder === 'undefined'`) and `ffmpeg` is not installed here, while Chromium MediaRecorder produces real H.264 mp4s in the browser where the encoder exists.

## Tasks

### Task 1 - Pure tutorial-logic module with slug, URL, script, and policy rules

- Supported step type + `getTutorialSlug` called
  - → returns `tutorial-viewAndContinue`, `tutorial-closedResponse`, `tutorial-openResponse`, `tutorial-friendClosedResponse`, `tutorial-branching` respectively
  - → returns `null` for `lessonIntro`, `success`, unknown, empty, or non-string input
- Any value + `isTutorialStepType` called
  - → returns `true` only for the 5 supported types, `false` otherwise
- Supported step type + `getTutorialVideoUrl` called
  - → returns `getVideoUrl(getTutorialSlug(stepType))` (dev `/assets/videos/tutorial-<type>.mp4`, prod `https://r2.ultrafastfluency.com/assets/videos/tutorial-<type>.mp4`)
- Supported step type + `getTutorialScript` called
  - → returns the exact Task 5 script for that type, word-for-word
  - → every script is 25-75 words (10-30 s at ~150 wpm) and ends with the dismiss reminder sentence
- Modal constants and handlers called
  - → `TUTORIAL_MODAL_IDS` is `{ overlay: 'tutorial-modal-overlay', video: 'tutorialVideo', close: 'tutorialCloseBtn', continue: 'tutorialContinueBtn' }`
  - → `createTutorialModalHandlers({ onClose }).handleOverlayClick()` calls `onClose` once, and a missing `onClose` is a safe no-op
  - → `TUTORIAL_VIDEO_WIDTH` is `720` and `TUTORIAL_VIDEO_HEIGHT` is `1280`
- `src/modules/video/tutorial-logic.js` source inspected
  - → imports `getVideoUrl` from `./video-url.js` and imports nothing from `react`, `react-native`, `window`, or `document`
  - → contains no JSX

### Task 2 - Render-only TutorialModal takeover with X, portrait video, localized Continue

- Tutorial button pressed on any of the three decision rows
  - → `.tutorial-modal-overlay` becomes visible, covers the viewport (`position: fixed; inset: 0; z-index: 9999; background: rgba(0,0,0,0.8)`), and the overlay scrolls (`overflow-y: auto`) with a scrollable content card (`max-height: 90vh; overflow-y: auto`)
  - → underlying lesson video is paused via `pauseLessonVideoForTutorial()` on modal mount, exactly once (see Task 3: the mount effect is the single pause site)
  - → an unsupported step type mounts nothing and pauses nothing
  - → `#tutorialVideo` `src` equals `getTutorialVideoUrl(stepType)` for the calling step type
  - → `#tutorialVideo` has `controls`, `playsInline`, `preload="metadata"`, has no `autoplay` attribute, and does not play before the user presses play
  - → `#tutorialVideo` renders portrait (`aspect-ratio: 9/16`, `width: 100%`)
  - → `#tutorialCloseBtn` is positioned in the upper-right corner, contains `<i class="bi bi-x-lg">`, and is styled like `#closePage` (`src/assets/css/app.css:438-442`: white, `1.5rem`)
  - → `#tutorialContinueBtn` sits under the video, has `type="button"`, and shows the `continue` string bilingual for the session language (English line plus localized span when the language is not English, same pattern as `ChoiceColumn.jsx`)
- `#tutorialCloseBtn` clicked, `#tutorialContinueBtn` clicked, backdrop clicked (overlay edge, content stops propagation), or `Escape` pressed
  - → `onClose` fires and `.tutorial-modal-overlay` is removed
- `src/components/widgets/TutorialModal.jsx` source inspected (raw source, no comment stripping)
  - → contains `from '../../modules/video/tutorial-logic.js'` (or the correct relative path to it) and calls `getTutorialSlug(` or `buildTutorialModalView(`
  - → contains no `tutorial-` string literal (slug construction lives in the logic module)
  - → contains no `appStore.getState()` (store reads live in the buttons/container)
  - → signature destructures `{ stepType, onClose }`

### Task 3 - Wire stepType through all three tutorial buttons and pause the lesson

- `viewAndContinue` decision phase + `#tutorialBtn` pressed
  - → modal opens with `#tutorialVideo` src ending `assets/videos/tutorial-viewAndContinue.mp4`
- `branchChoices` phase + `#branchTutorialBtn` pressed
  - → modal opens with `#tutorialVideo` src ending `assets/videos/tutorial-branching.mp4`
- Simple-response decision phase for a `closedResponse` / `openResponse` / `friendClosedResponse` step + `#responseTutorialBtn` pressed
  - → modal opens with `#tutorialVideo` src ending `assets/videos/tutorial-<that-responseType>.mp4`
- Any tutorial button pressed while the lesson clip is playing
  - → lesson audio/video stops (the `getCurrentVideoPlayer().pause()` + `triggerPauseAllVideos()` effect ran)
- Tutorial button pressed when the resolved type is not in the supported set (e.g. stale `currentVideo` after a step change)
  - → modal does not open (`handleTutorial` checks `isTutorialStepType(resolved)` first and no-ops with a `console.warn` when unsupported, so `getTutorialSlug` returning `null` never reaches the video element)
- Wiring sources inspected (raw source)
  - → `ViewAndContinueButtons.jsx` contains the literal `'viewAndContinue'` in the `TutorialModal` invocation and opens through `createTutorialOpener(`
  - → `BranchChoiceButtons.jsx` contains the literal `'branching'` in the `TutorialModal` invocation and opens through `createTutorialOpener(`
  - → `ResponseDecisionButtons.jsx` passes `currentVideo?.responseType` to `TutorialModal` and opens through `createTutorialOpener(`
  - → none of the three rows mentions `pauseLessonVideoForTutorial` (the pause has a single call site, the modal's mount effect — a duplicated row-level call is what previously made both call sites unpinned)
  - → `lesson-progression.js` defines and exports `pauseLessonVideoForTutorial` calling both `getCurrentVideoPlayer` and `triggerPauseAllVideos`, and the close path does not resume the clip

### Task 4 - Localized tutorial subtitles resolved guest-first

- Session language resolution while the modal is open
  - → language comes from `useNativeLanguage()` (`guestNativeLanguage || userData?.native_language || 'en'`), so a guest who chose or silently adopted Spanish sees Spanish subtitles even with an English browser (`navigator.language`), and a logged-in profile language wins over an unset guest language
  - → `TutorialModal.jsx` contains no `navigator.language` / `navigator.languages` read (raw-source assertion)
- `getTutorialSubtitleText(stepType, lang)` called with a supported type
  - → returns the full script translated to `lang` for `es`, `pt`, and `fr`, the English script for `en`, and the English script for missing languages (`hi`, `bn`, unknown, empty, null, undefined) — the app's documented partial-localization fallback
  - → returns `null` for `lessonIntro`, `success`, unknown, empty, or non-string input
- `getTutorialSubtitleText('viewAndContinue', 'es')` / `'pt'` / `'fr'` called
  - → returns a string that differs from the English script and contains the localized Continue label word (`Continuar` for es/pt, `Continuer` for fr)
  - → result for `es` differs from the result for `pt` and from `fr`
- Any supported type + modal open with a non-English language
  - → a subtitle band is rendered over the video bottom using the existing `.ivp-subtitle-scroll-container` / `.ivp-subtitles` classes (same treatment as the lesson player), showing the localized script text
  - → subtitle element carries a `lang` attribute equal to the normalized session language (e.g. `lang="es"`)
- English session + modal open
  - → the subtitle band shows the English script (no duplicate localized line)
- `src/modules/video/tutorial-logic.js` source inspected
  - → defines `TUTORIAL_SCRIPTS` with `{ en, es, pt, fr }` entries for all five step types, and every entry's `en` value equals the Task 5 verbatim script

### Task 5 - Five spoken scripts and the placeholder-mp4 generator script

- Each `TUTORIAL_SCRIPTS` entry rendered as on-screen text in its placeholder mp4
  - → viewer can read the full English script below while the video plays; no audio track is required
  - → the same entry's `es` / `pt` / `fr` values are the exact subtitle strings rendered by the modal (verbatim below, one string each)
- `tutorial-viewAndContinue`:
  - → en: "You are watching a short scene that sets up what happens next. You do not need to speak on this step, so just watch and listen. When the video ends, press Continue to move on, Replay to watch again, or the book icon any time to rewatch this guide. Now press the X or Continue to close this window, and get to work."
  - → es: "Estás viendo una escena corta que presenta lo que viene ahora. En este paso no necesitas hablar: solo mira y escucha. Cuando termine el video, presiona Continuar para avanzar, Repetir para verlo otra vez, o el ícono del libro cuando quieras volver a ver esta guía. Ahora presiona la X o Continuar para cerrar esta ventana y ponerte a trabajar."
  - → pt: "Você está vendo uma cena curta que apresenta o que vem a seguir. Neste passo você não precisa falar: apenas assista e escute. Quando o vídeo terminar, pressione Continuar para avançar, Repetir para assistir de novo, ou o ícone do livro quando quiser rever este guia. Agora pressione o X ou Continuar para fechar esta janela e começar a praticar."
  - → fr: "Tu regardes une courte scène qui présente ce qui va suivre. À cette étape, tu n'as pas besoin de parler : regarde et écoute simplement. Quand la vidéo se termine, appuie sur Continuer pour avancer, sur Rejouer pour la revoir, ou sur l'icône du livre pour revoir ce guide à tout moment. Maintenant, appuie sur le X ou sur Continuer pour fermer cette fenêtre, et au travail."
- `tutorial-closedResponse`:
  - → en: "Now it is your turn to speak. You will hear one line. Press the microphone and repeat that line exactly, word for word. The app checks every word you say. If a word is wrong, you will see a hint card, so tap the microphone and try again until it matches. Now press the X or Continue to close this window, and get to work."
  - → es: "Ahora te toca hablar. Escucharás una frase. Presiona el micrófono y repite esa frase exactamente, palabra por palabra. La aplicación revisa cada palabra que dices. Si una palabra está mal, verás una tarjeta de ayuda; toca el micrófono e inténtalo otra vez hasta que coincida. Ahora presiona la X o Continuar para cerrar esta ventana y ponerte a trabajar."
  - → pt: "Agora é a sua vez de falar. Você ouvirá uma frase. Pressione o microfone e repita essa frase exatamente, palavra por palavra. O aplicativo verifica cada palavra que você diz. Se uma palavra estiver errada, você verá um cartão de dica; toque no microfone e tente novamente até acertar. Agora pressione o X ou Continuar para fechar esta janela e começar a praticar."
  - → fr: "Maintenant, c'est à toi de parler. Tu vas entendre une phrase. Appuie sur le micro et répète cette phrase exactement, mot pour mot. L'application vérifie chaque mot que tu dis. Si un mot est faux, tu verras une carte d'indice : appuie sur le micro et réessaie jusqu'à ce que ce soit juste. Maintenant, appuie sur le X ou sur Continuer pour fermer cette fenêtre, et au travail."
- `tutorial-openResponse`:
  - → en: "Now it is your turn to speak in your own words. You will hear a question or a line. Press the microphone and answer naturally. There is no single correct sentence, so any clear answer moves you forward. Speak for a few seconds, then stop. Now press the X or Continue to close this window, and get to work."
  - → es: "Ahora te toca hablar con tus propias palabras. Escucharás una pregunta o una frase. Presiona el micrófono y responde de forma natural. No hay una sola frase correcta, así que cualquier respuesta clara te hace avanzar. Habla durante unos segundos y luego detente. Ahora presiona la X o Continuar para cerrar esta ventana y ponerte a trabajar."
  - → pt: "Agora é a sua vez de falar com suas próprias palavras. Você ouvirá uma pergunta ou uma frase. Pressione o microfone e responda naturalmente. Não existe uma única frase correta, então qualquer resposta clara faz você avançar. Fale por alguns segundos e depois pare. Agora pressione o X ou Continuar para fechar esta janela e começar a praticar."
  - → fr: "Maintenant, c'est à toi de parler avec tes propres mots. Tu vas entendre une question ou une phrase. Appuie sur le micro et réponds naturellement. Il n'y a pas une seule phrase correcte : toute réponse claire te fait avancer. Parle quelques secondes, puis arrête-toi. Maintenant, appuie sur le X ou sur Continuer pour fermer cette fenêtre, et au travail."
- `tutorial-friendClosedResponse`:
  - → en: "Your friend recorded a question just for you, so you will watch their video first. Then press the microphone and repeat their line exactly, word for word. Get it right and you jump straight to the next question. Miss a word and you will see a hint, so just try again. Now press the X or Continue to close this window, and get to work."
  - → es: "Tu amigo grabó una pregunta especialmente para ti, así que primero verás su video. Luego presiona el micrófono y repite su frase exactamente, palabra por palabra. Si lo haces bien, pasarás directamente a la siguiente pregunta. Si te falta una palabra, verás una ayuda; solo inténtalo otra vez. Ahora presiona la X o Continuar para cerrar esta ventana y ponerte a trabajar."
  - → pt: "Seu amigo gravou uma pergunta especialmente para você, então primeiro você verá o vídeo dele. Depois pressione o microfone e repita a frase dele exatamente, palavra por palavra. Se acertar, você passa direto para a próxima pergunta. Se errar uma palavra, você verá uma dica; basta tentar novamente. Agora pressione o X ou Continuar para fechar esta janela e começar a praticar."
  - → fr: "Ton ami a enregistré une question rien que pour toi : tu regarderas d'abord sa vidéo. Ensuite, appuie sur le micro et répète sa phrase exactement, mot pour mot. Si c'est juste, tu passes directement à la question suivante. Si un mot manque, tu verras un indice : réessaie simplement. Maintenant, appuie sur le X ou sur Continuer pour fermer cette fenêtre, et au travail."
- `tutorial-branching`:
  - → en: "This step gives you a choice. Watch the video, then tap one of the text buttons to decide what happens next, because each button jumps to a different step. Replay plays the scene again, and the book icon replays this guide. Now press the X or Continue to close this window, and get to work."
  - → es: "Este paso te da una opción. Mira el video y luego toca uno de los botones de texto para decidir qué pasa después, porque cada botón salta a un paso distinto. Repetir vuelve a mostrar la escena, y el ícono del libro repite esta guía. Ahora presiona la X o Continuar para cerrar esta ventana y ponerte a trabajar."
  - → pt: "Este passo te dá uma escolha. Assista ao vídeo e depois toque em um dos botões de texto para decidir o que vem a seguir, porque cada botão leva a um passo diferente. Repetir mostra a cena novamente, e o ícone do livro repite este guia. Agora pressione o X ou Continuar para fechar esta janela e começar a praticar."
  - → fr: "Cette étape te laisse un choix. Regarde la vidéo, puis appuie sur l'un des boutons de texte pour décider de la suite, car chaque bouton mène à une étape différente. Rejouer rejoue la scène, et l'icône du livre rejoue ce guide. Maintenant, appuie sur le X ou sur Continuer pour fermer cette fenêtre, et au travail."
- `scripts/generate-tutorial-placeholders.mjs` executed per its `--help` output
  - → writes exactly 5 mp4s (`tutorial-viewAndContinue.mp4`, `tutorial-closedResponse.mp4`, `tutorial-openResponse.mp4`, `tutorial-friendClosedResponse.mp4`, `tutorial-branching.mp4`) to a directory outside the repo (default OS temp dir)
  - → each mp4 probes as ISO-BMFF (`ftyp` at offset 4), decodes to `720x1280`, and has container duration 10-30 s
  - → each mp4 shows its script as white wrapped text on `#1a3a5a` for the full duration with no audio track
  - → script imports nothing not already in `package.json` (`@playwright/test`, `mediabunny` optional for probing only) and guards `main()` behind the `import.meta.url === pathToFileURL(process.argv[1]).href` check per the repo script convention
  - → `--help` prints the five `wrangler r2 object put uff/assets/videos/<slug>.mp4 --file <staged> --content-type video/mp4` upload commands
- Generator source inspected (raw source)
  - → contains `720`, `1280`, `tutorial-`, `captureStream`, `MediaRecorder`, and `channel: 'chrome'`
  - → contains no `import` of a package absent from `package.json` dependencies/devDependencies

### Task 6 - Automated coverage for modal, wiring, and generator

- `npx vitest run src/modules/video/tutorial-logic.test.js src/components/widgets/TutorialModal.test.jsx` executed
  - → all tests pass, covering every Task 1 mapping/naming/word-count AC, every Task 4 subtitle AC (es/pt/fr distinct translated scripts, English fallback for hi/bn/unknown, `null` for unsupported types), and every Task 2 render/dismiss/localization AC (including Spanish `CONTINUAR` Continue rendering, `lang="es"` subtitle rendering with the Spanish script, and no-autoplay assertion)
- `npx vitest run` executed for the touched button suites
  - → `BranchChoiceButtons.test.jsx` passes with a case asserting the modal video src ends with `tutorial-branching.mp4`; equivalent cases cover `tutorial-viewAndContinue.mp4` and `tutorial-<responseType>.mp4`
- New or extended Playwright spec (`tests/tutorial-modal.spec.js`, or the existing `tests/simple-response-overlay.spec.js` tutorial block) executed on real Chrome (`npx playwright install chrome` prerequisite documented in the spec header)
  - → tutorial button opens the overlay, `#tutorialVideo` src ends with the step-type slug, X and Continue both dismiss, backdrop click dismisses, `Escape` dismisses
  - → no cited spec is in `playwright.config.js` `testIgnore` (the four ignored specs are never cited as passing ACs)
- Static guards added beside the feature (e.g. `src/modules/video/tutorial-wiring.test.js`)
  - → assert every Task 2/Task 3 "source inspected" AC on raw source (never comment-stripped), with per-form negative assertions anchored so each can fail independently (e.g. X-button assertion matches its own `#tutorialCloseBtn` block, not any `bi-x-lg` in the file)
  - → assert the single pause site (modal calls it; no row references it) and that the component's literal ids equal every `TUTORIAL_MODAL_IDS` value, so neither can drift silently
  - → guard is proven to fail by temporarily injecting the forbidden token (e.g. a `tutorial-` literal in `TutorialModal.jsx`, or a row-level pause call) before merging
- The pause/close test doubles pin exact counts, not "at least once": the modal's mount test asserts exactly one pause, and no test would stay green if a second call site were re-added

## Technical Context

- React `19.2.0`, `react-dom` `19.2.0`, `zustand` `5.0.13` (store + `useStore`/`useNativeLanguage` pattern), `react-router-dom` `7.15.1` (existing `#closePage` link in `LessonContainer.jsx:174`).
- `mediabunny` `^1.50.8` (available for mp4 probing only; browser `VideoEncoder` is absent in Node so encoding runs in real Chrome via native `MediaRecorder`, no new encoder dependency).
- `@playwright/test` `^1.60.0` (placeholder harness driver; run with real Chrome per the H.264 rule — bundled Chromium cannot validate tutorial playback).
- `wrangler` `^3.114.17` (manual `r2 object put` upload of the five staged mp4s to the public `uff` bucket under `assets/videos/`; dev serves them through the existing `/assets/videos/` proxy).
- No new npm dependencies. `ffmpeg` is not installed and not required. `sharp` is present only transitively (not in `package.json`) and must not be imported.
- Tutorial slugs: `tutorial-viewAndContinue`, `tutorial-closedResponse`, `tutorial-openResponse`, `tutorial-friendClosedResponse`, `tutorial-branching` (R2 keys `assets/videos/<slug>.mp4`, resolved through the unchanged `getVideoUrl`/`getPosterUrl` rule; no poster `.jpg` is produced for tutorials).
- Existing strings reused: `continue` (`CONTINUE`/`CONTINUAR`/`CONTINUAR`/`CONTINUER`/plus hi/bn at `src/data/strings.js:2083-2090`) and `watch_tutorial` for the buttons (unchanged). No new UI-copy keys are required unless the implementer needs an accessible close label, in which case the existing bilingual pattern applies.

## Notes

- Manual R2 upload (operator step, not automated): after generating, run for each slug `npx wrangler r2 object put uff/assets/videos/<slug>.mp4 --file <staged-dir>/<slug>.mp4 --content-type video/mp4`, then verify with a ranged GET (`curl -H "Range: bytes=0-1023"` must return `206` with `Access-Control-Allow-Origin: *` per `docs/cloudflare-video-cors.md`) and a real-Chrome playback check. New slugs are cache-cold so the 4-hour CDN cache is not a concern.
- No posters are committed or uploaded for tutorials; the modal video element uses `preload="metadata"` and shows its first frame once data loads.
- UX: overlay `overflow-y: auto` with content `max-height: 90vh; overflow-y: auto` so the modal takes over the screen yet scrolls on small phones where backdrop taps are impractical; X and Continue are both always reachable (X pinned upper-right of the card, Continue pinned under the video); `Escape` handling follows the `HomeScreen.jsx:50-55` `window.addEventListener('keydown')` pattern with cleanup.
- Accessibility: `#tutorialCloseBtn` carries `aria-label="Close"`, `#tutorialVideo` carries `aria-label` naming the step type, Continue is a real `type="button"`, and the subtitle band carries `lang` set to the normalized session language (raw-source assertion: no `navigator.language` read in `TutorialModal.jsx`; the hook is the single language source).
- Subtitles are single-language (the session language, English fallback) rather than bilingual-stacked, matching the request "subtitles in the user's language"; lesson cue labels keep their existing bilingual stacking. The placeholder video carries the English script burnt in, so an English session sees the text twice (burnt + subtitle band) — acceptable for placeholders, and the redundant burn disappears when the narrated videos replace them. `hi`/`bn` fall back to English for the tutorial scripts, consistent with the documented partial-localization limitation; the translatable text lives in `tutorial-logic.js`, not `src/data/strings.js` (UI copy only).
- The subtitle band shows while the modal is open, before playback starts, so a learner who cannot press play can still read the instructions.
- Console discipline per repo rules: modal mount/unmount and generator progress log success paths; R2 upload failures print the exact failing slug and command without failing the generation of the other four.
