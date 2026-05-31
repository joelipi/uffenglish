// strings.js - Centralized UI strings for the UFF application

const strings = {

    'stats_header': {
        en: "SPEECH ANALYTICS",
        es: "ANÁLISIS DE VOZ"
    },
    'stats_speech_flow_header': {
        en: "SPEECH FLOW:",
        es: "FLUIDEZ DE VOZ:"
    },
    'stats_vocabulary_header': {
        en: "VOCABULARY:",
        es: "VOCABULARIO:"
    },
    'stats_grammar_header': {
        en: "GRAMMAR:",
        es: "GRAMÁTICA:"
    },
    'stats_pragmatics_header': {
        en: "UNDERSTANDING:",
        es: "COMPRENSIÓN:"
    },
    'stats_formality_header': {
        en: "FORMALITY:",
        es: "FORMALIDAD:"
    },
    'stats_native_like_header': {
        en: "NATIVE-LIKE:",
        es: "NATURALIDAD:"
    },
    'stats_listening_header': {
        en: "LISTENING SCORE: {score}%",
        es: "PUNTUACIÓN DE ESCUCHA: {score}%"
    },
    'stats_speaking_header': {
        en: "SPEAKING SCORE: {score}%",
        es: "PUNTUACIÓN DE HABLA: {score}%"
    },
    'stats_hesitation': {
        en: "Hesitation at start",
        es: "Duda al inicio"
    },
    'stats_pauses_speaking': {
        en: "Pauses during speaking",
        es: "Pausas al hablar"
    },
    'stats_idioms': {
        en: "Number of idioms",
        es: "Número de modismos"
    },
    'stats_wpm': {
        en: "Words per minute",
        es: "Palabras por minuto"
    },
    'stats_pauses': {
        en: "Pauses",
        es: "Pausas"
    },
    'stats_complexity': {
        en: "Complexity Score",
        es: "Puntuación de complejidad"
    },
    'feedback_slow': {
        en: "You spoke somewhat slowly. Try to speak a bit faster next time.",
        es: "Hablaste algo lento. Intenta hablar un poco más rápido la próxima vez."
    },
    'feedback_good': {
        en: "Good pace!",
        es: "¡Buen ritmo!"
    },
    'feedback_fast': {
        en: "You spoke very fast!",
        es: "¡Hablaste muy rápido!"
    },
    'feedback_brief_penalty': {
        en: "Try giving a longer response next time to score higher.",
        es: "Intenta dar una respuesta más larga la próxima vez para obtener una mejor puntuación."
    },
    'try_again_speech': {
        en: "TRY AGAIN. Speech not detected.",
        es: "VUELVE A INTENTAR. Voz no detectada.",
        fr: "ESSAYEZ À NOUVEAU. Parole non détectée."
    },
    'already_used': {
        en: "You already gave that response. In order to evaluate and develop your fluency, we don't allow you to re-use responses during a lesson or test.",
        es: "Ya diste esa respuesta. Para desarrollar y evaluar tu fluidez, no permitimos que vuelvas a utilizar respuestas durante una lección o test.",
        fr: "Vous avez déjà donné cette réponse. Afin d'évaluer et de développer votre fluidité, nous n'autorisons pas la réutilisation des réponses pendant une leçon ou un test."
    },
    'no_repetition': {
        en: "In order to build and evaluate your fluency, we do not accept a response that is a simple repetition of the video, even if it would be a good reply.",
        es: "Con el fin de evaluar y desarrollar tu fluidez, no aceptamos una respuesta si es una simple repetición del video, aún si sería una buena respuesta.",
        fr: "Afin de construire et d'évaluer votre fluidité, nous n'acceptons pas une réponse qui est une simple répétition de la vidéo, même si ce serait une bonne réponse."
    },
    'min_words_3': {
        en: "Your response must be at least three words long.",
        es: "Tu respuesta debe tener al menos tres palabras.",
        fr: "Votre réponse doit contenir au moins trois mots."
    },
    'min_words_4': {
        en: "Your response must be at least four words long.",
        es: "Tu respuesta debe tener al menos cuatro palabras.",
        fr: "Votre réponse doit contenir au moins quatre mots."
    },
    'min_words_5': {
        en: "Your response must be at least five words long.",
        es: "Tu respuesta debe tener al menos cinco palabras.",
        fr: "Votre réponse doit contenir au moins cinq mots."
    },
    'min_words_6': {
        en: "Your response must be at least six words long.",
        es: "Tu respuesta debe tener al menos seis palabras.",
        fr: "Votre réponse doit contenir au moins six mots."
    },
    'censored': {
        en: "Your response was rejected because it contains censored words. Remember: if someone uses harsh language, effective communicators de-escalate rather than respond in kind.",
        es: "Tu respuesta fue rechazada porque contiene palabras censuradas. Recuerda: si alguien usa lenguaje fuerte, los comunicadores efectivos desescalan en lugar de responder de la misma manera.",
        fr: "Votre réponse a été rejetée car elle contient des mots censurés. Rappelez-vous : si quelqu'un utilise un langage dur, les communicateurs efficaces désamorcent plutôt que de répondre de la même manière."
    },
    'inappropriate': {
        en: "Your response was rejected because inappropriate language was detected. Remember: if someone uses harsh language, effective communicators de-escalate rather than respond in kind.",
        es: "Tu respuesta fue rechazada porque se detectó lenguaje inapropiado. Recuerda: si alguien usa lenguaje fuerte, los comunicadores efectivos desescalan en lugar de responder de la misma manera.",
        fr: "Votre réponse a été rejetée car un langage inapproprié a été détecté. Rappelez-vous : si quelqu'un utilise un langage dur, les communicateurs efficaces désamorcent plutôt que de répondre de la même manière."
    },
    'lang_error_maybe': {
        en: "❌❌Language error. Maybe you meant: ",
        es: "❌❌Error de lenguaje. Tal vez hayas querido decir: ",
        fr: "❌❌Erreur de langue. Peut-être vouliez-vous dire : "
    },
    'lang_error_detected': {
        en: "❌❌Language error detected.",
        es: "❌❌Error de lenguaje detectado.",
        fr: "❌❌Erreur de langue détectée."
    },
    'offensive_soften': {
        en: "😨😨That might be offensive or hurt someone's feelings. Read your response carefully and think how you can soften it.",
        es: "😨😨Eso podría ofender o herir sensibilidades. Lee tu respuesta cuidadosamente y piensa cómo puedes suavizarla.",
        fr: "😨😨Cela pourrait être offensant ou blesser les sentiments de quelqu'un. Lisez attentivement votre réponse et réfléchissez à la manière dont vous pourriez l'adoucir."
    },
    'offensive_insensitive': {
        en: "😨😨Possibly offensive or insensitive.",
        es: "😨😨Posiblemente ofensivo o insensitivo.",
        fr: "😨😨Peut-être offensant ou insensible."
    },
    'no_sense': {
        en: "😕😵🤔 That doesn't make sense.",
        es: "😕😵🤔 Eso no tiene sentido.",
        fr: "😕😵🤔 Cela n'a pas de sens."
    },
    'not_logical': {
        en: "😕😵🤔 Not a logical response. Maybe you did not understand what was said?",
        es: "😕😵🤔 No es una respuesta lógica. ¿Posiblemente no has entendido lo que se dijo?",
        fr: "😕😵🤔 Pas une réponse logique. Peut-être n'avez-vous pas compris ce qui a été dit ?"
    },
    'not_deep': {
        en: "🤷‍🤷🏿‍🤷‍ Not responsive enough, even if not necessarily incorrect.",
        es: "🤷‍🤷🏿‍🤷‍ No aporta suficiente, aunque no sea necesariamente incorrecta.",
        fr: "🤷‍🤷🏿‍🤷‍ Pas assez contributif, même si ce n'est pas forcément incorrect."
    },
    'too_formal_less': {
        en: "🤵🏿🤵🏻🤵 Too formal. Less formal version:",
        es: "🤵🏿🤵🏻🤵 Muy formal. Versión menos formal:",
        fr: "🤵🏿🤵🏻🤵 Trop formel. Version moins formelle :"
    },
    'too_formal_context': {
        en: "🤵🏿🤵🏻🤵 Your response is too formal for this context.",
        es: "🤵🏿🤵🏻🤵 Tu respuesta es demasiado formal para este contexto.",
        fr: "🤵🏿🤵🏻🤵 Votre réponse est trop formelle pour ce contexte."
    },
    'tech_error_retry': {
        en: "❗ Technical error. Try again.",
        es: "❗ Error técnico. Vuelve a intentar.",
        fr: "❗ Erreur technique. Réessayez."
    },
    'tech_error_generic': {
        en: "❗ There was a technical error. Try again.",
        es: "❗ Hubo un error técnico. Vuelve a intentar.",
        fr: "❗ Il y a eu une erreur technique. Réessayez."
    },
    'unable_eval': {
        en: "Unable to evaluate your response due to a technical error. Please try again.",
        es: "No se pudo evaluar tu respuesta debido a un error técnico. Por favor, inténtalo de nuevo.",
        fr: "Impossible d'évaluer votre réponse en raison d'une erreur technique. Veuillez réessayer."
    },
    'video_said': {
        en: "The video said:",
        es: "El video dijo:",
        fr: "La vidéo a dit :"
    },
    'try_again_1': {
        en: "💔 Let's try again.",
        es: "💔 Intentemos de nuevo.",
        fr: "💔 Réessayons."
    },
    'try_again_2': {
        en: "💔💔 One try left!",
        es: "¡Queda un intento!",
        fr: "Il reste un essai !"
    },
    'failed_continue': {
        en: "💔💔💔Let's continue. Better luck next time.",
        es: "💔💔💔 Vamos a continuar. Mejor suerte la próxima vez.",
        fr: "💔💔💔 Continuons. Plus de chance la prochaine fois."
    },
    'failed_continue_3_tries': {
        en: "💔💔💔 3 failed attempts to respond. Let's continue.",
        es: "💔💔💔 3 intentos fallidos en responder. Vamos a continuar.",
        fr: "💔💔💔 3 tentatives de réponse échouées. Continuons."
    },
    'lesson_load_error': {
        en: "The lesson failed to load. Check your internet connection.",
        es: "La lección no se cargó. Verifique su conexión al internet.",
        fr: "La leçon n'a pas pu être chargée. Vérifiez votre connexion internet."
    },
    'load_error': {
        en: "Failed to load. Check your internet connection.",
        es: "No se cargó. Verifique su conexión al internet.",
        fr: "Échec du chargement. Vérifiez votre connexion internet."
    },
    'imagine': {
        en: "Imagine the following: ",
        es: "Imagina lo siguiente: ",
        fr: "Imaginez ce qui suit : "
    },
    'listen_repeat': {
        en: "Listen and repeat it as quickly as you can...",
        es: "Escucha y repítelo tan rápido que puedas--",
        fr: "Écoutez et répétez-le aussi vite que vous le pouvez..."
    },


    'praise_excellent': {
        en: "Excellent!",
        es: "¡Excelente!",
        fr: "Excellent !"
    },
    'praise_awesome': {
        en: "Awesome!",
        es: "¡Increíble!",
        fr: "Génial !"
    },
    'praise_great': {
        en: "Great!",
        es: "¡Genial!",
        fr: "Super !"
    },
    'praise_amazing': {
        en: "Amazing!",
        es: "¡Asombroso!",
        fr: "Incroyable !"
    },
    'praise_very_good': {
        en: "Very good!",
        es: "¡Muy bien!",
        fr: "Très bien !"
    },
    'praise_good_work': {
        en: "Good work!",
        es: "¡Buen trabajo!",
        fr: "Bon travail !"
    },
    'praise_good_job': {
        en: "Good job!",
        es: "¡Bien hecho!",
        fr: "Beau travail !"
    },
    'praise_fantastic': {
        en: "Fantastic!",
        es: "¡Fantástico!",
        fr: "Fantastique !"
    },
    'praise_stunning': {
        en: "Stunning!",
        es: "¡Impresionante!",
        fr: "Époustouflant !"
    },
    'praise_well_said': {
        en: "Well said!",
        es: "¡Bien dicho!",
        fr: "Bien dit !"
    },
    'praise_well_done': {
        en: "Well done!",
        es: "¡Bien hecho!",
        fr: "Bien joué !"
    },
    'praise_perfect': {
        en: "Perfect!",
        es: "¡Perfecto!",
        fr: "Parfait !"
    },
    'praise_impressive': {
        en: "Impressive!",
        es: "¡Impresionante!",
        fr: "Impressionnant !"
    },
    'praise_brilliant': {
        en: "Brilliant!",
        es: "¡Brillante!",
        fr: "Brillant !"
    },
    'praise_outstanding': {
        en: "Outstanding!",
        es: "¡Sobresaliente!",
        fr: "Exceptionnel !"
    },
    'praise_superb': {
        en: "Superb!",
        es: "¡Excelente!",
        fr: "Superbe !"
    },
    'praise_terrific': {
        en: "Terrific!",
        es: "¡Estupendo!",
        fr: "Formidable !"
    },
    'praise_wonderful': {
        en: "Wonderful!",
        es: "¡Maravilloso!",
        fr: "Merveilleux !"
    },
    'praise_spectacular': {
        en: "Spectacular!",
        es: "¡Espectacular!",
        fr: "Spectaculaire !"
    },
    'praise_magnificent': {
        en: "Magnificent!",
        es: "¡Magnífico!",
        fr: "Magnifique !"
    },
    'praise_phenomenal': {
        en: "Phenomenal!",
        es: "¡Fenomenal!",
        fr: "Phénoménal !"
    },
    'praise_incredible': {
        en: "Incredible!",
        es: "¡Increíble!",
        fr: "Incroyable !"
    },

    // --- NEW LOCALIZATION STRINGS ADDED ---

    'recommended_correction': {
        en: "RECOMMENDED CORRECTED VERSION",
        es: "VERSIÓN CORREGIDA RECOMENDADA"
    },
    'feedback_pragmatic_failure': {
        en: "That doesn't quite make sense in this context."
    },
    'feedback_rude': {
        en: "That comes across as a bit rude or insensitive."
    },
    'feedback_too_formal': {
        en: "That is a bit too formal for this situation."
    },
    'feedback_too_informal': {
        en: "That is too casual for this situation."
    },
    'feedback_unidiomatic': {
        en: "That sounds a bit unnatural. Here is a more common way to say it."
    },
    'stats_repetitions_required': {
        en: "Repetitions:"
    },
    'stats_attempts_required': {
        en: "Attempts:"
    },
    'stats_fluency_score': {
        en: "Fluency Score:"
    },
    'share_title': {
        en: "My English Video",
        es: "Mi Video de Inglés"
    },
    'share_text': {
        en: "Check out my English fluency progress on UFF!",
        es: "¡Mira mi progreso de fluidez en inglés en UFF!"
    },

    'status_wait': {
        en: "WAIT.",
        es: "ESPERA.",
        fr: "ATTENDEZ."
    },
    'status_speak': {
        en: "SPEAK.",
        es: "HABLA.",
        fr: "PARLEZ."
    },
    'status_connecting': {
        en: "WAIT! Connecting...",
        es: "¡ESPEREMOS! Conectando...",
        fr: "ATTENDEZ ! Connexion..."
    },
    'alert_lesson_reset': {
        en: "The lesson will reset if you leave.",
        es: "La lección se reseteará si te vas.",
        fr: "La leçon sera réinitialisée si vous partez."
    },
    'alert_media_error': {
        en: "Error. Check mic & cam settings & internet.",
        es: "Error. Revisa ajustes de micrófono y cámara, e internet.",
        fr: "Erreur. Vérifiez les paramètres du micro, de la caméra et d'internet."
    },
    'error_media_details': {
        en: "ERROR. Check mic & cam settings & internet.",
        es: "ERROR. Revisa ajustes de micrófono y cámara, e internet.",
        fr: "ERREUR. Vérifiez les paramètres du micro, de la caméra et d'internet."
    },
    'alert_speech_connect_error': {
        en: "Failed to connect to speech service. Please refresh and try again.",
        es: "Fallo al conectar con el servicio de voz. Por favor, actualiza y vuelve a intentar.",
        fr: "Échec de la connexion au service vocal. Veuillez rafraîchir et réessayer."
    },
    'alert_speech_setup_error': {
        en: "Error setting up speech recognition. Please check microphone permissions and try again.",
        es: "Error al configurar el reconocimiento de voz. Por favor, revisa los permisos del micrófono y vuelve a intentar.",
        fr: "Erreur de configuration de la reconnaissance vocale. Veuillez vérifier les autorisations du microphone et réessayer."
    },
    'error_mic_permissions': {
        en: "Turn on mic and mic permissions.",
        es: "Activar micrófono y sus permisos.",
        fr: "Activez le micro et ses autorisations."
    },
    'error_internet': {
        en: "Check internet connection.",
        es: "Verifica conexión a internet.",
        fr: "Vérifiez la connexion internet."
    },
    'error_speech_generic': {
        en: "TRY AGAIN. Speech recognition error.",
        es: "VUELVE A INTENTAR. Error de reconocimiento de voz.",
        fr: "RÉESSAYEZ. Erreur de reconnaissance vocale."
    },
    'error_engine_not_ready': {
        en: "Speech engine not ready. Please wait a moment.",
        es: "El motor de voz no está listo. Por favor, espera un momento.",
        fr: "Le moteur vocal n'est pas prêt. Veuillez patienter un instant."
    },
    'demo_vad_limitation_notice': {
        en: "The web version can't detect pauses during speech, only hesitation at the beginning. Add us to homescreen to get the full version with more accurate speech recognition.",
        es: "La versión web no puede detectar pausas al hablar, solo la duda al inicio. Agrega nuestra app a la pantalla de inicio para obtener la versión completa con reconocimiento de voz más preciso."
    },
    'example_correct_answer': {
        en: "Example correct answer:",
        es: "Respuesta correcta de ejemplo:",
        fr: "Exemple de réponse correcte :"
    },
    'heads_up_try_again': {
        en: "You will try again next.",
        es: "A continuación, volverás a intentar.",
        fr: "Vous allez réessayer ensuite."
    },
    'heads_up_repeat_video': {
        en: "Next, you will repeat what the video said.",
        es: "A continuación, volverás a repetir lo que el video dijo.",
        fr: "Ensuite, vous répéterez ce que la vidéo a dit."
    },
    'btn_not_sure': {
        en: "I'm not sure",
        es: "No estoy seguro/a",
        fr: "Je ne suis pas sûr(e)"
    },
    'placeholder_type_answer': {
        en: "Type your answer here...",
        es: "Escribe tu respuesta aquí...",
        fr: "Tapez votre réponse ici..."
    },
    'btn_submit': {
        en: "Submit",
        es: "Enviar",
        fr: "Soumettre"
    },
    'msg_lesson_complete_all': {
        en: "<h3>Congratulations!</h3><p>You've completed all the lessons.</p>",
        es: "<h3>¡Felicidades!</h3><p>Has completado todas las lecciones.</p>",
        fr: "<h3>Félicitations !</h3><p>Vous avez terminé toutes les leçons.</p>"
    },
    'btn_continue': {
        en: "Continue",
        es: "Continuar",
        fr: "Continuer"
    },
    'possible_response': {
        en: "Possible Response:",
        es: "Respuesta posible:",
        fr: "Réponse possible :"
    },
    'lesson_label': {
        en: "Lesson:",
        es: "Lección:",
        fr: "Leçon :"
    },
    'ai_acceptable': {
        en: "🎯 Acceptable. Try to use more advanced language.",
        es: "🎯 Aceptable. Intenta usar un lenguaje más avanzado.",
        fr: "🎯 Acceptable. Essayez d'utiliser un langage plus avancé."
    },
    'ai_language_level': {
        en: "Language level:",
        es: "Nivel de idioma:",
        fr: "Niveau de langue :"
    },
    'ai_fluency_reduced': {
        en: "Fluency score reduced by",
        es: "Puntuación de fluidez reducida en",
        fr: "Score de fluidité réduit de"
    },
    'ai_percentage_points': {
        en: "percentage points",
        es: "puntos porcentuales",
        fr: "points de pourcentage"
    },
    'failed_continue_correct': {
        en: "💔💔💔 Let's continue. Better luck next time. I said:",
        es: "💔💔💔 Vamos a continuar. Mejor suerte la próxima vez. Yo dije:",
        fr: "💔💔💔 Continuons. Plus de chance la prochaine fois. J'ai dit :"
    },
    'grammar_perfect': {
        en: "✅ No language errors detected."
    },
    'intent_perfect': {
        en: "✅ Meaning understood successfully."
    },
    'intent_good_grammar_bad': {
        en: "✅ Your intent was clear! Try practicing the corrected version above next time."
    },
    'intent_bad_grammar_perfect': {
        en: "❌ That doesn't seem to be the right response for this situation."
    },
    'intent_bad_grammar_bad': {
        en: "❌ Even with corrected grammar, this didn't match the expected meaning. Let's try again!"
    },

    'error_render_failed': {
        en: "Render failed: ",
        es: "Error de renderizado: ",
        fr: "Échec du rendu : "
    },
    'ai_analyzing': {
        en: "Analyzing your response...",
        es: "Analizando tu respuesta...",
        fr: "Analyse de votre réponse..."
    },
    'ai_thinking': {
        en: "Tutor is thinking...",
        es: "El tutor está pensando...",
        fr: "Le tuteur réfléchit..."
    },
    'sign_out': {
        en: "Sign Out",
        es: "Cerrar sesión",
        fr: "Se déconnecter"
    },
    'sign_in': {
        en: "Sign In",
        es: "Iniciar sesión",
        fr: "Se connecter"
    },
    'intent_specific_fail': {
        en: "❌ It seems like you're {bad_intent}, but this indicates you didn't understand what was said."
    },
    'widget_incoming': {
        en: "INCOMING",
        es: "ENTRANTE",
        fr: "ENTRANT"
    },
    'widget_action_video': {
        en: "Tap to watch...",
        es: "Toca para ver...",
        fr: "Appuyez pour voir..."
    },
    'widget_action_audio': {
        en: "Tap to listen...",
        es: "Toca para escuchar...",
        fr: "Appuyez pour écouter..."
    },
    'widget_action_text': {
        en: "Tap to continue...",
        es: "Toca para continuar...",
        fr: "Appuyez pour continuer..."
    },
    'guest_modal_title': {
        en: "Welcome!",
        es: "¡Bienvenido!"
    },
    'guest_modal_body': {
        en: "You are currently not logged in. Log in or sign up to save your progress and access all features. Or, continue as a guest to try out the app.",
        es: "Actualmente no has iniciado sesión. Inicia sesión o regístrate para guardar tu progreso y acceder a todas las funciones. O continúa como invitado para probar la aplicación."
    },
    'guest_modal_login': {
        en: "Log In",
        es: "Iniciar sesión"
    },
    'guest_modal_signup': {
        en: "Sign Up",
        es: "Registrarse"
    },
    'guest_modal_continue': {
        en: "Continue as Guest",
        es: "Continuar como invitado"
    }
};

/**
 * Gets a UI string, optionally with a translation appended and placeholders replaced.
 * @param {string} key - The string key.
 * @param {string} lang - The user's native language code (e.g., 'es').
 * @param {Object} placeholders - Optional key-value pairs for interpolation (e.g., { score: 100 }).
 * @returns {string} - The formatted string.
 */
export function get(key, lang = 'en', placeholders = {}) {
    const entry = strings[key];
    if (!entry) return key;

    // Support both 2-char codes (es) and full locales (es-ES)
    const normalizedLang = (lang && typeof lang === 'string')
        ? lang.split('-')[0].toLowerCase()
        : 'en';

    let englishText = entry.en || '';
    let translatedText = entry[normalizedLang] || '';

    // Replace placeholders in both
    if (placeholders && typeof placeholders === 'object') {
        Object.entries(placeholders).forEach(([pKey, pValue]) => {
            const token = `{${pKey}}`;
            englishText = englishText.replaceAll(token, pValue);
            translatedText = translatedText.replaceAll(token, pValue);
        });
    }

    // Return the localized text or fall back to English (no HTML).
    // Components that need bilingual display should use getBilingual() instead.
    if (normalizedLang === 'en' || !entry[normalizedLang]) {
        return englishText;
    }
    return translatedText;
}

/**
 * Gets a UI string as structured bilingual data (no HTML).
 * Returns { english, localized, lang } so the caller can render
 * with platform-native elements (React, React Native, etc.).
 */
export function getBilingual(key, lang = 'en', placeholders = {}) {
    const entry = strings[key];
    if (!entry) return { english: key, localized: null, lang };

    const normalizedLang = (lang && typeof lang === 'string')
        ? lang.split('-')[0].toLowerCase()
        : 'en';

    let english = entry.en || '';
    let localized = entry[normalizedLang] || '';

    if (placeholders && typeof placeholders === 'object') {
        Object.entries(placeholders).forEach(([pKey, pValue]) => {
            const token = `{${pKey}}`;
            english = english.replaceAll(token, pValue);
            localized = localized.replaceAll(token, pValue);
        });
    }

    return {
        english,
        localized: (normalizedLang !== 'en' && localized) ? localized : null,
        lang: normalizedLang
    };
}

export default { get, getBilingual };
