// praise.js
// Function to get random praise for the end-of-question messages
import { renderImageInMediaContainer } from './ui.js';

// Array of praise phrases with Spanish translations
const praiseData = {
    general: [
/*        { type: 'text', content: "Excellent! <span lang='es'><i>¡Excelente!</i></span>" },
        { type: 'text', content: "Awesome! <span lang='es'><i>¡Increíble!</i></span>" },
        { type: 'text', content: "Great! <span lang='es'><i>¡Genial!</i></span>" },
        { type: 'text', content: "Amazing! <span lang='es'><i>¡Asombroso!</i></span>" },
        { type: 'text', content: "Very good! <span lang='es'><i>¡Muy bien!</i></span>" },
        { type: 'text', content: "Good work! <span lang='es'><i>¡Buen trabajo!</i></span>" },
        { type: 'text', content: "Good job! <span lang='es'><i>¡Bien hecho!</i></span>" },
        { type: 'text', content: "Fantastic! <span lang='es'><i>¡Fantástico!</i></span>" },
        { type: 'text', content: "Stunning! <span lang='es'><i>¡Impresionante!</i></span>" },
        { type: 'text', content: "Well said! <span lang='es'><i>¡Bien dicho!</i></span>" },
        { type: 'text', content: "Well done! <span lang='es'><i>¡Bien hecho!</i></span>" },
        { type: 'text', content: "Perfect! <span lang='es'><i>¡Perfecto!</i></span>" },
        { type: 'text', content: "Impressive! <span lang='es'><i>¡Impresionante!</i></span>" },
        { type: 'text', content: "Brilliant! <span lang='es'><i>¡Brillante!</i></span>" },
        { type: 'text', content: "Outstanding! <span lang='es'><i>¡Sobresaliente!</i></span>" },
        { type: 'text', content: "Superb! <span lang='es'><i>¡Excelente!</i></span>" },
        { type: 'text', content: "Terrific! <span lang='es'><i>¡Estupendo!</i></span>" },
        { type: 'text', content: "Wonderful! <span lang='es'><i>¡Maravilloso!</i></span>" },
        { type: 'text', content: "Spectacular! <span lang='es'><i>¡Espectacular!</i></span>" },
        { type: 'text', content: "Magnificent! <span lang='es'><i>¡Magnífico!</i></span>" },
        { type: 'text', content: "Phenomenal! <span lang='es'><i>¡Fenomenal!</i></span>" },
 */       { type: 'text', content: "Incredible! <span lang='es'><i>¡Increíble!</i></span>" }
    ],
    images: [
        { type: 'image', content: "assets/img/verygood01.png" },
        { type: 'image', content: "assets/img/verygood02.png" },
        { type: 'image', content: "assets/img/verygood03.png" }
    ]
};

export default function getRandomPraise(category = 'general') {
    // If general, pool both text and images to ensure variety
    let praiseList;
    if (category === 'general') {
        praiseList = [...praiseData.general, ...praiseData.images];
    } else {
        praiseList = praiseData[category] || praiseData['general'];
    }

    const randomIndex = Math.floor(Math.random() * praiseList.length);
    const selected = praiseList[randomIndex];

    console.log(`[Praise] Selected type: ${selected.type}, content: ${selected.content}`);

    if (selected.type === 'image') {
        console.log(`[Praise] Rendering image in chat: ${selected.content}`);
        return `<img src="${selected.content}" class="img-fluid rounded" alt="Praise" style="max-height: 200px; display: block; margin: 0 auto;">`;
    }

    return "👍👍 " + selected.content;
}
