// src/modules/video/tutorial-logic.js
// Pure rules for the tutorial modal. No React, no React Native, no DOM, no
// store: the supported tutorial topics, slug/URL construction, the localized
// tutorial scripts and subtitles, and the modal's dismiss/portrait policy all
// live here so the presentational component and the decision rows stay free of
// domain decisions.
//
// A TOPIC is what a guide is about. It is usually a step type, but the
// friendClosedResponse step has two screens that need different guides: its
// decision screen and its recording-preview screen (see
// FRIEND_RECORDING_PREVIEW_TOPIC). Keeping topics separate from step types is
// what lets one step render two different tutorial videos.
//
// Tutorial videos are lessons' teacher media siblings: they resolve through the
// shared getVideoUrl (see video-url.js), so a dev build serves
// /assets/videos/<slug>.mp4 through the Vite R2 proxy and a production build
// serves https://r2.ultrafastfluency.com/assets/videos/<slug>.mp4.

import { getVideoUrl } from './video-url.js';

// The recording-preview screen of a friendClosedResponse step, whose guide is
// its own topic because that screen shows filters, overlays and the phrase —
// not the repeat-exactly decision screen the step-type guide explains.
export const FRIEND_RECORDING_PREVIEW_TOPIC = 'friendRecordingPreview';

// The five step types that render a tutorial button, plus the preview screen's
// own topic. lessonIntro and success screens have no tutorial button, so they
// deliberately get no script/URL.
export const TUTORIAL_TOPICS = [
    'viewAndContinue',
    'closedResponse',
    'openResponse',
    'friendClosedResponse',
    FRIEND_RECORDING_PREVIEW_TOPIC,
    'branching',
];

// Every tutorial slug carries the `tutorial-` prefix so a lesson content slug
// (e.g. `do_you_have_rolls_too`) can never collide with a tutorial slug.
const TUTORIAL_SLUG_PREFIX = 'tutorial-';

// Portrait 9:16, half of the 1080×1920 recap composite so R2 playback is fast.
export const TUTORIAL_VIDEO_WIDTH = 720;
export const TUTORIAL_VIDEO_HEIGHT = 1280;

// Element ids the modal renders. They are written as literals in
// TutorialModal.jsx (so a static guard can slice the exact button tag), and
// tutorial-wiring.test.js asserts the literals match this map — changing an id
// here without changing the component fails the guard.
export const TUTORIAL_MODAL_IDS = {
    overlay: 'tutorial-modal-overlay',
    video: 'tutorialVideo',
    close: 'tutorialCloseBtn',
    continue: 'tutorialContinueBtn',
};

export function isTutorialTopic(topic) {
    return typeof topic === 'string' && TUTORIAL_TOPICS.includes(topic);
}

export function getTutorialSlug(topic) {
    return isTutorialTopic(topic) ? `${TUTORIAL_SLUG_PREFIX}${topic}` : null;
}

export function getTutorialVideoUrl(topic) {
    const slug = getTutorialSlug(topic);
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
    friendRecordingPreview: {
        en: 'This is your recording screen. Your words are at the bottom. Tap Filter, Lens, or Screen on the left to change the frame, and Top, Face, Bottom, or Emoji to add stickers. Drag a sticker to move it, and use Size to resize it. When you are ready, tap the microphone to start recording, and tap it again to stop. Now press the X or Continue to close this window, and get to work.',
        es: 'Esta es tu pantalla de grabación. Tus palabras aparecen abajo. Toca Filter, Lens o Screen a la izquierda para cambiar el marco, y Top, Face, Bottom o Emoji para añadir pegatinas. Arrastra una pegatina para moverla y usa Size para cambiar su tamaño. Cuando estés listo, toca el micrófono para empezar a grabar y tócalo otra vez para parar. Ahora presiona la X o Continuar para cerrar esta ventana y ponerte a trabajar.',
        pt: 'Esta é a sua tela de gravação. Suas palavras aparecem embaixo. Toque em Filter, Lens ou Screen à esquerda para mudar o quadro, e em Top, Face, Bottom ou Emoji para adicionar adesivos. Arraste um adesivo para movê-lo e use Size para redimensioná-lo. Quando estiver pronto, toque no microfone para começar a gravar e toque nele de novo para parar. Agora pressione o X ou Continuar para fechar esta janela e começar a praticar.',
        fr: 'C\'est ton écran d\'enregistrement. Tes mots s\'affichent en bas. Appuie sur Filter, Lens ou Screen à gauche pour changer le cadre, et sur Top, Face, Bottom ou Emoji pour ajouter des autocollants. Fais glisser un autocollant pour le déplacer et utilise Size pour le redimensionner. Quand tu es prêt, appuie sur le micro pour commencer à enregistrer et appuie à nouveau pour arrêter. Maintenant, appuie sur le X ou sur Continuer pour fermer cette fenêtre, et au travail.',
    },
    branching: {
        en: 'This step gives you a choice. Watch the video, then tap one of the text buttons to decide what happens next, because each button jumps to a different step. Replay plays the scene again, and the book icon replays this guide. Now press the X or Continue to close this window, and get to work.',
        es: 'Este paso te da una opción. Mira el video y luego toca uno de los botones de texto para decidir qué pasa después, porque cada botón salta a un paso distinto. Repetir vuelve a mostrar la escena, y el ícono del libro repite esta guía. Ahora presiona la X o Continuar para cerrar esta ventana y ponerte a trabajar.',
        pt: 'Este passo te dá uma escolha. Assista ao vídeo e depois toque em um dos botões de texto para decidir o que vem a seguir, porque cada botão leva a um passo diferente. Repetir mostra a cena novamente, e o ícone do livro repite este guia. Agora pressione o X ou Continuar para fechar esta janela e começar a praticar.',
        fr: 'Cette étape te laisse un choix. Regarde la vidéo, puis appuie sur l\'un des boutons de texte pour décider de la suite, car chaque bouton mène à une étape différente. Rejouer rejoue la scène, et l\'icône du livre rejoue ce guide. Maintenant, appuie sur le X ou sur Continuer pour fermer cette fenêtre, et au travail.',
    },
};

export function getTutorialScript(topic) {
    if (!isTutorialTopic(topic)) return null;
    return TUTORIAL_SCRIPTS[topic].en;
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
export function getTutorialSubtitleText(topic, lang) {
    if (!isTutorialTopic(topic)) return null;
    const normalized = typeof lang === 'string' && lang ? getTutorialSubtitleLang(lang) : 'en';
    // English is also the fallback for every untranslated language.
    return TUTORIAL_SCRIPTS[topic][normalized] || getTutorialScript(topic);
}

/**
 * Builds the tutorial button's open handler, so no component decides whether a
 * topic is supported. An unsupported resolved topic (e.g. a stale
 * `currentVideo` after a step change) logs a warning and opens nothing, so a
 * `getTutorialSlug` `null` can never reach the video element.
 *
 * @returns {() => boolean} true when the modal was opened
 */
export function createTutorialOpener({ topic, onOpen } = {}) {
    return () => {
        if (!isTutorialTopic(topic)) {
            console.warn(`[Tutorial] unsupported topic "${String(topic)}" — tutorial modal not opened`);
            return false;
        }
        if (typeof onOpen === 'function') onOpen();
        return true;
    };
}

/**
 * Close/backdrop policy as a handler factory, so the component attaches
 * handlers without deciding any policy itself. A backdrop tap always closes;
 * the content element stops propagation so its own taps never reach the
 * overlay. Escape closes too, and is handled by the component's keydown effect.
 */
export function createTutorialModalHandlers({ onClose } = {}) {
    const close = () => {
        if (typeof onClose === 'function') onClose();
    };

    return {
        close,
        handleOverlayClick: close,
    };
}

export function buildTutorialModalView({ topic, lang } = {}) {
    if (!isTutorialTopic(topic)) {
        return {
            isSupported: false,
            topic: null,
            videoUrl: '',
            subtitleText: null,
            subtitleLang: getTutorialSubtitleLang(lang),
        };
    }

    return {
        isSupported: true,
        topic,
        videoUrl: getTutorialVideoUrl(topic),
        subtitleText: getTutorialSubtitleText(topic, lang),
        subtitleLang: getTutorialSubtitleLang(lang),
    };
}
