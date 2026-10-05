// strings.js - Centralized UI strings for the UFF application

const strings = {

    'stats_header': {
        en: "SPEECH ANALYTICS",
        es: "ANÁLISIS DE VOZ",
        hi: "भाषण विश्लेषण",
        bn: "বক্তৃতা বিশ্লেষণ"
    },
    'stats_speech_flow_header': {
        en: "SPEECH FLOW:",
        es: "FLUIDEZ DE VOZ:",
        hi: "भाषण प्रवाह:",
        bn: "বক্তৃতার ধারা:"
    },
    'stats_vocabulary_header': {
        en: "VOCABULARY:",
        es: "VOCABULARIO:",
        hi: "शब्दावली:",
        bn: "শব্দভাণ্ডার:"
    },
    'stats_grammar_header': {
        en: "GRAMMAR:",
        es: "GRAMÁTICA:",
        hi: "व्याकरण:",
        bn: "ব্যাকরণ:"
    },
    'stats_vocab_header': {
        en: "VOCAB:",
        es: "VOCABULARIO:",
        hi: "शब्दावली:",
        bn: "শব্দভাণ্ডার:"
    },
    'stats_pragmatics_header': {
        en: "UNDERSTANDING:",
        es: "COMPRENSIÓN:",
        hi: "समझ:",
        bn: "বোঝাপড়া:"
    },
    'stats_formality_header': {
        en: "FORMALITY:",
        es: "FORMALIDAD:",
        hi: "औपचारिकता:",
        bn: "আনুষ্ঠানিকতা:"
    },
    'stats_native_like_header': {
        en: "NATIVE-LIKE:",
        es: "NATURALIDAD:",
        hi: "देशी जैसा:",
        bn: "মাতৃভাষীর মতো:"
    },
    'stats_listening_header': {
        en: "LISTENING SCORE: {score}%",
        es: "PUNTUACIÓN DE ESCUCHA: {score}%",
        hi: "सुनने का स्कोर: {score}%",
        bn: "শোনার স্কোর: {score}%"
    },
    'stats_speaking_header': {
        en: "SPEAKING SCORE: {score}%",
        es: "PUNTUACIÓN DE HABLA: {score}%",
        hi: "बोलने का स्कोर: {score}%",
        bn: "বলার স্কোর: {score}%"
    },
    'stats_hesitation': {
        en: "Hesitation at start",
        es: "Duda al inicio",
        hi: "शुरुआत में हिचकिचाहट",
        bn: "শুরুতে দ্বিধা"
    },
    'stats_pauses_speaking': {
        en: "Pauses during speaking",
        es: "Pausas al hablar",
        hi: "बोलते समय रुकना",
        bn: "বলার সময় থামা"
    },
    'stats_idioms': {
        en: "Number of idioms",
        es: "Número de modismos",
        hi: "मुहावरों की संख्या",
        bn: "বাগধারার সংখ্যা"
    },
    'stats_wpm': {
        en: "Words per minute",
        es: "Palabras por minuto",
        hi: "शब्द प्रति मिनट",
        bn: "প্রতি মিনিটে শব্দ"
    },
    'stats_pauses': {
        en: "Pauses",
        es: "Pausas",
        hi: "रुकावटें",
        bn: "থামা"
    },
    'stats_complexity': {
        en: "Complexity Score",
        es: "Puntuación de complejidad",
        hi: "जटिलता स्कोर",
        bn: "জটিলতার স্কোর"
    },
    'feedback_slow': {
        en: "You spoke somewhat slowly. Try to speak a bit faster next time.",
        es: "Hablaste algo lento. Intenta hablar un poco más rápido la próxima vez.",
        hi: "आपने कुछ धीरे बोला। अगली बार थोड़ा तेज़ बोलने की कोशिश करें।",
        bn: "আপনি কিছুটা ধীরে বলেছেন। পরের বার একটু দ্রুত বলার চেষ্টা করুন।"
    },
    'feedback_good': {
        en: "Good pace!",
        es: "¡Buen ritmo!",
        hi: "अच्छी गति!",
        bn: "ভালো গতি!"
    },
    'feedback_fast': {
        en: "You spoke very fast!",
        es: "¡Hablaste muy rápido!",
        hi: "आपने बहुत तेज़ बोला!",
        bn: "আপনি খুব দ্রুত বলেছেন!"
    },
    'feedback_brief_penalty': {
        en: "Try giving a longer response next time to score higher.",
        es: "Intenta dar una respuesta más larga la próxima vez para obtener una mejor puntuación.",
        hi: "अगली बार अधिक अंक पाने के लिए लंबा उत्तर देने की कोशिश करें।",
        bn: "পরের বার বেশি স্কোর পেতে আরও দীর্ঘ উত্তর দেওয়ার চেষ্টা করুন।"
    },
    'try_again_speech': {
        en: "TRY AGAIN. Speech not detected.",
        es: "VUELVE A INTENTAR. Voz no detectada.",
        fr: "ESSAYEZ À NOUVEAU. Parole non détectée.",
        hi: "फिर से प्रयास करें। आवाज़ का पता नहीं चला।",
        bn: "আবার চেষ্টা করুন। কথা শনাক্ত করা যায়নি।"
    },
    'already_used': {
        en: "You already gave that response. In order to evaluate and develop your fluency, we don't allow you to re-use responses during a lesson or test.",
        es: "Ya diste esa respuesta. Para desarrollar y evaluar tu fluidez, no permitimos que vuelvas a utilizar respuestas durante una lección o test.",
        fr: "Vous avez déjà donné cette réponse. Afin d'évaluer et de développer votre fluidité, nous n'autorisons pas la réutilisation des réponses pendant une leçon ou un test.",
        hi: "आप पहले ही वह उत्तर दे चुके हैं। आपकी धाराप्रवाहता का मूल्यांकन और विकास करने के लिए, हम पाठ या परीक्षण के दौरान उत्तरों को दोबारा उपयोग करने की अनुमति नहीं देते।",
        bn: "আপনি ইতিমধ্যে সেই উত্তর দিয়েছেন। আপনার সাবলীলতা মূল্যায়ন ও বিকাশের জন্য, আমরা পাঠ বা পরীক্ষার সময় উত্তর পুনরায় ব্যবহারের অনুমতি দিই না।"
    },
    'no_repetition': {
        en: "In order to build and evaluate your fluency, we do not accept a response that is a simple repetition of the video, even if it would be a good reply.",
        es: "Con el fin de evaluar y desarrollar tu fluidez, no aceptamos una respuesta si es una simple repetición del video, aún si sería una buena respuesta.",
        fr: "Afin de construire et d'évaluer votre fluidité, nous n'acceptons pas une réponse qui est une simple répétition de la vidéo, même si ce serait une bonne réponse.",
        hi: "आपकी धाराप्रवाहता बनाने और उसका मूल्यांकन करने के लिए, हम ऐसा उत्तर स्वीकार नहीं करते जो वीडियो की साधारण पुनरावृत्ति हो, भले ही वह अच्छा उत्तर हो।",
        bn: "আপনার সাবলীলতা গড়ে তোলা ও মূল্যায়নের জন্য, আমরা ভিডিওর সরল পুনরাবৃত্তি এমন উত্তর গ্রহণ করি না, এমনকি এটি ভালো উত্তর হলেও।"
    },
    'min_words_3': {
        en: "Your response must be at least three words long.",
        es: "Tu respuesta debe tener al menos tres palabras.",
        fr: "Votre réponse doit contenir au moins trois mots.",
        hi: "आपका उत्तर कम से कम तीन शब्दों का होना चाहिए।",
        bn: "আপনার উত্তর কমপক্ষে তিনটি শব্দের হতে হবে।"
    },
    'min_words_4': {
        en: "Your response must be at least four words long.",
        es: "Tu respuesta debe tener al menos cuatro palabras.",
        fr: "Votre réponse doit contenir au moins quatre mots.",
        hi: "आपका उत्तर कम से कम चार शब्दों का होना चाहिए।",
        bn: "আপনার উত্তর কমপক্ষে চারটি শব্দের হতে হবে।"
    },
    'min_words_5': {
        en: "Your response must be at least five words long.",
        es: "Tu respuesta debe tener al menos cinco palabras.",
        fr: "Votre réponse doit contenir au moins cinq mots.",
        hi: "आपका उत्तर कम से कम पाँच शब्दों का होना चाहिए।",
        bn: "আপনার উত্তর কমপক্ষে পাঁচটি শব্দের হতে হবে।"
    },
    'min_words_6': {
        en: "Your response must be at least six words long.",
        es: "Tu respuesta debe tener al menos seis palabras.",
        fr: "Votre réponse doit contenir au moins six mots.",
        hi: "आपका उत्तर कम से कम छह शब्दों का होना चाहिए।",
        bn: "আপনার উত্তর কমপক্ষে ছয়টি শব্দের হতে হবে।"
    },
    'censored': {
        en: "Your response was rejected because it contains censored words. Remember: if someone uses harsh language, effective communicators de-escalate rather than respond in kind.",
        es: "Tu respuesta fue rechazada porque contiene palabras censuradas. Recuerda: si alguien usa lenguaje fuerte, los comunicadores efectivos desescalan en lugar de responder de la misma manera.",
        fr: "Votre réponse a été rejetée car elle contient des mots censurés. Rappelez-vous : si quelqu'un utilise un langage dur, les communicateurs efficaces désamorcent plutôt que de répondre de la même manière.",
        hi: "आपका उत्तर अस्वीकार कर दिया गया क्योंकि इसमें प्रतिबंधित शब्द हैं। याद रखें: यदि कोई कठोर भाषा का उपयोग करता है, तो प्रभावी संवादकर्ता उसी तरह जवाब देने के बजाय स्थिति को शांत करते हैं।",
        bn: "আপনার উত্তর প্রত্যাখ্যান করা হয়েছে কারণ এতে নিষিদ্ধ শব্দ রয়েছে। মনে রাখবেন: কেউ যদি কঠোর ভাষা ব্যবহার করে, তবে কার্যকর যোগাযোগকারীরা একইভাবে উত্তর দেওয়ার পরিবর্তে পরিস্থিতি শান্ত করেন।"
    },
    'inappropriate': {
        en: "Your response was rejected because inappropriate language was detected. Remember: if someone uses harsh language, effective communicators de-escalate rather than respond in kind.",
        es: "Tu respuesta fue rechazada porque se detectó lenguaje inapropiado. Recuerda: si alguien usa lenguaje fuerte, los comunicadores efectivos desescalan en lugar de responder de la misma manera.",
        fr: "Votre réponse a été rejetée car un langage inapproprié a été détecté. Rappelez-vous : si quelqu'un utilise un langage dur, les communicateurs efficaces désamorcent plutôt que de répondre de la même manière.",
        hi: "आपका उत्तर अस्वीकार कर दिया गया क्योंकि अनुचित भाषा का पता चला। याद रखें: यदि कोई कठोर भाषा का उपयोग करता है, तो प्रभावी संवादकर्ता उसी तरह जवाब देने के बजाय स्थिति को शांत करते हैं।",
        bn: "আপনার উত্তর প্রত্যাখ্যান করা হয়েছে কারণ অনুপযুক্ত ভাষা শনাক্ত হয়েছে। মনে রাখবেন: কেউ যদি কঠোর ভাষা ব্যবহার করে, তবে কার্যকর যোগাযোগকারীরা একইভাবে উত্তর দেওয়ার পরিবর্তে পরিস্থিতি শান্ত করেন।"
    },
    'lang_error_maybe': {
        en: "❌❌Language error. Maybe you meant: ",
        es: "❌❌Error de lenguaje. Tal vez hayas querido decir: ",
        fr: "❌❌Erreur de langue. Peut-être vouliez-vous dire : ",
        hi: "❌❌भाषा त्रुटि। शायद आपका मतलब था: ",
        bn: "❌❌ভাষার ত্রুটি। সম্ভবত আপনি বোঝাতে চেয়েছিলেন: "
    },
    'lang_error_detected': {
        en: "❌❌Language error detected.",
        es: "❌❌Error de lenguaje detectado.",
        fr: "❌❌Erreur de langue détectée.",
        hi: "❌❌भाषा त्रुटि का पता चला।",
        bn: "❌❌ভাষার ত্রুটি শনাক্ত হয়েছে।"
    },
    'offensive_soften': {
        en: "😨😨That might be offensive or hurt someone's feelings. Read your response carefully and think how you can soften it.",
        es: "😨😨Eso podría ofender o herir sensibilidades. Lee tu respuesta cuidadosamente y piensa cómo puedes suavizarla.",
        fr: "😨😨Cela pourrait être offensant ou blesser les sentiments de quelqu'un. Lisez attentivement votre réponse et réfléchissez à la manière dont vous pourriez l'adoucir.",
        hi: "😨😨यह आपत्तिजनक हो सकता है या किसी की भावनाओं को ठेस पहुँचा सकता है। अपना उत्तर ध्यान से पढ़ें और सोचें कि आप इसे कैसे नरम कर सकते हैं।",
        bn: "😨😨এটি আপত্তিকর হতে পারে বা কারও অনুভূতিতে আঘাত দিতে পারে। আপনার উত্তর মনোযোগ দিয়ে পড়ুন এবং ভাবুন কীভাবে এটি নরম করা যায়।"
    },
    'offensive_insensitive': {
        en: "😨😨Possibly offensive or insensitive.",
        es: "😨😨Posiblemente ofensivo o insensitivo.",
        fr: "😨😨Peut-être offensant ou insensible.",
        hi: "😨😨संभवतः आपत्तिजनक या असंवेदनशील।",
        bn: "😨😨সম্ভবত আপত্তিকর বা সংবেদনহীন।"
    },
    'no_sense': {
        en: "😕😵🤔 That doesn't make sense.",
        es: "😕😵🤔 Eso no tiene sentido.",
        fr: "😕😵🤔 Cela n'a pas de sens.",
        hi: "😕😵🤔 इसका कोई मतलब नहीं है।",
        bn: "😕😵🤔 এটা অর্থহীন।"
    },
    'not_logical': {
        en: "😕😵🤔 Not a logical response. Maybe you did not understand what was said?",
        es: "😕😵🤔 No es una respuesta lógica. ¿Posiblemente no has entendido lo que se dijo?",
        fr: "😕😵🤔 Pas une réponse logique. Peut-être n'avez-vous pas compris ce qui a été dit ?",
        hi: "😕😵🤔 यह तार्किक उत्तर नहीं है। शायद आपने समझा नहीं कि क्या कहा गया था?",
        bn: "😕😵🤔 এটি যৌক্তিক উত্তর নয়। সম্ভবত আপনি বুঝতে পারেননি কী বলা হয়েছিল?"
    },
    'not_deep': {
        en: "🤷‍🤷🏿‍🤷‍ Not responsive enough, even if not necessarily incorrect.",
        es: "🤷‍🤷🏿‍🤷‍ No aporta suficiente, aunque no sea necesariamente incorrecta.",
        fr: "🤷‍🤷🏿‍🤷‍ Pas assez contributif, même si ce n'est pas forcément incorrect.",
        hi: "🤷‍🤷🏿‍🤷‍ पर्याप्त उत्तरदायी नहीं, भले ही यह अनिवार्य रूप से गलत न हो।",
        bn: "🤷‍🤷🏿‍🤷‍ যথেষ্ট সাড়া দেয়নি, এমনকি এটি অগত্যা ভুল না হলেও।"
    },
    'too_formal_less': {
        en: "🤵🏿🤵🏻🤵 Too formal. Less formal version:",
        es: "🤵🏿🤵🏻🤵 Muy formal. Versión menos formal:",
        fr: "🤵🏿🤵🏻🤵 Trop formel. Version moins formelle :",
        hi: "🤵🏿🤵🏻🤵 बहुत औपचारिक। कम औपचारिक संस्करण:",
        bn: "🤵🏿🤵🏻🤵 খুব আনুষ্ঠানিক। কম আনুষ্ঠানিক সংস্করণ:"
    },
    'too_formal_context': {
        en: "🤵🏿🤵🏻🤵 Your response is too formal for this context.",
        es: "🤵🏿🤵🏻🤵 Tu respuesta es demasiado formal para este contexto.",
        fr: "🤵🏿🤵🏻🤵 Votre réponse est trop formelle pour ce contexte.",
        hi: "🤵🏿🤵🏻🤵 आपका उत्तर इस संदर्भ के लिए बहुत औपचारिक है।",
        bn: "🤵🏿🤵🏻🤵 আপনার উত্তর এই প্রসঙ্গের জন্য খুব আনুষ্ঠানিক।"
    },
    'tech_error_retry': {
        en: "❗ Technical error. Try again.",
        es: "❗ Error técnico. Vuelve a intentar.",
        fr: "❗ Erreur technique. Réessayez.",
        hi: "❗ तकनीकी त्रुटि। फिर से प्रयास करें।",
        bn: "❗ প্রযুক্তিগত ত্রুটি। আবার চেষ্টা করুন।"
    },
    'tech_error_generic': {
        en: "❗ There was a technical error. Try again.",
        es: "❗ Hubo un error técnico. Vuelve a intentar.",
        fr: "❗ Il y a eu une erreur technique. Réessayez.",
        hi: "❗ एक तकनीकी त्रुटि हुई। फिर से प्रयास करें।",
        bn: "❗ একটি প্রযুক্তিগত ত্রুটি হয়েছে। আবার চেষ্টা করুন।"
    },
    'unable_eval': {
        en: "Unable to evaluate your response due to a technical error. Please try again.",
        es: "No se pudo evaluar tu respuesta debido a un error técnico. Por favor, inténtalo de nuevo.",
        fr: "Impossible d'évaluer votre réponse en raison d'une erreur technique. Veuillez réessayer.",
        hi: "तकनीकी त्रुटि के कारण आपके उत्तर का मूल्यांकन नहीं हो सका। कृपया फिर से प्रयास करें।",
        bn: "প্রযুক্তিগত ত্রুটির কারণে আপনার উত্তর মূল্যায়ন করা যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।"
    },
    'video_said': {
        en: "The video said:",
        es: "El video dijo:",
        fr: "La vidéo a dit :",
        hi: "वीडियो में कहा गया:",
        bn: "ভিডিওতে বলা হয়েছে:"
    },
    'try_again_1': {
        en: "💔 Let's try again.",
        es: "💔 Intentemos de nuevo.",
        fr: "💔 Réessayons.",
        hi: "💔 चलिए फिर से प्रयास करते हैं।",
        bn: "💔 আবার চেষ্টা করি।"
    },
    'try_again_2': {
        en: "💔💔 One try left!",
        es: "¡Queda un intento!",
        fr: "Il reste un essai !",
        hi: "💔💔 एक प्रयास बाकी है!",
        bn: "💔💔 একটি চেষ্টা বাকি!"
    },
    'failed_continue': {
        en: "💔💔💔Let's continue. Better luck next time.",
        es: "💔💔💔 Vamos a continuar. Mejor suerte la próxima vez.",
        fr: "💔💔💔 Continuons. Plus de chance la prochaine fois.",
        hi: "💔💔💔 चलिए आगे बढ़ते हैं। अगली बार किस्मत अच्छी हो।",
        bn: "💔💔💔 চলুন এগিয়ে যাই। পরের বার আরও ভালো ভাগ্য হোক।"
    },
    'failed_continue_3_tries': {
        en: "💔💔💔 3 failed attempts to respond. Let's continue.",
        es: "💔💔💔 3 intentos fallidos en responder. Vamos a continuar.",
        fr: "💔💔💔 3 tentatives de réponse échouées. Continuons.",
        hi: "💔💔💔 उत्तर देने के 3 असफल प्रयास। चलिए आगे बढ़ते हैं।",
        bn: "💔💔💔 উত্তর দেওয়ার ৩টি ব্যর্থ চেষ্টা। চলুন এগিয়ে যাই।"
    },
    'lesson_load_error': {
        en: "The lesson failed to load. Check your internet connection.",
        es: "La lección no se cargó. Verifique su conexión al internet.",
        fr: "La leçon n'a pas pu être chargée. Vérifiez votre connexion internet.",
        hi: "पाठ लोड नहीं हो सका। अपना इंटरनेट कनेक्शन जाँचें।",
        bn: "পাঠ লোড করা যায়নি। আপনার ইন্টারনেট সংযোগ পরীক্ষা করুন।"
    },
    'load_error': {
        en: "Failed to load. Check your internet connection.",
        es: "No se cargó. Verifique su conexión al internet.",
        fr: "Échec du chargement. Vérifiez votre connexion internet.",
        hi: "लोड नहीं हो सका। अपना इंटरनेट कनेक्शन जाँचें।",
        bn: "লোড করা যায়নি। আপনার ইন্টারনেট সংযোগ পরীক্ষা করুন।"
    },
    'imagine': {
        en: "Imagine the following: ",
        es: "Imagina lo siguiente: ",
        fr: "Imaginez ce qui suit : ",
        hi: "निम्नलिखित की कल्पना करें: ",
        bn: "নিম্নলিখিতটি কল্পনা করুন: "
    },
    'listen_repeat': {
        en: "Listen and repeat it as quickly as you can...",
        es: "Escucha y repítelo tan rápido que puedas--",
        fr: "Écoutez et répétez-le aussi vite que vous le pouvez...",
        hi: "सुनें और जितनी जल्दी हो सके उसे दोहराएँ...",
        bn: "শুনুন এবং যত দ্রুত পারেন তা পুনরাবৃত্তি করুন..."
    },


    'praise_excellent': {
        en: "Excellent!",
        es: "¡Excelente!",
        fr: "Excellent !",
        hi: "उत्कृष्ट!",
        bn: "চমৎকার!"
    },
    'praise_awesome': {
        en: "Awesome!",
        es: "¡Increíble!",
        fr: "Génial !",
        hi: "शानदार!",
        bn: "দারুণ!"
    },
    'praise_great': {
        en: "Great!",
        es: "¡Genial!",
        fr: "Super !",
        hi: "बढ़िया!",
        bn: "দারুণ!"
    },
    'praise_amazing': {
        en: "Amazing!",
        es: "¡Asombroso!",
        fr: "Incroyable !",
        hi: "अद्भुत!",
        bn: "অসাধারণ!"
    },
    'praise_very_good': {
        en: "Very good!",
        es: "¡Muy bien!",
        fr: "Très bien !",
        hi: "बहुत अच्छा!",
        bn: "খুব ভালো!"
    },
    'praise_good_work': {
        en: "Good work!",
        es: "¡Buen trabajo!",
        fr: "Bon travail !",
        hi: "अच्छा काम!",
        bn: "ভালো কাজ!"
    },
    'praise_good_job': {
        en: "Good job!",
        es: "¡Bien hecho!",
        fr: "Beau travail !",
        hi: "शाबाश!",
        bn: "সাবাশ!"
    },
    'praise_fantastic': {
        en: "Fantastic!",
        es: "¡Fantástico!",
        fr: "Fantastique !",
        hi: "शानदार!",
        bn: "চমত্কার!"
    },
    'praise_stunning': {
        en: "Stunning!",
        es: "¡Impresionante!",
        fr: "Époustouflant !",
        hi: "अद्भुत!",
        bn: "মনোমুগ্ধকর!"
    },
    'praise_well_said': {
        en: "Well said!",
        es: "¡Bien dicho!",
        fr: "Bien dit !",
        hi: "बहुत अच्छा कहा!",
        bn: "ভালো বলেছেন!"
    },
    'praise_well_done': {
        en: "Well done!",
        es: "¡Bien hecho!",
        fr: "Bien joué !",
        hi: "बहुत बढ़िया!",
        bn: "সাবাশ!"
    },
    'praise_perfect': {
        en: "Perfect!",
        es: "¡Perfecto!",
        fr: "Parfait !",
        hi: "परिपूर्ण!",
        bn: "নিখুঁত!"
    },
    'praise_impressive': {
        en: "Impressive!",
        es: "¡Impresionante!",
        fr: "Impressionnant !",
        hi: "प्रभावशाली!",
        bn: "চিত্তাকর্ষক!"
    },
    'praise_brilliant': {
        en: "Brilliant!",
        es: "¡Brillante!",
        fr: "Brillant !",
        hi: "प्रतिभाशाली!",
        bn: "মেধাবী!"
    },
    'praise_outstanding': {
        en: "Outstanding!",
        es: "¡Sobresaliente!",
        fr: "Exceptionnel !",
        hi: "उत्कृष्ट!",
        bn: "অসাধারণ!"
    },
    'praise_superb': {
        en: "Superb!",
        es: "¡Excelente!",
        fr: "Superbe !",
        hi: "बेहतरीन!",
        bn: "চমৎকার!"
    },
    'praise_terrific': {
        en: "Terrific!",
        es: "¡Estupendo!",
        fr: "Formidable !",
        hi: "जबरदस्त!",
        bn: "দুর্দান্ত!"
    },
    'praise_wonderful': {
        en: "Wonderful!",
        es: "¡Maravilloso!",
        fr: "Merveilleux !",
        hi: "अद्भुत!",
        bn: "বিস্ময়কর!"
    },
    'praise_spectacular': {
        en: "Spectacular!",
        es: "¡Espectacular!",
        fr: "Spectaculaire !",
        hi: "शानदार!",
        bn: "দর্শনীয়!"
    },
    'praise_magnificent': {
        en: "Magnificent!",
        es: "¡Magnífico!",
        fr: "Magnifique !",
        hi: "भव्य!",
        bn: "মহৎ!"
    },
    'praise_phenomenal': {
        en: "Phenomenal!",
        es: "¡Fenomenal!",
        fr: "Phénoménal !",
        hi: "असाधारण!",
        bn: "অভূতপূর্ব!"
    },
    'praise_incredible': {
        en: "Incredible!",
        es: "¡Increíble!",
        fr: "Incroyable !",
        hi: "अविश्वसनीय!",
        bn: "অবিশ্বাস্য!"
    },

    // --- NEW LOCALIZATION STRINGS ADDED ---

    'recommended_correction': {
        en: "RECOMMENDED CORRECTED VERSION",
        es: "VERSIÓN CORREGIDA RECOMENDADA",
        hi: "अनुशंसित सुधारित संस्करण",
        bn: "প্রস্তাবিত সংশোধিত সংস্করণ"
    },
    'feedback_pragmatic_failure': {
        en: "That doesn't quite make sense in this context.",
        hi: "इस संदर्भ में यह ठीक से समझ नहीं आता।",
        bn: "এই প্রসঙ্গে এটি ঠিক অর্থবোধক নয়।"
    },
    'feedback_rude': {
        en: "That comes across as a bit rude or insensitive.",
        hi: "यह थोड़ा अशिष्ट या असंवेदनशील लगता है।",
        bn: "এটি কিছুটা অভদ্র বা সংবেদনহীন মনে হচ্ছে।"
    },
    'feedback_too_formal': {
        en: "That is a bit too formal for this situation.",
        hi: "यह इस स्थिति के लिए थोड़ा बहुत औपचारिक है।",
        bn: "এটি এই পরিস্থিতির জন্য কিছুটা খুব আনুষ্ঠানিক।"
    },
    'feedback_too_informal': {
        en: "That is too casual for this situation.",
        hi: "यह इस स्थिति के लिए बहुत अनौपचारिक है।",
        bn: "এটি এই পরিস্থিতির জন্য খুব অনানুষ্ঠানিক।"
    },
    'feedback_unidiomatic': {
        en: "That sounds a bit unnatural. Here is a more common way to say it.",
        hi: "यह थोड़ा अप्राकृतिक लगता है। इसे कहने का एक अधिक सामान्य तरीका यह है।",
        bn: "এটি কিছুটা অস্বাভাবিক শোনাচ্ছে। এটি বলার আরও প্রচলিত উপায় এখানে দেওয়া হলো।"
    },
    'feedback_gibberish': {
        en: "The system could not comprehend what you were trying to say.",
        es: "El sistema no pudo comprender lo que intentabas decir.",
        hi: "सिस्टम समझ नहीं पाया कि आप क्या कहने की कोशिश कर रहे थे।",
        bn: "সিস্টেম বুঝতে পারেনি আপনি কী বলতে চাইছিলেন।"
    },
    'stats_repetitions_required': {
        en: "Repetitions:",
        hi: "पुनरावृत्तियाँ:",
        bn: "পুনরাবৃত্তি:"
    },
    'stats_attempts_required': {
        en: "Attempts:",
        hi: "प्रयास:",
        bn: "চেষ্টা:"
    },
    'stats_fluency_score': {
        en: "Fluency Score:",
        hi: "धाराप्रवाहता स्कोर:",
        bn: "সাবলীলতার স্কোর:"
    },
    'share_title': {
        en: "My English Video",
        es: "Mi Video de Inglés",
        hi: "मेरा अंग्रेज़ी वीडियो",
        bn: "আমার ইংরেজি ভিডিও"
    },
    'share_text': {
        en: "Check out my English fluency progress on UFF!",
        es: "¡Mira mi progreso de fluidez en inglés en UFF!",
        hi: "UFF पर मेरी अंग्रेज़ी धाराप्रवाहता की प्रगति देखें!",
        bn: "UFF-এ আমার ইংরেজি সাবলীলতার অগ্রগতি দেখুন!"
    },

    'status_wait': {
        en: "WAIT.",
        es: "ESPERA.",
        fr: "ATTENDEZ.",
        hi: "रुकिए।",
        bn: "অপেক্ষা করুন।"
    },
    'status_speak': {
        en: "SPEAK.",
        es: "HABLA.",
        fr: "PARLEZ.",
        hi: "बोलिए।",
        bn: "বলুন।"
    },
    'status_connecting': {
        en: "WAIT! Connecting...",
        es: "¡ESPEREMOS! Conectando...",
        fr: "ATTENDEZ ! Connexion...",
        hi: "रुकिए! कनेक्ट हो रहा है...",
        bn: "অপেক্ষা করুন! সংযোগ হচ্ছে..."
    },
    'alert_lesson_reset': {
        en: "The lesson will reset if you leave.",
        es: "La lección se reseteará si te vas.",
        fr: "La leçon sera réinitialisée si vous partez.",
        hi: "यदि आप जाते हैं तो पाठ रीसेट हो जाएगा।",
        bn: "আপনি চলে গেলে পাঠটি রিসেট হবে।"
    },
    'alert_speech_connect_error': {
        en: "Failed to connect to speech service. Please refresh and try again.",
        es: "Fallo al conectar con el servicio de voz. Por favor, actualiza y vuelve a intentar.",
        fr: "Échec de la connexion au service vocal. Veuillez rafraîchir et réessayer.",
        hi: "भाषण सेवा से कनेक्ट नहीं हो सका। कृपया रीफ़्रेश करें और फिर से प्रयास करें।",
        bn: "স্পিচ সার্ভিসে সংযোগ করা যায়নি। অনুগ্রহ করে রিফ্রেশ করে আবার চেষ্টা করুন।"
    },
    'alert_speech_setup_error': {
        en: "Error setting up speech recognition. Please check microphone permissions and try again.",
        es: "Error al configurar el reconocimiento de voz. Por favor, revisa los permisos del micrófono y vuelve a intentar.",
        fr: "Erreur de configuration de la reconnaissance vocale. Veuillez vérifier les autorisations du microphone et réessayer.",
        hi: "भाषण पहचान सेट करने में त्रुटि। कृपया माइक्रोफ़ोन अनुमतियाँ जाँचें और फिर से प्रयास करें।",
        bn: "স্পিচ শনাক্তকরণ সেটআপ করতে ত্রুটি। অনুগ্রহ করে মাইক্রোফোন অনুমতি পরীক্ষা করে আবার চেষ্টা করুন।"
    },
    'error_mic_permissions': {
        en: "Turn on mic and mic permissions.",
        es: "Activar micrófono y sus permisos.",
        fr: "Activez le micro et ses autorisations.",
        hi: "माइक और माइक अनुमतियाँ चालू करें।",
        bn: "মাইক এবং মাইক অনুমতি চালু করুন।"
    },
    'error_internet': {
        en: "Check internet connection.",
        es: "Verifica conexión a internet.",
        fr: "Vérifiez la connexion internet.",
        hi: "इंटरनेट कनेक्शन जाँचें।",
        bn: "ইন্টারনেট সংযোগ পরীক্ষা করুন।"
    },
    'error_speech_generic': {
        en: "TRY AGAIN. Speech recognition error.",
        es: "VUELVE A INTENTAR. Error de reconocimiento de voz.",
        fr: "RÉESSAYEZ. Erreur de reconnaissance vocale.",
        hi: "फिर से प्रयास करें। भाषण पहचान त्रुटि।",
        bn: "আবার চেষ্টা করুন। স্পিচ শনাক্তকরণ ত্রুটি।"
    },
    'error_engine_not_ready': {
        en: "Speech engine not ready. Please wait a moment.",
        es: "El motor de voz no está listo. Por favor, espera un momento.",
        fr: "Le moteur vocal n'est pas prêt. Veuillez patienter un instant.",
        hi: "भाषण इंजन तैयार नहीं है। कृपया एक क्षण प्रतीक्षा करें।",
        bn: "স্পিচ ইঞ্জিন প্রস্তুত নয়। অনুগ্রহ করে এক মুহূর্ত অপেক্ষা করুন।"
    },
    'error_engine_failed': {
        en: "Speech engine could not be loaded on this device. Please try using text input.",
        es: "El motor de voz no pudo cargarse en este dispositivo. Intenta usar el texto.",
        fr: "Le moteur vocal n'a pas pu être chargé sur cet appareil. Essayez d'utiliser le texte.",
        hi: "इस डिवाइस पर भाषण इंजन लोड नहीं हो सका। कृपया टेक्स्ट इनपुट का उपयोग करने का प्रयास करें।",
        bn: "এই ডিভাইসে স্পিচ ইঞ্জিন লোড করা যায়নি। অনুগ্রহ করে টেক্সট ইনপুট ব্যবহার করার চেষ্টা করুন।"
    },
    'action_preparing_voice': {
        en: "Getting your microphone ready…",
        es: "Preparando tu micrófono…",
        pt: "Preparando seu microfone…",
        fr: "Préparation de votre micro…",
        hi: "आपका माइक्रोफ़ोन तैयार किया जा रहा है…",
        bn: "আপনার মাইক্রোফোন প্রস্তুত করা হচ্ছে…"
    },
    'error_engine_loading_hint': {
        en: "This usually takes a few seconds. Keep this tab open.",
        es: "Normalmente tarda unos segundos. Mantén esta pestaña abierta.",
        pt: "Normalmente leva alguns segundos. Mantenha esta aba aberta.",
        fr: "Cela prend quelques secondes. Gardez cet onglet ouvert.",
        hi: "इसमें आमतौर पर कुछ सेकंड लगते हैं। इस टैब को खुला रखें।",
        bn: "এতে সাধারণত কয়েক সেকেন্ড লাগে। এই ট্যাবটি খোলা রাখুন।"
    },
    'error_engine_slow_title': {
        en: "Still getting speech recognition ready…",
        es: "Todavía preparando el reconocimiento de voz…",
        pt: "Ainda preparando o reconhecimento de voz…",
        fr: "Préparation de la reconnaissance vocale…",
        hi: "अभी भी भाषण पहचान तैयार हो रही है…",
        bn: "এখনও স্পিচ শনাক্তকরণ প্রস্তুত হচ্ছে…"
    },
    'error_engine_slow_hint': {
        en: "This is taking longer than usual. Check your internet connection, then try again.",
        es: "Está tardando más de lo normal. Revisa tu conexión a internet y vuelve a intentar.",
        pt: "Está demorando mais que o normal. Verifique sua conexão e tente novamente.",
        fr: "Cela prend plus de temps que d'habitude. Vérifiez votre connexion internet, puis réessayez.",
        hi: "इसमें सामान्य से अधिक समय लग रहा है। अपना इंटरनेट कनेक्शन जाँचें, फिर फिर से प्रयास करें।",
        bn: "এটি স্বাভাবিকের চেয়ে বেশি সময় নিচ্ছে। আপনার ইন্টারনেট সংযোগ পরীক্ষা করুন, তারপর আবার চেষ্টা করুন।"
    },
    'error_engine_failed_title': {
        en: "Speech recognition couldn't load",
        es: "No se pudo cargar el reconocimiento de voz",
        pt: "Não foi possível carregar o reconhecimento de voz",
        fr: "Impossible de charger la reconnaissance vocale",
        hi: "भाषण पहचान लोड नहीं हो सकी",
        bn: "স্পিচ শনাক্তকরণ লোড করা যায়নি"
    },
    'error_engine_failed_steps': {
        en: "Check your internet connection. Turn off any VPN or ad blocker for this site, then try again.",
        es: "Revisa tu conexión a internet. Desactiva cualquier VPN o bloqueador de anuncios para este sitio y vuelve a intentar.",
        pt: "Verifique sua conexão. Desative VPN ou bloqueador de anúncios para este site e tente novamente.",
        fr: "Vérifiez votre connexion internet. Désactivez tout VPN ou bloqueur de publicités pour ce site, puis réessayez.",
        hi: "अपना इंटरनेट कनेक्शन जाँचें। इस साइट के लिए कोई भी VPN या विज्ञापन अवरोधक बंद करें, फिर फिर से प्रयास करें।",
        bn: "আপনার ইন্টারনেট সংযোগ পরীক্ষা করুন। এই সাইটের জন্য যেকোনো VPN বা অ্যাড ব্লকার বন্ধ করুন, তারপর আবার চেষ্টা করুন।"
    },
    'action_try_again': {
        en: "Try Again",
        es: "Reintentar",
        pt: "Tentar novamente",
        fr: "Réessayer",
        hi: "फिर से प्रयास करें",
        bn: "আবার চেষ্টা করুন"
    },
    'error_media_not_found': {
        en: "No microphone or camera found. Connect one, then try again.",
        es: "No se encontró micrófono ni cámara. Conecta uno y vuelve a intentar.",
        pt: "Nenhum microfone ou câmera encontrado. Conecte um e tente novamente.",
        fr: "Aucun micro ni caméra détecté. Connectez-en un, puis réessayez.",
        hi: "कोई माइक्रोफ़ोन या कैमरा नहीं मिला। एक कनेक्ट करें, फिर फिर से प्रयास करें।",
        bn: "কোনো মাইক্রোফোন বা ক্যামেরা পাওয়া যায়নি। একটি সংযুক্ত করুন, তারপর আবার চেষ্টা করুন।"
    },
    'error_media_denied': {
        en: "Microphone access is blocked. Allow mic & camera in your browser settings, then try again.",
        es: "El acceso al micrófono está bloqueado. Permite micrófono y cámara en tu navegador y vuelve a intentar.",
        pt: "O acesso ao microfone está bloqueado. Permita microfone e câmera no navegador e tente novamente.",
        fr: "L'accès au micro est bloqué. Autorisez le micro et la caméra dans votre navigateur, puis réessayez.",
        hi: "माइक्रोफ़ोन एक्सेस अवरुद्ध है। अपनी ब्राउज़र सेटिंग्स में माइक और कैमरा की अनुमति दें, फिर फिर से प्रयास करें।",
        bn: "মাইক্রোফোন অ্যাক্সেস ব্লক করা আছে। আপনার ব্রাউজার সেটিংসে মাইক ও ক্যামেরা অনুমতি দিন, তারপর আবার চেষ্টা করুন।"
    },
    'error_media_busy': {
        en: "Couldn't start your microphone. Close any other app using it, then try again.",
        es: "No se pudo iniciar tu micrófono. Cierra cualquier otra app que lo use y vuelve a intentar.",
        pt: "Não foi possível iniciar seu microfone. Feche qualquer outro app que o use e tente novamente.",
        fr: "Impossible de démarrer votre micro. Fermez toute autre application qui l'utilise, puis réessayez.",
        hi: "आपका माइक्रोफ़ोन शुरू नहीं हो सका। इसे उपयोग करने वाला कोई अन्य ऐप बंद करें, फिर फिर से प्रयास करें।",
        bn: "আপনার মাইক্রোফোন শুরু করা যায়নি। এটি ব্যবহার করছে এমন অন্য কোনো অ্যাপ বন্ধ করুন, তারপর আবার চেষ্টা করুন।"
    },
    'error_media_generic': {
        en: "Couldn't start your microphone or camera. Check your settings and try again.",
        es: "No se pudo iniciar tu micrófono o cámara. Revisa tu configuración y vuelve a intentar.",
        pt: "Não foi possível iniciar seu microfone ou câmera. Verifique as configurações e tente novamente.",
        fr: "Impossible de démarrer votre micro ou caméra. Vérifiez vos paramètres, puis réessayez.",
        hi: "आपका माइक्रोफ़ोन या कैमरा शुरू नहीं हो सका। अपनी सेटिंग्स जाँचें और फिर से प्रयास करें।",
        bn: "আপনার মাইক্রোফোন বা ক্যামেরা শুরু করা যায়নি। আপনার সেটিংস পরীক্ষা করে আবার চেষ্টা করুন।"
    },
    'demo_vad_limitation_notice': {
        en: "The web version can't detect pauses during speech, only hesitation at the beginning. Add us to homescreen to get the full version with more accurate speech recognition.",
        es: "La versión web no puede detectar pausas al hablar, solo la duda al inicio. Agrega nuestra app a la pantalla de inicio para obtener la versión completa con reconocimiento de voz más preciso.",
        hi: "वेब संस्करण बोलते समय रुकावटों का पता नहीं लगा सकता, केवल शुरुआत में हिचकिचाहट का। अधिक सटीक भाषण पहचान के साथ पूर्ण संस्करण पाने के लिए हमें होमस्क्रीन पर जोड़ें।",
        bn: "ওয়েব সংস্করণ কথা বলার সময় থামা শনাক্ত করতে পারে না, শুধুমাত্র শুরুতে দ্বিধা। আরও সঠিক স্পিচ শনাক্তকরণসহ পূর্ণ সংস্করণ পেতে আমাদের হোমস্ক্রিনে যোগ করুন।"
    },
    'example_correct_answer': {
        en: "Example correct answer:",
        es: "Respuesta correcta de ejemplo:",
        fr: "Exemple de réponse correcte :",
        hi: "सही उत्तर का उदाहरण:",
        bn: "সঠিক উত্তরের উদাহরণ:"
    },
    'heads_up_try_again': {
        en: "You will try again next.",
        es: "A continuación, volverás a intentar.",
        fr: "Vous allez réessayer ensuite.",
        hi: "आगे आप फिर से प्रयास करेंगे।",
        bn: "এরপর আপনি আবার চেষ্টা করবেন।"
    },
    'heads_up_repeat_video': {
        en: "Next, you will repeat what the video said.",
        es: "A continuación, volverás a repetir lo que el video dijo.",
        fr: "Ensuite, vous répéterez ce que la vidéo a dit.",
        hi: "आगे, आप वही दोहराएँगे जो वीडियो में कहा गया।",
        bn: "এরপর, আপনি ভিডিওতে যা বলা হয়েছে তা পুনরাবৃত্তি করবেন।"
    },
    'btn_not_sure': {
        en: "I'm not sure",
        es: "No estoy seguro/a",
        fr: "Je ne suis pas sûr(e)",
        hi: "मुझे यकीन नहीं है",
        bn: "আমি নিশ্চিত নই"
    },
    'placeholder_type_answer': {
        en: "Type your answer here...",
        es: "Escribe tu respuesta aquí...",
        fr: "Tapez votre réponse ici...",
        hi: "अपना उत्तर यहाँ टाइप करें...",
        bn: "এখানে আপনার উত্তর টাইপ করুন..."
    },
    'btn_submit': {
        en: "Submit",
        es: "Enviar",
        fr: "Soumettre",
        hi: "जमा करें",
        bn: "জমা দিন"
    },
    'msg_lesson_complete_all': {
        en: "<h3>Congratulations!</h3><p>You've completed all the lessons.</p>",
        es: "<h3>¡Felicidades!</h3><p>Has completado todas las lecciones.</p>",
        fr: "<h3>Félicitations !</h3><p>Vous avez terminé toutes les leçons.</p>",
        hi: "<h3>बधाई हो!</h3><p>आपने सभी पाठ पूरे कर लिए हैं।</p>",
        bn: "<h3>অভিনন্দন!</h3><p>আপনি সব পাঠ সম্পন্ন করেছেন।</p>"
    },
    'btn_continue': {
        en: "Continue",
        es: "Continuar",
        fr: "Continuer",
        hi: "जारी रखें",
        bn: "চালিয়ে যান"
    },
    'possible_response': {
        en: "Possible Response:",
        es: "Respuesta posible:",
        fr: "Réponse possible :",
        hi: "संभावित उत्तर:",
        bn: "সম্ভাব্য উত্তর:"
    },
    'lesson_label': {
        en: "Lesson:",
        es: "Lección:",
        fr: "Leçon :",
        hi: "पाठ:",
        bn: "পাঠ:"
    },
    'ai_acceptable': {
        en: "🎯 Acceptable. Try to use more advanced language.",
        es: "🎯 Aceptable. Intenta usar un lenguaje más avanzado.",
        fr: "🎯 Acceptable. Essayez d'utiliser un langage plus avancé.",
        hi: "🎯 स्वीकार्य। अधिक उन्नत भाषा का उपयोग करने का प्रयास करें।",
        bn: "🎯 গ্রহণযোগ্য। আরও উন্নত ভাষা ব্যবহার করার চেষ্টা করুন।"
    },
    'ai_course_level': {
        en: "Language level:",
        es: "Nivel de idioma:",
        fr: "Niveau de langue :",
        hi: "भाषा स्तर:",
        bn: "ভাষার স্তর:"
    },
    'ai_fluency_reduced': {
        en: "Fluency score reduced by",
        es: "Puntuación de fluidez reducida en",
        fr: "Score de fluidité réduit de",
        hi: "धाराप्रवाहता स्कोर कम हुआ",
        bn: "সাবলীলতার স্কোর হ্রাস পেয়েছে"
    },
    'ai_percentage_points': {
        en: "percentage points",
        es: "puntos porcentuales",
        fr: "points de pourcentage",
        hi: "प्रतिशत अंक",
        bn: "শতাংশ পয়েন্ট"
    },
    'failed_continue_correct': {
        en: "💔💔💔 Let's continue. Better luck next time. I said:",
        es: "💔💔💔 Vamos a continuar. Mejor suerte la próxima vez. Yo dije:",
        fr: "💔💔💔 Continuons. Plus de chance la prochaine fois. J'ai dit :",
        hi: "💔💔💔 चलिए आगे बढ़ते हैं। अगली बार किस्मत अच्छी हो। मैंने कहा:",
        bn: "💔💔💔 চলুন এগিয়ে যাই। পরের বার আরও ভালো ভাগ্য হোক। আমি বলেছিলাম:"
    },
    'grammar_perfect': {
        en: "✅ No language errors detected.",
        hi: "✅ कोई भाषा त्रुटि नहीं मिली।",
        bn: "✅ কোনো ভাষার ত্রুটি শনাক্ত হয়নি।"
    },
    'intent_perfect': {
        en: "✅ Meaning understood successfully.",
        hi: "✅ अर्थ सफलतापूर्वक समझा गया।",
        bn: "✅ অর্থ সফলভাবে বোঝা গেছে।"
    },
    'intent_good_grammar_bad': {
        en: "✅ Your intent was clear! Try practicing the corrected version above next time.",
        hi: "✅ आपका आशय स्पष्ट था! अगली बार ऊपर दिए गए सुधारित संस्करण का अभ्यास करें।",
        bn: "✅ আপনার উদ্দেশ্য স্পষ্ট ছিল! পরের বার উপরের সংশোধিত সংস্করণটি অনুশীলন করুন।"
    },
    'intent_bad_grammar_perfect': {
        en: "❌ That doesn't seem to be the right response for this situation.",
        hi: "❌ यह इस स्थिति के लिए सही उत्तर नहीं लगता।",
        bn: "❌ এটি এই পরিস্থিতির জন্য সঠিক উত্তর বলে মনে হচ্ছে না।"
    },
    'intent_bad_grammar_bad': {
        en: "❌ Even with corrected grammar, this didn't match the expected meaning. Let's try again!",
        hi: "❌ सुधारे गए व्याकरण के साथ भी, यह अपेक्षित अर्थ से मेल नहीं खाता। चलिए फिर से प्रयास करें!",
        bn: "❌ সংশোধিত ব্যাকরণ সত্ত্বেও, এটি প্রত্যাশিত অর্থের সাথে মেলেনি। আবার চেষ্টা করি!"
    },

    'error_render_failed': {
        en: "Render failed: ",
        es: "Error de renderizado: ",
        fr: "Échec du rendu : ",
        hi: "रेंडर विफल: ",
        bn: "রেন্ডার ব্যর্থ: "
    },
    'ai_analyzing': {
        en: "Analyzing your response...",
        es: "Analizando tu respuesta...",
        fr: "Analyse de votre réponse...",
        hi: "आपके उत्तर का विश्लेषण हो रहा है...",
        bn: "আপনার উত্তর বিশ্লেষণ করা হচ্ছে..."
    },
    'ai_thinking': {
        en: "Tutor is thinking...",
        es: "El tutor está pensando...",
        fr: "Le tuteur réfléchit...",
        hi: "ट्यूटर सोच रहा है...",
        bn: "টিউটর ভাবছে..."
    },
    'sign_out': {
        en: "Sign Out",
        es: "Cerrar sesión",
        fr: "Se déconnecter",
        hi: "साइन आउट",
        bn: "সাইন আউট"
    },
    'sign_in': {
        en: "Sign In",
        es: "Iniciar sesión",
        fr: "Se connecter",
        hi: "साइन इन",
        bn: "সাইন ইন"
    },
    'intent_specific_fail': {
        en: "❌ It seems like you're {bad_intent}, but this indicates you didn't understand what was said.",
        hi: "❌ ऐसा लगता है कि आप {bad_intent} हैं, लेकिन यह दर्शाता है कि आपने समझा नहीं कि क्या कहा गया।",
        bn: "❌ মনে হচ্ছে আপনি {bad_intent}, কিন্তু এটি নির্দেশ করে যে আপনি যা বলা হয়েছিল তা বুঝতে পারেননি।"
    },
    'widget_incoming': {
        en: "INCOMING",
        es: "ENTRANTE",
        fr: "ENTRANT",
        hi: "आ रहा है",
        bn: "আসছে"
    },
    'widget_action_video': {
        en: "Tap to continue...",
        es: "Toca para continuar...",
        fr: "Appuyez pour continuer...",
        hi: "जारी रखने के लिए टैप करें...",
        bn: "চালিয়ে যেতে ট্যাপ করুন..."
    },
    'widget_action_audio': {
        en: "Tap to continue...",
        es: "Toca para continuar...",
        fr: "Appuyez pour continuer...",
        hi: "जारी रखने के लिए टैप करें...",
        bn: "চালিয়ে যেতে ট্যাপ করুন..."
    },
    'widget_action_text': {
        en: "Tap to continue...",
        es: "Toca para continuar...",
        fr: "Appuyez pour continuer...",
        hi: "जारी रखने के लिए टैप करें...",
        bn: "চালিয়ে যেতে ট্যাপ করুন..."
    },
    'guest_modal_title': {
        en: "Welcome!",
        es: "¡Bienvenido!",
        hi: "स्वागत है!",
        bn: "স্বাগতম!"
    },
    'guest_modal_body': {
        en: "You are currently not logged in.",
        es: "Actualmente no has iniciado sesión.",
        hi: "आप वर्तमान में लॉग इन नहीं हैं।",
        bn: "আপনি বর্তমানে লগ ইন করেননি।"
    },
    'guest_modal_login': {
        en: "Log In",
        es: "Iniciar sesión",
        hi: "लॉग इन",
        bn: "লগ ইন"
    },
    'guest_modal_signup': {
        en: "Sign Up",
        es: "Registrarse",
        hi: "साइन अप",
        bn: "সাইন আপ"
    },
    'guest_modal_continue': {
        en: "Continue as Guest",
        es: "Continuar como invitado",
        hi: "अतिथि के रूप में जारी रखें",
        bn: "অতিথি হিসেবে চালিয়ে যান"
    },
    'guest_language_title': {
        en: "Practice English with Us Free!\nSelect your language for translations",
        es: "Confirmar Tu Idioma Nativo",
        hi: "अपनी मातृभाषा की पुष्टि करें",
        bn: "আপনার মাতৃভাষা নিশ্চিত করুন"
    },
    'guest_language_select': {
        en: "Select your language...",
        hi: "अपनी भाषा चुनें...",
        bn: "আপনার ভাষা নির্বাচন করুন..."
    },
    'guest_language_english_only': {
        en: "No translations (not recommended)",
        es: "Continuar solo en inglés",
        hi: "केवल अंग्रेज़ी में जारी रखें",
        bn: "শুধুমাত্র ইংরেজিতে চালিয়ে যান"
    },
    'guest_language_not_listed': {
        en: "My language is not on this list (continue without translations)",
        es: "Mi idioma no está en esta lista",
        hi: "मेरी भाषा इस सूची में नहीं है",
        bn: "আমার ভাষা এই তালিকায় নেই"
    },

    // --- Home Screen ---
    'home_title': {
        en: "Ultra Fast Fluency",
        es: "Fluidez Ultra Rápida",
        hi: "अल्ट्रा फास्ट धाराप्रवाहता",
        bn: "আল্ট্রা ফাস্ট সাবলীলতা"
    },
    'home_menu': {
        en: "Menu",
        es: "Menú",
        hi: "मेनू",
        bn: "মেনু"
    },
    'home_home': {
        en: "Home",
        es: "Inicio",
        hi: "होम",
        bn: "হোম"
    },
    'home_profile': {
        en: "Profile",
        es: "Perfil",
        hi: "प्रोफ़ाइल",
        bn: "প্রোফাইল"
    },
    'home_courses': {
        en: "Courses",
        es: "Cursos",
        hi: "पाठ्यक्रम",
        bn: "কোর্স"
    },
    'home_continue': {
        en: "Continue",
        es: "Continuar",
        hi: "जारी रखें",
        bn: "চালিয়ে যান"
    },
    'home_courses_load_error': {
        en: "Failed to load courses. Please try again later.",
        es: "Error al cargar los cursos. Inténtalo de nuevo más tarde.",
        hi: "पाठ्यक्रम लोड नहीं हो सके। कृपया बाद में फिर से प्रयास करें।",
        bn: "কোর্স লোড করা যায়নি। অনুগ্রহ করে পরে আবার চেষ্টা করুন।"
    },

    // --- Profile Screen ---
    'profile_title': {
        en: "Profile",
        es: "Perfil",
        hi: "प्रोफ़ाइल",
        bn: "প্রোফাইল"
    },
    'public_profile_heading': {
        en: "Practice Speaking English with Me",
        es: "Practica Hablar Inglés Conmigo",
        hi: "मेरे साथ अंग्रेज़ी बोलने का अभ्यास करें",
        bn: "আমার সাথে ইংরেজি বলার অনুশীলন করুন"
    },
    'public_profile_not_found': {
        en: "User not found",
        es: "Usuario no encontrado",
        hi: "उपयोगकर्ता नहीं मिला",
        bn: "ব্যবহারকারী পাওয়া যায়নি"
    },
    'profile_member_since': {
        en: "Member since {date}",
        es: "Miembro desde {date}",
        hi: "{date} से सदस्य",
        bn: "{date} থেকে সদস্য"
    },
    'profile_personal_info': {
        en: "Personal Information",
        es: "Información Personal",
        hi: "व्यक्तिगत जानकारी",
        bn: "ব্যক্তিগত তথ্য"
    },
    'profile_first_name': {
        en: "First Name",
        es: "Nombre",
        hi: "पहला नाम",
        bn: "প্রথম নাম"
    },
    'profile_last_name': {
        en: "Last Name",
        es: "Apellido",
        hi: "अंतिम नाम",
        bn: "শেষ নাম"
    },
    'profile_native_language': {
        en: "Native Language",
        es: "Idioma Nativo",
        hi: "मातृभाषा",
        bn: "মাতৃভাষা"
    },
    'profile_user_level': {
        en: "English Level",
        es: "Nivel de Inglés",
        hi: "अंग्रेज़ी स्तर",
        bn: "ইংরেজি স্তর"
    },
    'profile_save': {
        en: "Save",
        es: "Guardar",
        hi: "सहेजें",
        bn: "সংরক্ষণ করুন"
    },
    'profile_change_email': {
        en: "Change Email",
        es: "Cambiar Correo",
        hi: "ईमेल बदलें",
        bn: "ইমেইল পরিবর্তন করুন"
    },
    'profile_new_email': {
        en: "New Email",
        es: "Nuevo Correo",
        hi: "नया ईमेल",
        bn: "নতুন ইমেইল"
    },
    'profile_current_password': {
        en: "Current Password",
        es: "Contraseña Actual",
        hi: "वर्तमान पासवर्ड",
        bn: "বর্তমান পাসওয়ার্ড"
    },
    'profile_update_email': {
        en: "Update Email",
        es: "Actualizar Correo",
        hi: "ईमेल अपडेट करें",
        bn: "ইমেইল আপডেট করুন"
    },
    'profile_change_password': {
        en: "Change Password",
        es: "Cambiar Contraseña",
        hi: "पासवर्ड बदलें",
        bn: "পাসওয়ার্ড পরিবর্তন করুন"
    },
    'profile_new_password': {
        en: "New Password",
        es: "Nueva Contraseña",
        hi: "नया पासवर्ड",
        bn: "নতুন পাসওয়ার্ড"
    },
    'profile_confirm_password': {
        en: "Confirm New Password",
        es: "Confirmar Nueva Contraseña",
        hi: "नए पासवर्ड की पुष्टि करें",
        bn: "নতুন পাসওয়ার্ড নিশ্চিত করুন"
    },
    'profile_update_password': {
        en: "Update Password",
        es: "Actualizar Contraseña",
        hi: "पासवर्ड अपडेट करें",
        bn: "পাসওয়ার্ড আপডেট করুন"
    },
    'profile_statistics': {
        en: "Statistics",
        es: "Estadísticas",
        hi: "आँकड़े",
        bn: "পরিসংখ্যান"
    },
    'profile_lessons_completed': {
        en: "Lessons Completed",
        es: "Lecciones Completadas",
        hi: "पूरे किए गए पाठ",
        bn: "সম্পন্ন পাঠ"
    },
    'profile_days_active': {
        en: "Days Active",
        es: "Días Activos",
        hi: "सक्रिय दिन",
        bn: "সক্রিয় দিন"
    },
    'profile_guest_title': {
        en: "Guest",
        es: "Invitado",
        hi: "अतिथि",
        bn: "অতিথি"
    },
    'profile_guest_message': {
        en: "Sign up to save your progress and access your profile.",
        es: "Regístrate para guardar tu progreso y acceder a tu perfil.",
        hi: "अपनी प्रगति सहेजने और अपनी प्रोफ़ाइल तक पहुँचने के लिए साइन अप करें।",
        bn: "আপনার অগ্রগতি সংরক্ষণ ও প্রোফাইল অ্যাক্সেস করতে সাইন আপ করুন।"
    },
    // Friend-challenge answer-lesson link on the public profile. Shown while it
    // is within the 48h R2 clip window; {time} is the countdown. Also used as
    // the visible fallback label when an entry carries no recorded lesson title.
    'profile_friend_lesson_link': {
        en: "Practice English with Me",
        es: "Practica inglés conmigo",
        pt: "Pratique inglês comigo",
        fr: "Pratique l'anglais avec moi",
        hi: "मेरे साथ अंग्रेज़ी का अभ्यास करें",
        bn: "আমার সাথে ইংরেজি চর্চা করুন"
    },
    'profile_friend_link_available': {
        en: "Available for {time}",
        es: "Disponible por {time}",
        pt: "Disponível por {time}",
        fr: "Disponible pendant {time}",
        hi: "{time} तक उपलब्ध",
        bn: "{time} পর্যন্ত উপলব্ধ"
    },
    // Friend-response in-app notifications (bell menu on the home screen).
    // The deadline line is static: the timestamp lets the user judge elapsed
    // time themselves.
    'notifications_title': {
        en: "Notifications",
        es: "Notificaciones",
        pt: "Notificações",
        fr: "Notifications",
        hi: "सूचनाएँ",
        bn: "বিজ্ঞপ্তি"
    },
    'notifications_empty': {
        en: "No notifications yet",
        es: "Aún no hay notificaciones",
        pt: "Ainda não há notificações",
        fr: "Aucune notification pour l'instant",
        hi: "अभी कोई सूचना नहीं",
        bn: "এখনও কোনো বিজ্ঞপ্তি নেই"
    },
    'notifications_friend_response': {
        en: "{name} created a video with your questions",
        es: "{name} creó un video con tus preguntas",
        pt: "{name} criou um vídeo com as suas perguntas",
        fr: "{name} a créé une vidéo avec vos questions",
        hi: "{name} ने आपके सवालों के साथ एक वीडियो बनाया",
        bn: "{name} আপনার প্রশ্নগুলো নিয়ে একটি ভিডিও তৈরি করেছে"
    },
    'notifications_respond_deadline': {
        en: "You only have 48 hours to respond",
        es: "Solo tienes 48 horas para responder",
        pt: "Você só tem 48 horas para responder",
        fr: "Vous n'avez que 48 heures pour répondre",
        hi: "आपके पास जवाब देने के लिए केवल 48 घंटे हैं",
        bn: "আপনার কাছে উত্তর দেওয়ার জন্য মাত্র 48 ঘণ্টা আছে"
    },
    'notifications_someone': {
        en: "A friend",
        es: "Un amigo",
        pt: "Um amigo",
        fr: "Un ami",
        hi: "एक मित्र",
        bn: "একজন বন্ধু"
    },
    'profile_updated': {
        en: "Profile updated successfully.",
        es: "Perfil actualizado correctamente.",
        hi: "प्रोफ़ाइल सफलतापूर्वक अपडेट हुई।",
        bn: "প্রোফাইল সফলভাবে আপডেট হয়েছে।"
    },
    'profile_email_verification_sent': {
        en: "Verification email sent. Check your inbox to confirm the change.",
        es: "Correo de verificación enviado. Revisa tu bandeja de entrada para confirmar el cambio.",
        hi: "सत्यापन ईमेल भेजा गया। परिवर्तन की पुष्टि के लिए अपना इनबॉक्स जाँचें।",
        bn: "যাচাইকরণ ইমেইল পাঠানো হয়েছে। পরিবর্তন নিশ্চিত করতে আপনার ইনবক্স পরীক্ষা করুন।"
    },
    'profile_password_updated': {
        en: "Password updated successfully.",
        es: "Contraseña actualizada correctamente.",
        hi: "पासवर्ड सफलतापूर्वक अपडेट हुआ।",
        bn: "পাসওয়ার্ড সফলভাবে আপডেট হয়েছে।"
    },
    'profile_update_failed': {
        en: "Failed to update profile.",
        es: "Error al actualizar el perfil.",
        hi: "प्रोफ़ाइल अपडेट नहीं हो सकी।",
        bn: "প্রোফাইল আপডেট করা যায়নি।"
    },
    'profile_email_update_failed': {
        en: "Failed to update email.",
        es: "Error al actualizar el correo.",
        hi: "ईमेल अपडेट नहीं हो सका।",
        bn: "ইমেইল আপডেট করা যায়নি।"
    },
    'profile_password_update_failed': {
        en: "Failed to update password.",
        es: "Error al actualizar la contraseña.",
        hi: "पासवर्ड अपडेट नहीं हो सका।",
        bn: "পাসওয়ার্ড আপডেট করা যায়নি।"
    },
    'profile_min_chars': {
        en: "Min 8 characters",
        es: "Mín 8 caracteres",
        hi: "न्यूनतम 8 अक्षर",
        bn: "সর্বনিম্ন 8 অক্ষর"
    },
    'profile_load_failed': {
        en: "Failed to load profile.",
        es: "Error al cargar el perfil.",
        hi: "प्रोफ़ाइल लोड नहीं हो सकी।",
        bn: "প্রোফাইল লোড করা যায়নি।"
    },

    // --- Auth Forms ---
    'auth_login_title': {
        en: "Login",
        es: "Iniciar sesión",
        hi: "लॉगिन",
        bn: "লগইন"
    },
    'auth_email_label': {
        en: "Email address",
        es: "Correo electrónico",
        hi: "ईमेल पता",
        bn: "ইমেইল ঠিকানা"
    },
    'auth_password_label': {
        en: "Password",
        es: "Contraseña",
        hi: "पासवर्ड",
        bn: "পাসওয়ার্ড"
    },
    'auth_logging_in': {
        en: "Logging in...",
        es: "Iniciando sesión...",
        hi: "लॉग इन हो रहा है...",
        bn: "লগ ইন হচ্ছে..."
    },
    'auth_log_in': {
        en: "Log In",
        es: "Iniciar sesión",
        hi: "लॉग इन",
        bn: "লগ ইন"
    },
    'auth_no_account': {
        en: "Don't have an account?",
        es: "¿No tienes una cuenta?",
        hi: "खाता नहीं है?",
        bn: "অ্যাকাউন্ট নেই?"
    },
    'auth_sign_up_link': {
        en: "Sign up",
        es: "Registrarse",
        hi: "साइन अप करें",
        bn: "সাইন আপ করুন"
    },
    'auth_forgot_password': {
        en: "Forgot password?",
        es: "¿Olvidaste tu contraseña?",
        hi: "पासवर्ड भूल गए?",
        bn: "পাসওয়ার্ড ভুলে গেছেন?"
    },
    'auth_signup_title': {
        en: "Sign Up",
        es: "Registrarse",
        hi: "साइन अप",
        bn: "সাইন আপ"
    },
    'auth_creating_account': {
        en: "Creating account...",
        es: "Creando cuenta...",
        hi: "खाता बनाया जा रहा है...",
        bn: "অ্যাকাউন্ট তৈরি হচ্ছে..."
    },
    'auth_password_min_chars': {
        en: "Password (min 8 chars)",
        es: "Contraseña (mín 8 caracteres)",
        hi: "पासवर्ड (न्यूनतम 8 अक्षर)",
        bn: "পাসওয়ার্ড (সর্বনিম্ন 8 অক্ষর)"
    },
    'auth_already_account': {
        en: "Already have an account?",
        es: "¿Ya tienes una cuenta?",
        hi: "पहले से खाता है?",
        bn: "ইতিমধ্যে অ্যাকাউন্ট আছে?"
    },
    'auth_log_in_link': {
        en: "Log in",
        es: "Iniciar sesión",
        hi: "लॉग इन करें",
        bn: "লগ ইন করুন"
    },
    // Save-clips modal: shown when a guest presses create-video. They must sign
    // up (or log in) to get a share code before the video is created.
    'save_clips_title': {
        en: "Sign up to share your video",
        es: "Regístrate para compartir tu video",
        pt: "Cadastre-se para compartilhar seu vídeo",
        fr: "Inscrivez-vous pour partager votre vidéo",
        hi: "अपना वीडियो साझा करने के लिए साइन अप करें",
        bn: "আপনার ভিডিও শেয়ার করতে সাইন আপ করুন"
    },
    'save_clips_body': {
        en: "Create a free account to get your share link. Your friends will use it to practice English with you.",
        es: "Crea una cuenta gratis para obtener tu enlace para compartir. Tus amigos lo usarán para practicar inglés contigo.",
        pt: "Crie uma conta gratuita para obter seu link de compartilhamento. Seus amigos vão usá-lo para praticar inglês com você.",
        fr: "Créez un compte gratuit pour obtenir votre lien de partage. Vos amis l'utiliseront pour pratiquer l'anglais avec vous.",
        hi: "अपना शेयर लिंक पाने के लिए मुफ़्त खाता बनाएँ। आपके दोस्त इसका उपयोग आपके साथ अंग्रेज़ी प्रैक्टिस करने के लिए करेंगे।",
        bn: "আপনার শেয়ার লিংক পেতে একটি ফ্রি অ্যাকাউন্ট তৈরি করুন। আপনার বন্ধুরা এটি ব্যবহার করে আপনার সাথে ইংরেজি প্র্যাকটিস করবে।"
    },
    'save_clips_signup_cta': {
        en: "Sign up & create my video",
        es: "Registrarme y crear mi video",
        pt: "Cadastrar e criar meu vídeo",
        fr: "S'inscrire et créer ma vidéo",
        hi: "साइन अप करें और मेरा वीडियो बनाएँ",
        bn: "সাইন আপ করুন এবং আমার ভিডিও তৈরি করুন"
    },
    // Success screen: shown while the per-segment clips are uploaded after the
    // recap is ready. Closing the tab aborts the upload.
    'clips_uploading_warning': {
        en: "Do not close this tab yet — it is safe to navigate away to share the video, just don't close the tab yet.",
        es: "No cierres esta pestaña todavía — puedes salir para compartir el video, solo no cierres la pestaña todavía.",
        pt: "Não feche esta aba ainda — é seguro sair para compartilhar o vídeo, só não feche a aba ainda.",
        fr: "Ne fermez pas encore cet onglet — vous pouvez naviguer ailleurs pour partager la vidéo, ne fermez simplement pas l'onglet.",
        hi: "अभी यह टैब बंद न करें — वीडियो शेयर करने के लिए कहीं और जाना सुरक्षित है, बस अभी टैब बंद न करें।",
        bn: "এখনও এই ট্যাবটি বন্ধ করবেন না — ভিডিও শেয়ার করতে অন্যত্র যাওয়া নিরাপদ, শুধু এখনও ট্যাবটি বন্ধ করবেন না।"
    },
    'auth_recover_title': {
        en: "Recover Password",
        es: "Recuperar Contraseña",
        hi: "पासवर्ड पुनर्प्राप्त करें",
        bn: "পাসওয়ার্ড পুনরুদ্ধার করুন"
    },
    'auth_recover_instruction': {
        en: "Enter your email address to receive a password reset link.",
        es: "Ingresa tu correo electrónico para recibir un enlace de restablecimiento.",
        hi: "पासवर्ड रीसेट लिंक प्राप्त करने के लिए अपना ईमेल पता दर्ज करें।",
        bn: "পাসওয়ার্ড রিসেট লিংক পেতে আপনার ইমেইল ঠিকানা লিখুন।"
    },
    'auth_sending': {
        en: "Sending...",
        es: "Enviando...",
        hi: "भेजा जा रहा है...",
        bn: "পাঠানো হচ্ছে..."
    },
    'auth_send_recovery': {
        en: "Send Recovery Email",
        es: "Enviar Correo de Recuperación",
        hi: "पुनर्प्राप्ति ईमेल भेजें",
        bn: "পুনরুদ্ধার ইমেইল পাঠান"
    },
    'auth_back_to_login': {
        en: "Back to login",
        es: "Volver a iniciar sesión",
        hi: "लॉगिन पर वापस जाएँ",
        bn: "লগইনে ফিরে যান"
    },
    'auth_recovery_sent': {
        en: "Recovery email sent. Check your inbox.",
        es: "Correo de recuperación enviado. Revisa tu bandeja de entrada.",
        hi: "पुनर्प्राप्ति ईमेल भेजा गया। अपना इनबॉक्स जाँचें।",
        bn: "পুনরুদ্ধার ইমেইল পাঠানো হয়েছে। আপনার ইনবক্স পরীক্ষা করুন।"
    },
    'auth_reset_title': {
        en: "Set New Password",
        es: "Establecer Nueva Contraseña",
        hi: "नया पासवर्ड सेट करें",
        bn: "নতুন পাসওয়ার্ড সেট করুন"
    },
    'auth_invalid_reset_link': {
        en: "Invalid password reset link. Please request a new one.",
        es: "Enlace de restablecimiento inválido. Solicita uno nuevo.",
        hi: "अमान्य पासवर्ड रीसेट लिंक। कृपया नया लिंक अनुरोध करें।",
        bn: "অবৈধ পাসওয়ার্ড রিসেট লিংক। অনুগ্রহ করে একটি নতুন লিংক অনুরোধ করুন।"
    },
    'auth_reset_password_label': {
        en: "New Password (min 8 chars)",
        es: "Nueva Contraseña (mín 8 caracteres)",
        hi: "नया पासवर्ड (न्यूनतम 8 अक्षर)",
        bn: "নতুন পাসওয়ার্ড (সর্বনিম্ন 8 অক্ষর)"
    },
    'auth_confirm_password_label': {
        en: "Confirm Password",
        es: "Confirmar Contraseña",
        hi: "पासवर्ड की पुष्टि करें",
        bn: "পাসওয়ার্ড নিশ্চিত করুন"
    },
    'auth_updating': {
        en: "Updating...",
        es: "Actualizando...",
        hi: "अपडेट हो रहा है...",
        bn: "আপডেট হচ্ছে..."
    },
    'auth_log_in_now': {
        en: "Log in now",
        es: "Iniciar sesión ahora",
        hi: "अभी लॉग इन करें",
        bn: "এখনই লগ ইন করুন"
    },
    'auth_passwords_mismatch': {
        en: "Passwords do not match.",
        es: "Las contraseñas no coinciden.",
        hi: "पासवर्ड मेल नहीं खाते।",
        bn: "পাসওয়ার্ড মেলে না।"
    },

    'video_did_understand': {
        en: "Did you understand completely?",
        es: "¿Entendiste completamente?",
        hi: "क्या आपने पूरी तरह समझा?",
        bn: "আপনি কি সম্পূর্ণ বুঝেছেন?"
    },
    'video_ear_training': {
        en: "TRAIN YOUR EAR",
        es: "ENTRENA TU OÍDO",
        hi: "अपने कान को प्रशिक्षित करें",
        bn: "আপনার কানকে প্রশিক্ষণ দিন"
    },
    'video_respond_now': {
        en: "RESPOND NOW",
        es: "RESPONDE AHORA",
        hi: "अभी उत्तर दें",
        bn: "এখনই উত্তর দিন"
    },
    'video_repeat_exactly': {
        en: "Can you repeat that exactly?",
        es: "¿Puedes repetir exactamente?",
        hi: "क्या आप इसे ठीक वैसे ही दोहरा सकते हैं?",
        bn: "আপনি কি এটি হুবহু পুনরাবৃত্তি করতে পারেন?"
    },
    'video_continue': {
        en: "Press a button below.",
        es: "Toca un botón abajo.",
        hi: "नीचे एक बटन दबाएँ।",
        bn: "নিচে একটি বোতাম চাপুন।"
    },
    // Shown over the lesson-success video once it ends, so the learner knows
    // the revealed button creates the recap video they can share.
    'video_continue_create': {
        en: "Continue to create and share your video",
        es: "Continúa para crear y compartir tu video",
        pt: "Continue para criar e compartilhar seu vídeo",
        fr: "Continuez pour créer et partager votre vidéo",
        hi: "अपना वीडियो बनाने और साझा करने के लिए जारी रखें",
        bn: "আপনার ভিডিও তৈরি করতে এবং শেয়ার করতে চালিয়ে যান"
    },
    'video_repeat_now': {
        en: "REPEAT NOW",
        es: "REPITE AHORA",
        hi: "अभी दोहराएँ",
        bn: "এখনই পুনরাবৃত্তি করুন"
    },
    'video_replay': {
        en: "REPLAY VIDEO",
        es: "REPETIR VIDEO",
        hi: "वीडियो फिर से चलाएँ",
        bn: "ভিডিও আবার চালান"
    },
    'continue': {
        en: "CONTINUE",
        es: "CONTINUAR",
        pt: "CONTINUAR",
        fr: "CONTINUER",
        hi: "जारी रखें",
        bn: "চালিয়ে যান"
    },
    // Post-generation success actions (Replay / Share / Continue row).
    'replay': {
        en: "REPLAY",
        es: "REPETIR",
        pt: "REPETIR",
        fr: "REJOUER",
        hi: "फिर से चलाएँ",
        bn: "আবার চালান"
    },
    'share': {
        en: "SHARE",
        es: "COMPARTIR",
        pt: "COMPARTILHAR",
        fr: "PARTAGER",
        hi: "साझा करें",
        bn: "শেয়ার করুন"
    },
    'watch_tutorial': {
        en: "WATCH TUTORIAL",
        es: "VER TUTORIAL",
        hi: "ट्यूटोरियल देखें",
        bn: "টিউটোরিয়াল দেখুন"
    },
    'incoming_video': {
        en: "INCOMING VIDEO",
        es: "VIDEO ENTRANTE",
        fr: "VIDÉO ENTRANTE",
        hi: "आने वाला वीडियो",
        bn: "আগত ভিডিও"
    },
    'video_incoming': {
        en: "INCOMING VIDEO",
        es: "VIDEO ENTRANTE",
        fr: "VIDÉO ENTRANTE",
        hi: "आने वाला वीडियो",
        bn: "আগত ভিডিও"
    },
    'english_coach': {
        en: "English Coach, UFF",
        es: "English Coach, UFF",
        fr: "Coach d'Anglais, UFF",
        hi: "अंग्रेज़ी कोच, UFF",
        bn: "ইংরেজি কোচ, UFF"
    },
    'press_webcam': {
        en: "Press the webcam button below.",
        es: "Oprime el botón de cámara abajo.",
        fr: "Appuyez sur le bouton de la caméra ci-dessous.",
        hi: "नीचे वेबकैम बटन दबाएँ।",
        bn: "নিচের ওয়েবক্যাম বোতামটি চাপুন।"
    },

    'whisper_re_record': {
        en: "RE-RECORD",
        es: "REGRABAR",
        hi: "फिर से रिकॉर्ड करें",
        bn: "আবার রেকর্ড করুন"
    },
    'whisper_accept': {
        en: "ACCEPT",
        es: "ACEPTAR",
        hi: "स्वीकार करें",
        bn: "গ্রহণ করুন"
    },
    'whisper_transcribing': {
        en: "Transcribing",
        es: "Transcribiendo",
        pt: "Transcrevendo",
        fr: "Transcription en cours",
        hi: "ट्रांसक्राइब हो रहा है",
        bn: "ট্রান্সক্রাইব হচ্ছে"
    },

    'hangman_try_again': {
        en: "Try again.",
        es: "Inténtalo de nuevo.",
        hi: "फिर से प्रयास करें।",
        bn: "আবার চেষ্টা করুন।"
    },
    'hangman_meant_to_say': {
        en: "You probably meant to say:",
        es: "Probablemente quisiste decir:",
        hi: "आप शायद यह कहना चाहते थे:",
        bn: "আপনি সম্ভবত বলতে চেয়েছিলেন:"
    },
    'hangman_you_said': {
        en: "You said:",
        es: "Dijiste:",
        hi: "आपने कहा:",
        bn: "আপনি বলেছেন:"
    },

    // Share CTA overlay for shareCta recap lessons (friend-challenge "Ask").
    // share_cta_deadline is a prefix line — the formatted date follows on the
    // next line, hence the trailing prepositions in es/fr.
    'share_cta_headline': {
        en: "Practice English with me free",
        es: "Practica inglés conmigo gratis",
        pt: "Pratique inglês comigo de graça",
        fr: "Pratique l'anglais avec moi gratuitement",
        hi: "मेरे साथ मुफ़्त अंग्रेज़ी प्रैक्टिस करें",
        bn: "আমার সাথে ফ্রি ইংরেজি প্র্যাকটিস করুন"
    },
    'share_cta_deadline': {
        en: "Practice English with me free before",
        es: "Practica inglés conmigo gratis antes del",
        pt: "Pratique inglês comigo de graça antes de",
        fr: "Pratique l'anglais avec moi gratuitement avant le",
        hi: "मेरे साथ मुफ़्त अंग्रेज़ी प्रैक्टिस करें — अंतिम तिथि:",
        bn: "আমার সাথে ফ্রি ইংরেজি প্র্যাকটিস করুন — শেষ তারিখ:"
    },
    // Call to action shown on the success screen for friend-challenge lessons,
    // where only the Share button is offered.
    'share_cta_success': {
        en: "Share this video with friends, family, and colleagues so they can practice with you. They have 48 hours to respond.",
        es: "Comparte este video con amigos, familiares y colegas para que practiquen contigo. Tienen 48 horas para responder.",
        pt: "Compartilhe este vídeo com amigos, familiares e colegas para que pratiquem com você. Eles têm 48 horas para responder.",
        fr: "Partagez cette vidéo avec des amis, votre famille et vos collègues pour qu'ils pratiquent avec vous. Ils ont 48 heures pour répondre.",
        hi: "इस वीडियो को दोस्तों, परिवार और सहकर्मियों के साथ साझा करें ताकि वे आपके साथ अभ्यास कर सकें। उनके पास जवाब देने के लिए 48 घंटे हैं।",
        bn: "এই ভিডিওটি বন্ধু, পরিবার ও সহকর্মীদের সাথে শেয়ার করুন যাতে তারা আপনার সাথে অনুশীলন করতে পারে। তাদের উত্তর দেওয়ার জন্য 48 ঘন্টা রয়েছে।"
    },
    // Message text attached when the learner shares their recap video. {url} is
    // replaced with the learner's personal share link (host + share code).
    'share_message': {
        en: "Practice English with me free here: {url}",
        es: "Practica inglés conmigo gratis aquí: {url}",
        pt: "Pratique inglês comigo de graça aqui: {url}",
        fr: "Pratique l'anglais avec moi gratuitement ici : {url}",
        hi: "मेरे साथ यहाँ मुफ़्त अंग्रेज़ी प्रैक्टिस करें: {url}",
        bn: "এখানে আমার সাথে ফ্রি ইংরেজি প্র্যাকটিস করুন: {url}"
    },
    'rotate_device_portrait': {
        en: "Recording in landscape will mess up your video. Rotate your device to portrait before you record.",
        es: "Grabar en horizontal arruinará tu video. Gira tu dispositivo a vertical antes de grabar.",
        pt: "Gravar na horizontal vai estragar seu vídeo. Gire o dispositivo para vertical antes de gravar.",
        fr: "Enregistrer en paysage gâchera votre vidéo. Tournez votre appareil en mode portrait avant d'enregistrer.",
        hi: "लैंडस्केप में रिकॉर्ड करने से आपका वीडियो खराब हो जाएगा। रिकॉर्ड करने से पहले अपने डिवाइस को पोर्ट्रेट में घुमाएँ।",
        bn: "ল্যান্ডস্কেপে রেকর্ড করলে আপনার ভিডিও নষ্ট হয়ে যাবে। রেকর্ড করার আগে আপনার ডিভাইসটি পোর্ট্রেটে ঘোরান।"
    },
    'dismiss': {
        en: "Dismiss",
        es: "Descartar",
        pt: "Dispensar",
        fr: "Ignorer",
        hi: "खारिज करें",
        bn: "খারিজ করুন"
    },

    // --- Public homepage (share-code entry) ---
    'home_landing_headline': {
        en: "Practice English with your friends for free.",
        es: "Practica inglés con tus amigos gratis.",
        pt: "Pratique inglês com seus amigos de graça.",
        fr: "Pratiquez l'anglais avec vos amis gratuitement.",
        hi: "अपने दोस्तों के साथ मुफ़्त में अंग्रेज़ी का अभ्यास करें।",
        bn: "বন্ধুদের সাথে বিনামূল্যে ইংরেজি চর্চা করুন।"
    },
    'home_landing_subheadline': {
        en: "Enter your friend's share code",
        es: "Ingresa el código de tu amigo",
        pt: "Digite o código do seu amigo",
        fr: "Entrez le code de partage de votre ami",
        hi: "अपने दोस्त का शेयर कोड दर्ज करें",
        bn: "আপনার বন্ধুর শেয়ার কোড লিখুন"
    },
    'home_landing_code_placeholder': {
        en: "Share code",
        es: "Código",
        pt: "Código",
        fr: "Code",
        hi: "शेयर कोड",
        bn: "শেয়ার কোড"
    },
    'home_landing_go': {
        en: "Go",
        es: "Ir",
        pt: "Ir",
        fr: "Aller",
        hi: "जाएँ",
        bn: "যান"
    },
    'home_landing_no_code': {
        en: "I don't have a share code",
        es: "No tengo un código",
        pt: "Não tenho um código",
        fr: "Je n'ai pas de code",
        hi: "मेरे पास शेयर कोड नहीं है",
        bn: "আমার কাছে শেয়ার কোড নেই"
    },
    'home_landing_code_required': {
        en: "Enter a share code to continue.",
        es: "Ingresa un código para continuar.",
        pt: "Digite um código para continuar.",
        fr: "Entrez un code pour continuer.",
        hi: "जारी रखने के लिए शेयर कोड दर्ज करें।",
        bn: "চালিয়ে যেতে একটি শেয়ার কোড লিখুন।"
    },
    'home_landing_code_not_found': {
        en: "We couldn't find a friend with that share code. Check it and try again.",
        es: "No encontramos a un amigo con ese código. Verifícalo e inténtalo de nuevo.",
        pt: "Não encontramos um amigo com esse código. Verifique e tente novamente.",
        fr: "Nous n'avons trouvé aucun ami avec ce code. Vérifiez-le et réessayez.",
        hi: "उस शेयर कोड वाला कोई दोस्त नहीं मिला। जाँच कर फिर से कोशिश करें।",
        bn: "সেই শেয়ার কোডে কোনো বন্ধুকে পাওয়া যায়নি। যাচাই করে আবার চেষ্টা করুন।"
    },
    'home_landing_lookup_error': {
        en: "Something went wrong. Please try again.",
        es: "Algo salió mal. Inténtalo de nuevo.",
        pt: "Algo deu errado. Tente novamente.",
        fr: "Une erreur s'est produite. Veuillez réessayer.",
        hi: "कुछ गलत हो गया। कृपया फिर से प्रयास करें।",
        bn: "কিছু ভুল হয়েছে। আবার চেষ্টা করুন।"
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

// Raw string table, exported for coverage tests (every key must carry hi/bn).
export { strings };
