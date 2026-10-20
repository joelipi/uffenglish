import React from 'react';
import { BilingualText } from './BilingualText.jsx';
import { strings } from '../data/strings.js';

// A UI string rendered the way the topic names are: the English copy first,
// the learner's language after it. A key with no entry in the table renders
// nothing (the caller should then use `Strings.get`).
export default function BilingualString({ stringKey, lang = 'en' }) {
    const entry = strings[stringKey];
    if (!entry) return null;
    return <BilingualText translationData={entry} userLang={lang} spanPrefix=" " />;
}
