// praise.js
// Function to get random praise for the end-of-step messages

import Strings from './strings.js';
import verygood01 from '../assets/img/verygood01.png';
import verygood02 from '../assets/img/verygood02.png';
import verygood03 from '../assets/img/verygood03.png';

// Array of praise keys and images
const praiseData = {
    general: [
        { type: 'text', key: 'praise_excellent' },
        { type: 'text', key: 'praise_awesome' },
        { type: 'text', key: 'praise_great' },
        { type: 'text', key: 'praise_amazing' },
        { type: 'text', key: 'praise_very_good' },
        { type: 'text', key: 'praise_good_work' },
        { type: 'text', key: 'praise_good_job' },
        { type: 'text', key: 'praise_fantastic' },
        { type: 'text', key: 'praise_stunning' },
        { type: 'text', key: 'praise_well_said' },
        { type: 'text', key: 'praise_well_done' },
        { type: 'text', key: 'praise_perfect' },
        { type: 'text', key: 'praise_impressive' },
        { type: 'text', key: 'praise_brilliant' },
        { type: 'text', key: 'praise_outstanding' },
        { type: 'text', key: 'praise_superb' },
        { type: 'text', key: 'praise_terrific' },
        { type: 'text', key: 'praise_wonderful' },
        { type: 'text', key: 'praise_spectacular' },
        { type: 'text', key: 'praise_magnificent' },
        { type: 'text', key: 'praise_phenomenal' },
        { type: 'text', key: 'praise_incredible' }
    ],
    images: [
        { type: 'image', content: verygood01 },
        { type: 'image', content: verygood02 },
        { type: 'image', content: verygood03 }
    ]
};

export default function getRandomPraise(category = 'general', lang = 'en') {
    // If general, pool both text and images to ensure variety
    let praiseList;
    if (category === 'general') {
        praiseList = [...praiseData.general, ...praiseData.images];
    } else {
        praiseList = praiseData[category] || praiseData['general'];
    }

    const randomIndex = Math.floor(Math.random() * praiseList.length);
    const selected = praiseList[randomIndex];

    if (selected.type === 'image') {
        console.log(`[Praise] Selected type: image, content: ${selected.content}`);
        return selected;
    }

    const bilingual = Strings.getBilingual(selected.key, lang);
    console.log(`[Praise] Selected type: ${selected.type}, key: ${selected.key}, lang: ${lang}`);
    return {
        ...selected,
        text: "👍👍 " + bilingual.english,
        translation: bilingual.localized,
        translationLang: bilingual.localized ? bilingual.lang : undefined
    };
}