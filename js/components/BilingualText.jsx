/**
 * BilingualText Component for Web (React/Vite)
 *
 * Renders bilingual text with English and localized versions.
 * Uses the platform-agnostic `formatBilingualText` utility.
 */

import React from 'react';
import { formatBilingualText } from '../modules/bilingual-display.js';

export const BilingualText = ({
    translationData,
    userLang = 'en',
    enPrefix = '',
    enSuffix = '',
    spanPrefix = ' ',
    skipEnglish = false
}) => {
    const {
        english,
        localized,
        lang,
        shouldShowLocalized,
    } = formatBilingualText(translationData, userLang, {
        enPrefix,
        enSuffix,
        spanPrefix,
        skipEnglish
    });

    if (skipEnglish) {
        return localized ? <span lang={lang}>{localized}</span> : null;
    }

    if (!shouldShowLocalized) {
        return <span>{english}</span>;
    }

    return (
        <span>
            {enPrefix}{english}{enSuffix}
            <span lang={lang}>{spanPrefix}{localized}</span>
        </span>
    );
};
