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
 * Returns "💯" when score is 100, otherwise "N%" (e.g. "87%").
 */
function formatScore(score) {
    return score === 100 ? '<strong>💯</strong>' : `<strong>${score}%</strong>`;
}

/**
 * Renders feedback section descriptors (from buildFeedbackData) as an array of HTML strings.
 * @param {{ sections: Array<Object> }} feedbackData - Output from buildFeedbackData()
 * @returns {string[]} Array of HTML strings ready for renderAIFeedback()
 */
export function renderFeedbackToHTML(feedbackData) {
    const { sections } = feedbackData;
    return sections.map(section => {
        // Grammar section: bot name + inline stats + diff
        if (section.type === 'grammar') {
            const scoreDisplay = formatScore(section.score);
            const errorText = `${section.errorCount} error${section.errorCount !== 1 ? 's' : ''}`;
            const complexityText = section.complexityScore !== null && section.complexityScore !== undefined
                ? `. ${section.complexityScore}% complexity` : '';
            const statsLine = `${scoreDisplay} &nbsp;·&nbsp; ${errorText}${complexityText}`;

            let grammarDiffHtml = '';
            if (section.diff) {
                const fullDiffHTML = createGrammarDiffHTML(section.diff.original, section.diff.corrected, '');
                const match = fullDiffHTML.match(/<div class="diff-del-bubble">[\s\S]*?<\/div>\s*<div style="margin-top:6px">[\s\S]*?<\/div>/);
                if (match) {
                    grammarDiffHtml = match[0];
                }
            }

            return `
                <div class="chat-message-row chat-message-row--system" style="margin-bottom: 0px;">
                    <img src="/assets/img/grammarbot.webp" alt="Grammar" class="chat-avatar-inline" />
                    <div class="chat-message-bubble chat-message-bubble--system" style="border-left: 4px solid #17a2b8;">
                        <div class="chat-bubble-header">Grammar</div>
                        <span>${statsLine}</span>
                        ${grammarDiffHtml}
                    </div>
                </div>`;
        }

        // Build the compact header line: score (💯 or N%) + attempt/repetition label + count (if applicable)
        let headerLine = formatScore(section.score);
        if (section.attemptLabel && section.attemptCount !== undefined) {
            headerLine += ` &nbsp;·&nbsp; ${section.attemptLabel} ${section.attemptCount}`;
        }

        // Flow: single inline line "Xms hesitation. Y wpm."
        if (section.key === 'flow') {
            const hesitation = section.parts.find(p => p.label && p.value !== undefined && String(p.value).includes('ms'));
            const wpm = section.parts.find(p => p.label && !String(p.value).includes('ms') && !p.message && !p.idioms);
            const flowLine = [
                hesitation ? `${hesitation.value} hesitation` : null,
                wpm ? `${wpm.value} wpm` : null
            ].filter(Boolean).join('. ') + '.';
            const botInfo = { name: 'Flow', avatar: '/assets/img/flowbot.webp' };
            return createStatsBubbleHTML(formatScore(section.score), [flowLine], botInfo.name, botInfo.avatar);
        }

        // Vocab: "N idioms" + found list
        if (section.key === 'vocabulary') {
            const vocabPart = section.parts[0];
            const htmlParts = [];
            htmlParts.push(`${vocabPart.idiomCount} idioms`);
            if (vocabPart.idioms && vocabPart.idioms.length > 0) {
                const listItems = vocabPart.idioms.map(i => `<li><em>${i}</em></li>`).join('');
                htmlParts.push(`<ul>${listItems}</ul>`);
            }
            const botInfo = { name: 'Vocabulary', avatar: '/assets/img/vocabularybot.webp' };
            return createStatsBubbleHTML(formatScore(section.score), htmlParts, botInfo.name, botInfo.avatar);
        }

        // Render parts (generic)
        const htmlParts = (section.parts || []).map(p => {
            if (p.type === 'notice') return `<span class="limitation-notice">${p.message}</span>`;
            if (p.message) return p.message;
            return `<strong>${p.label}:</strong> ${p.value}`;
        });

        const botInfo = (() => {
            switch (section.key) {
                case 'grammar': return { name: 'Grammar', avatar: '/assets/img/grammarbot.webp' };
                case 'vocabulary': return { name: 'Vocabulary', avatar: '/assets/img/vocabularybot.webp' };
                case 'flow': return { name: 'Flow', avatar: '/assets/img/flowbot.webp' };
                case 'pronunciation': return { name: 'Pronunciation', avatar: '/assets/img/pronunciationbot.webp' };
                case 'listening': return { name: 'Listening', avatar: '/assets/img/listeningbot.webp' };
                case 'formality': return { name: 'Formality', avatar: '/assets/img/formalitybot.webp' };
                case 'nativeLike': return { name: 'Smoothness', avatar: '/assets/img/smoothnessbot.webp' };
                case 'understanding': return { name: 'Understanding', avatar: '/assets/img/understandingbot.webp' };
                case 'fluency': return { name: 'Joe Walsh', avatar: '/assets/img/teacherprofile.webp' };
                default: return { name: 'FluIntel AI', avatar: '/assets/img/ai.webp' };
            }
        })();

        // isOverall (fluency) renders bold with "Fluency" label, all others plain
        const displayHeader = section.isOverall ? `<strong>${headerLine} Fluency</strong>` : headerLine;
        return createStatsBubbleHTML(displayHeader, htmlParts, botInfo.name, botInfo.avatar);
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