// --- modules/feedback-renderer-web.js ---
// Web-specific: converts feedback data structures (from feedback-builder.js) into HTML strings.
// React Native would have a feedback-renderer.native.jsx counterpart using <View>/<Text>.

import {
    createStatsBubbleHTML,
    createGrammarDiffHTML,
    createHeaderHTML,
    createPragmaticsBubbleHTML
} from '../components/ui.js';

/**
 * Renders feedback section descriptors (from buildFeedbackData) as an array of HTML strings.
 * @param {{ sections: Array<Object> }} feedbackData - Output from buildFeedbackData()
 * @returns {string[]} Array of HTML strings ready for renderAIFeedback()
 */
export function renderFeedbackToHTML(feedbackData) {
    const { sections } = feedbackData;
    return sections.map(section => {
        // Grammar section has a custom layout with embedded diff
        if (section.type === 'grammar') {
            const grammarParts = section.parts.map(p => `<strong>${p.label}:</strong> ${p.value}`);
            const grammarHeader = createHeaderHTML(section.header);
            const grammarListHtml = grammarParts.length > 0
                ? `<ul>${grammarParts.map(p => `<li>${p}</li>`).join('')}</ul>`
                : '';

            let grammarDiffHtml = '';
            if (section.diff) {
                grammarDiffHtml = createGrammarDiffHTML(section.diff.original, section.diff.corrected, '')
                    .replace(/^<div class='chat-bubble chat-msg'[^>]*>/, '')
                    .replace(/<\/div>$/, '');
            }

            return `
                <div class='chat-bubble chat-msg' style='margin-bottom: 12px; display: block; border-left: 4px solid #17a2b8;'>
                    ${grammarHeader}
                    ${grammarListHtml}
                    ${grammarDiffHtml}
                </div>`;
        }

        // Standard stat bubble
        const htmlParts = section.parts.map(p => {
            // Feedback messages (formality, native-like, understanding)
            if (p.message) return p.message;
            // Idiom list with <em> wrapping
            if (p.idioms) return `<strong>${p.label}:</strong> ${p.idioms.map(i => `<em>${i}</em>`).join(', ')}`;
            // Standard label:value
            return `<strong>${p.label}:</strong> ${p.value}`;
        });

        // Overall fluency gets bold header
        if (section.isOverall) {
            return createStatsBubbleHTML(`<strong>${section.header}</strong>`, []);
        }

        return createStatsBubbleHTML(section.header, htmlParts);
    });
}

/**
 * Renders explanation data descriptors (from buildExplanationData) as HTML strings.
 * @param {{ chunks: Array<Object>, useFallback: boolean, fallback: * }} explanationData
 * @returns {Array} Array of HTML strings, or the raw fallback
 */
export function renderExplanationsToHTML(explanationData) {
    const { chunks, useFallback, fallback } = explanationData;

    if (useFallback) {
        return fallback;
    }

    return chunks.map(chunk => {
        switch (chunk.type) {
            case 'raw':
                return chunk.content;
            case 'message':
                return chunk.content;
            case 'pragmatics':
                return createPragmaticsBubbleHTML(
                    createHeaderHTML(chunk.header),
                    chunk.message,
                    chunk.correction
                );
            case 'unknown':
                console.warn(`[FeedbackRenderer] Unhandled chunk type:`, chunk.raw);
                return '';
            default:
                return '';
        }
    }).filter(Boolean);
}
