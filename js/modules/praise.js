// praise.js
// Function to get random praise for the end-of-question messages

// Array of praise phrases with Spanish translations
const praisePhrases = [
    "Excellent! <span lang='es'><i>¡Excelente!</i></span>",
    "Awesome! <span lang='es'><i>¡Increíble!</i></span>",
    "Great! <span lang='es'><i>¡Genial!</i></span>",
    "Amazing! <span lang='es'><i>¡Asombroso!</i></span>",
    "Very good! <span lang='es'><i>¡Muy bien!</i></span>",
    "Good work! <span lang='es'><i>¡Buen trabajo!</i></span>",
    "Good job! <span lang='es'><i>¡Bien hecho!</i></span>",
    "Fantastic! <span lang='es'><i>¡Fantástico!</i></span>",
    "Stunning! <span lang='es'><i>¡Impresionante!</i></span>",
    "Well said! <span lang='es'><i>¡Bien dicho!</i></span>",
    "Well done! <span lang='es'><i>¡Bien hecho!</i></span>",
    "Perfect! <span lang='es'><i>¡Perfecto!</i></span>",
    "Impressive! <span lang='es'><i>¡Impresionante!</i></span>",
    "Brilliant! <span lang='es'><i>¡Brillante!</i></span>",
    "Outstanding! <span lang='es'><i>¡Sobresaliente!</i></span>",
    "Superb! <span lang='es'><i>¡Excelente!</i></span>",
    "Terrific! <span lang='es'><i>¡Estupendo!</i></span>",
    "Wonderful! <span lang='es'><i>¡Maravilloso!</i></span>",
    "Spectacular! <span lang='es'><i>¡Espectacular!</i></span>",
    "Magnificent! <span lang='es'><i>¡Magnífico!</i></span>",
    "Phenomenal! <span lang='es'><i>¡Fenomenal!</i></span>",
    "Incredible! <span lang='es'><i>¡Increíble!</i></span>"
];


export default function getRandomPraise() {
    const randomIndex = Math.floor(Math.random() * praisePhrases.length);
    return "👍👍 " + praisePhrases[randomIndex];
}
