// --- components/feedback-renderer.web.js ---
// Web-specific: converts feedback data structures (from feedback-builder.js) into HTML strings.
// React Native would have a feedback-renderer.native.jsx counterpart using <View>/<Text>.

import {
    createStatsBubbleHTML,
    createGrammarDiffHTML,
    createHeaderHTML,
    createPragmaticsBubbleHTML
} from './ui.js';

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
                // createGrammarDiffHTML returns a wrapper now, so we need to extract just the diff parts
                // The easiest way is to let the diff logic reside inside the bubble.
                // We'll just do a dirty regex to extract the inner content of the bubble.
                const fullDiffHTML = createGrammarDiffHTML(section.diff.original, section.diff.corrected, '');
                const match = fullDiffHTML.match(/<div class="diff-del-bubble">[\s\S]*?<\/div>\s*<div style="margin-top:6px">[\s\S]*?<\/div>/);
                if (match) {
                    grammarDiffHtml = match[0];
                }
            }

            return `
                <div class='chat-message-wrapper ai-message-wrapper' style='margin-bottom: 12px;'>
                    <img src='assets/img/ai-avatar.png' alt='Grammar Bot' class='chat-avatar-inline' />
                    <div class='chat-bubble chat-msg' style='display: block; border-left: 4px solid #17a2b8;'>
                        <div class='chat-bubble-header'>Grammar Bot</div>
                        ${grammarHeader}
                        ${grammarListHtml}
                        ${grammarDiffHtml}
                    </div>
                </div>`;
        }

        // Standard stat bubble
        const htmlParts = section.parts.map(p => {
            // Limitation notices (demo mode)
            if (p.type === 'notice') return `<span class="limitation-notice">${p.message}</span>`;
            // Feedback messages (formality, native-like, understanding)
            if (p.message) return p.message;
            // Idiom list with <em> wrapping
            if (p.idioms) {
                const count = p.idioms.length;
                const listItems = p.idioms.map(i => `<li><em>${i}</em></li>`).join('');
                return `<strong>${p.label} (${count}):</strong><ul>${listItems}</ul>`;
            }
            // Standard label:value
            return `<strong>${p.label}:</strong> ${p.value}`;
        });

        // Overall fluency gets bold header
        const botInfo = (() => {
            switch (section.key) {
                case 'grammar': return { name: 'Grammar Bot', avatar: 'assets/img/ai-avatar.png' };
                case 'vocabulary': return { name: 'Vocabulary Bot', avatar: 'assets/img/ai-avatar.png' };
                case 'flow': return { name: 'Flow Bot', avatar: 'assets/img/ai-avatar.png' };
                case 'pronunciation': return { name: 'Pronunciation Bot', avatar: 'assets/img/ai-avatar.png' };
                case 'listening': return { name: 'Listening Bot', avatar: 'assets/img/ai-avatar.png' };
                case 'formality': return { name: 'Formality Bot', avatar: 'assets/img/ai-avatar.png' };
                case 'nativeLike': return { name: 'Idiom Bot', avatar: 'assets/img/ai-avatar.png' };
                case 'understanding': return { name: 'Pragmatics Bot', avatar: 'assets/img/ai-avatar.png' };
                case 'fluency': return { name: 'Fluency Bot', avatar: 'assets/img/ai-avatar.png' };
                default: return { name: 'FluIntel AI', avatar: 'assets/img/ai-avatar.png' };
            }
        })();

        if (section.isOverall) {
            return createStatsBubbleHTML(`<strong>${section.header}</strong>`, [], botInfo.name, botInfo.avatar);
        }

        return createStatsBubbleHTML(section.header, htmlParts, botInfo.name, botInfo.avatar);
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
