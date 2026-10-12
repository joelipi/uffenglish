// src/modules/video/tutorial-logic.js
// Pure rules for the per-step-type tutorial modal. No React, no React Native,
// no DOM, no store: the supported step types, slug/URL construction, the
// localized tutorial scripts and subtitles, and the modal's dismiss/portrait
// policy all live here so the presentational component and the three decision
// rows stay free of domain decisions.
//
// Tutorial videos are lessons' teacher media siblings: they resolve through the
// shared getVideoUrl (see video-url.js), so a dev build serves
// /assets/videos/<slug>.mp4 through the Vite R2 proxy and a production build
// serves https://r2.ultrafastfluency.com/assets/videos/<slug>.mp4.

import { getVideoUrl } from './video-url.js';

// The five step types that render a tutorial button. lessonIntro and success
// screens have no tutorial button, so they deliberately get no script/URL.
export const TUTORIAL_STEP_TYPES = [
    'viewAndContinue',
    'closedResponse',
    'openResponse',
    'friendClosedResponse',
    'branching',
];

// Every tutorial slug carries the `tutorial-` prefix so a lesson content slug
// (e.g. `do_you_have_rolls_too`) can never collide with a tutorial slug.
const TUTORIAL_SLUG_PREFIX = 'tutorial-';

// Portrait 9:16, half of the 1080×1920 recap composite so R2 playback is fast.
export const TUTORIAL_VIDEO_WIDTH = 720;
export const TUTORIAL_VIDEO_HEIGHT = 1280;

// Element ids shared by the modal, the tests and the static guards. Keeping
// them here means the component and the guard cannot drift.
export const TUTORIAL_MODAL_IDS = {
    overlay: 'tutorial-modal-overlay',
    video: 'tutorialVideo',
    close: 'tutorialCloseBtn',
    continue: 'tutorialContinueBtn',
};

export function shouldCloseOnBackdropClick() {
    return true;
}

export function shouldCloseOnEscape() {
    return true;
}

export function isTutorialStepType(stepType) {
    return typeof stepType === 'string' && TUTORIAL_STEP_TYPES.includes(stepType);
}

export function getTutorialSlug(stepType) {
    return isTutorialStepType(stepType) ? `${TUTORIAL_SLUG_PREFIX}${stepType}` : null;
}

export function getTutorialVideoUrl(stepType) {
    const slug = getTutorialSlug(stepType);
    return slug ? getVideoUrl(slug) : '';
}

// The spoken tutorial script (what a narrator says and what the placeholder
// video burns on screen) in the four translated UI languages. hi/bn fall back
// to English via getTutorialSubtitleLang/getTutorialSubtitleText, matching the
// app's documented partial localization of non-en/es/pt/fr languages.
export const TUTORIAL_SCRIPTS = {
    viewAndContinue: {
        en: 'You are watching a short scene that sets up what happens next. You do not need to speak on this step, so just watch and listen. When the video ends, press Continue to move on, Replay to watch again, or the book icon any time to rewatch this guide. Now press the X or Continue to close this window, and get to work.',
        es: 'Estás viendo una escena corta que presenta lo que viene ahora. En este paso no necesitas hablar: solo mira y escucha. Cuando termine el video, presiona Continuar para avanzar, Repetir para verlo otra vez, o el ícono del libro cuando quieras volver a ver esta guía. Ahora presiona la X o Continuar para cerrar esta ventana y ponerte a trabajar.',
        pt: 'Você está vendo uma cena curta que apresenta o que vem a seguir. Neste passo você não precisa falar: apenas assista e escute. Quando o vídeo terminar, pressione Continuar para avançar, Repetir para assistir de novo, ou o ícone do livro quando quiser rever este guia. Agora pressione o X ou Continuar para fechar esta janela e começar a praticar.',
        fr: 'Tu regardes une courte scène qui présente ce qui va suivre. À cette étape, tu n\'as pas besoin de parler : regarde et écoute simplement. Quand la vidéo se termine, appuie sur Continuer pour avancer, sur Rejouer pour la revoir, ou sur l\'icône du livre pour revoir ce guide à tout moment. Maintenant, appuie sur le X ou sur Continuer pour fermer cette fenêtre, et au travail.',
    },
    closedResponse: {
        en: 'Now it is your turn to speak. You will hear one line. Press the microphone and repeat that line exactly, word for word. The app checks every word you say. If a word is wrong, you will see a hint card, so tap the microphone and try again until it matches. Now press the X or Continue to close this window, and get to work.',
        es: 'Ahora te toca hablar. Escucharás una frase. Presiona el micrófono y repite esa frase exactamente, palabra por palabra. La aplicación revisa cada palabra que dices. Si una palabra está mal, verás una tarjeta de ayuda; toca el micrófono e inténtalo otra vez hasta que coincida. Ahora presiona la X o Continuar para cerrar esta ventana y ponerte a trabajar.',
        pt: 'Agora é a sua vez de falar. Você ouvirá uma frase. Pressione o microfone e repita essa frase exatamente, palavra por palavra. O aplicativo verifica cada palavra que você diz. Se uma palavra estiver errada, você verá um cartão de dica; toque no microfone e tente novamente até acertar. Agora pressione o X ou Continuar para fechar esta janela e começar a praticar.',
        fr: 'Maintenant, c\'est à toi de parler. Tu vas entendre une phrase. Appuie sur le micro et répète cette phrase exactement, mot pour mot. L\'application vérifie chaque mot que tu dis. Si un mot est faux, tu verras une carte d\'indice : appuie sur le micro et réessaie jusqu\'à ce que ce soit juste. Maintenant, appuie sur le X ou sur Continuer pour fermer cette fenêtre, et au travail.',
    },
    openResponse: {
        en: 'Now it is your turn to speak in your own words. You will hear a question or a line. Press the microphone and answer naturally. There is no single correct sentence, so any clear answer moves you forward. Speak for a few seconds, then stop. Now press the X or Continue to close this window, and get to work.',
        es: 'Ahora te toca hablar con tus propias palabras. Escucharás una pregunta o una frase. Presiona el micrófono y responde de forma natural. No hay una sola frase correcta, así que cualquier respuesta clara te hace avanzar. Habla durante unos segundos y luego detente. Ahora presiona la X o Continuar para cerrar esta ventana y ponerte a trabajar.',
        pt: 'Agora é a sua vez de falar com suas próprias palavras. Você ouvirá uma pergunta ou uma frase. Pressione o microfone e responda naturalmente. Não existe uma única frase correta, então qualquer resposta clara faz você avançar. Fale por alguns segundos e depois pare. Agora pressione o X ou Continuar para fechar esta janela e começar a praticar.',
        fr: 'Maintenant, c\'est à toi de parler avec tes propres mots. Tu vas entendre une question ou une phrase. Appuie sur le micro et réponds naturellement. Il n\'y a pas une seule phrase correcte : toute réponse claire te fait avancer. Parle quelques secondes, puis arrête-toi. Maintenant, appuie sur le X ou sur Continuer pour fermer cette fenêtre, et au travail.',
    },
    friendClosedResponse: {
        en: 'Your friend recorded a question just for you, so you will watch their video first. Then press the microphone and repeat their line exactly, word for word. Get it right and you jump straight to the next question. Miss a word and you will see a hint, so just try again. Now press the X or Continue to close this window, and get to work.',
        es: 'Tu amigo grabó una pregunta especialmente para ti, así que primero verás su video. Luego presiona el micrófono y repite su frase exactamente, palabra por palabra. Si lo haces bien, pasarás directamente a la siguiente pregunta. Si te falta una palabra, verás una ayuda; solo inténtalo otra vez. Ahora presiona la X o Continuar para cerrar esta ventana y ponerte a trabajar.',
        pt: 'Seu amigo gravou uma pergunta especialmente para você, então primeiro você verá o vídeo dele. Depois pressione o microfone e repita a frase dele exatamente, palavra por palavra. Se acertar, você passa direto para a próxima pergunta. Se errar uma palavra, você verá uma dica; basta tentar novamente. Agora pressione o X ou Continuar para fechar esta janela e começar a praticar.',
        fr: 'Ton ami a enregistré une question rien que pour toi : tu regarderas d\'abord sa vidéo. Ensuite, appuie sur le micro et répète sa phrase exactement, mot pour mot. Si c\'est juste, tu passes directement à la question suivante. Si un mot manque, tu verras un indice : réessaie simplement. Maintenant, appuie sur le X ou sur Continuer pour fermer cette fenêtre, et au travail.',
    },
    branching: {
        en: 'This step gives you a choice. Watch the video, then tap one of the text buttons to decide what happens next, because each button jumps to a different step. Replay plays the scene again, and the book icon replays this guide. Now press the X or Continue to close this window, and get to work.',
        es: 'Este paso te da una opción. Mira el video y luego toca uno de los botones de texto para decidir qué pasa después, porque cada botón salta a un paso distinto. Repetir vuelve a mostrar la escena, y el ícono del libro repite esta guía. Ahora presiona la X o Continuar para cerrar esta ventana y ponerte a trabajar.',
        pt: 'Este passo te dá uma escolha. Assista ao vídeo e depois toque em um dos botões de texto para decidir o que vem a seguir, porque cada botão leva a um passo diferente. Repetir mostra a cena novamente, e o ícone do livro repite este guia. Agora pressione o X ou Continuar para fechar esta janela e começar a praticar.',
        fr: 'Cette étape te laisse un choix. Regarde la vidéo, puis appuie sur l\'un des boutons de texte pour décider de la suite, car chaque bouton mène à une étape différente. Rejouer rejoue la scène, et l\'icône du livre rejoue ce guide. Maintenant, appuie sur le X ou sur Continuer pour fermer cette fenêtre, et au travail.',
    },
};

export function getTutorialScript(stepType) {
    if (!isTutorialStepType(stepType)) return null;
    return TUTORIAL_SCRIPTS[stepType].en;
}

// The BCP-47-ish language tag stamped on the subtitle element. A missing
// translation renders the English script but still labels the band with the
// requested language, so assistive tech reads the right pronunciation rules
// even when the text fell back to English.
//
// `OTHER` is the guest modal's "my language is not listed — continue without
// translations" sentinel (GuestLoginModal treats it specially), so it resolves
// to English rather than being emitted as a bogus `lang="other"`.
export function getTutorialSubtitleLang(lang) {
    if (typeof lang !== 'string' || !lang) return 'en';
    const normalized = lang.split('-')[0].toLowerCase();
    if (!normalized || normalized === 'other') return 'en';
    return normalized;
}

// The subtitle text: the script translated for the session language, falling
// back to English for en and for any language we do not translate (hi, bn,
// anything unknown). Returns null for unsupported step types so the caller
// renders no band at all.
export function getTutorialSubtitleText(stepType, lang) {
    const script = TUTORIAL_SCRIPTS?.[stepType];
    if (!script) return null;
    const normalized = typeof lang === 'string' && lang ? getTutorialSubtitleLang(lang) : 'en';
    return script[normalized] || script.en;
}

/**
 * Builds the tutorial button's open handler, so no component decides whether a
 * step type is supported. An unsupported resolved type (e.g. a stale
 * `currentVideo` after a step change) logs a warning and opens nothing, so a
 * `getTutorialSlug` `null` can never reach the video element.
 *
 * @returns {() => boolean} true when the modal was opened
 */
export function createTutorialOpener({ stepType, onOpen } = {}) {
    return () => {
        if (!isTutorialStepType(stepType)) {
            console.warn(`[Tutorial] unsupported step type "${String(stepType)}" — tutorial modal not opened`);
            return false;
        }
        if (typeof onOpen === 'function') onOpen();
        return true;
    };
}

/**
 * Close/backdrop/Escape policy as a handler factory, so the component attaches
 * handlers without deciding any policy itself. `handleOverlayClick` closes only
 * when the backdrop policy says a backdrop tap closes; the content element stops
 * propagation so its own taps never reach the overlay. Escape-driven close is
 * requested through `closesOnEscape`.
 */
export function createTutorialModalHandlers({ onClose, closesOnBackdropClick, closesOnEscape } = {}) {
    const close = () => {
        if (typeof onClose === 'function') onClose();
    };

    return {
        close,
        closesOnEscape: !!closesOnEscape,
        handleOverlayClick: () => {
            if (closesOnBackdropClick) close();
        },
    };
}

export function buildTutorialModalView({ stepType, lang } = {}) {
    if (!isTutorialStepType(stepType)) {
        return {
            isSupported: false,
            ids: TUTORIAL_MODAL_IDS,
            videoUrl: '',
            stepType: null,
            script: null,
            subtitleText: null,
            subtitleLang: getTutorialSubtitleLang(lang),
            closesOnBackdropClick: shouldCloseOnBackdropClick(),
            closesOnEscape: shouldCloseOnEscape(),
        };
    }

    const script = getTutorialScript(stepType);

    return {
        isSupported: true,
        ids: TUTORIAL_MODAL_IDS,
        videoUrl: getTutorialVideoUrl(stepType),
        stepType,
        script,
        subtitleText: getTutorialSubtitleText(stepType, lang),
        subtitleLang: getTutorialSubtitleLang(lang),
        closesOnBackdropClick: shouldCloseOnBackdropClick(),
        closesOnEscape: shouldCloseOnEscape(),
    };
}
