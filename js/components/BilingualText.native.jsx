/**
 * BilingualText Component for React Native (Expo)
 *
 * Renders bilingual text with English and localized versions.
 * Uses the platform-agnostic `formatBilingualText` utility.
 */

import React from 'react';
import { Text } from 'react-native';
import { formatBilingualText } from '../../modules/bilingual/bilingual-display.js';

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
        shouldShowLocalized,
    } = formatBilingualText(translationData, userLang, {
        enPrefix,
        enSuffix,
        spanPrefix,
        skipEnglish
    });

    if (skipEnglish) {
        return localized ? <Text>{localized}</Text> : null;
    }

    if (!shouldShowLocalized) {
        return <Text>{english}</Text>;
    }

    return (
        <Text>
            {enPrefix}{english}{enSuffix}
            <Text>{spanPrefix}{localized}</Text>
        </Text>
    );
};
