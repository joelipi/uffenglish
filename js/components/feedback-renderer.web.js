// --- components/feedback-renderer.web.js ---
// Web-specific: converts feedback data structures (from feedback-builder.js) into HTML strings.
// React Native would have a feedback-renderer.native.jsx counterpart using <View>/<Text>.

import { appStore } from '../modules/store.js';
import Strings from '../data/strings.js';

/**
 * Internal HTML Utilities for Feedback Bubbles
 */

function createHeaderHTML(text) {
    if (!text) return "";
    return `<div style="font-size: 0.85em; text-transform: uppercase; color: #17a2b8; margin-bottom: 5px;"><strong>${text}</strong></div>`;
}

function createPragmaticsBubbleHTML(headingHTML, contentHTML, correctionHTML = "", botName = "Joe Walsh", avatarUrl = "/assets/img/teacherprofile.webp") {
    return `
        <div class="chat-message-row chat-message-row--system" style="margin-bottom: 0px;">
            <img src="${avatarUrl}" alt="${botName}" class="chat-avatar-inline" />
            <div class="chat-message-bubble chat-message-bubble--system" style="border-left: 4px solid #ffc107;">
                <div class="chat-bubble-header">${botName}</div>
                ${headingHTML ? headingHTML : ''}
                <div class="chat-message-content">${contentHTML}</div>
                ${correctionHTML ? `<div class="chat-message-correction">${correctionHTML}</div>` : ''}
            </div>
        </div>`;
}

function createStatsBubbleHTML(header, statsParts, botName = "Joe Walsh", avatarUrl = "/assets/img/teacherprofile.webp") {
    const statsHtml = statsParts.map(part => `<div>${part}</div>`).join('');
    return `
        <div class="chat-message-row chat-message-row--system" style="margin-bottom: 0px;">
            <img src="${avatarUrl}" alt="${botName}" class="chat-avatar-inline" />
            <div class="chat-message-bubble chat-message-bubble--system" style="border-left: 4px solid #17a2b8;">
                <div class="chat-bubble-header">${botName}</div>
                <span>${header}</span>
                <div class="chat-message-content">${statsHtml}</div>
            </div>
        </div>`;
}

function buildGrammarDiff(original, corrected) {
    // Simple LCS-based diff for highlighting insertions/deletions
    const tokensA = original.split(/(\s+)/);
    const tokensB = corrected.split(/(\s+)/);
    const m = tokensA.length, n = tokensB.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++)
            dp[i][j] = tokensA[i - 1] === tokensB[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);

    const result = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && tokensA[i - 1] === tokensB[j - 1]) {
            result.unshift({ type: 'eq', val: tokensA[i - 1] });
            i--; j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            result.unshift({ type: 'ins', val: tokensB[j - 1] });
            j--;
        } else {
            result.unshift({ type: 'del', val: tokensA[i - 1] });
            i--;
        }
    }
    return result;
}

function createGrammarDiffHTML(original, corrected, headingText = "", botName = "Joe Walsh", avatarUrl = "/assets/img/teacherprofile.webp") {
    const diff = buildGrammarDiff(original, corrected);
    let diffHtml = '';
    diff.forEach(token => {
        if (token.type === 'eq') diffHtml += token.val;
        else if (token.type === 'ins') diffHtml += `<span class="diff-ins">${token.val}</span>`;
        else if (token.type === 'del') diffHtml += `<span class="diff-del">${token.val}</span>`;
    });

    return `
        <div class="chat-message-row chat-message-row--system" style="margin-bottom: 0px;">
            <img src="${avatarUrl}" alt="${botName}" class="chat-avatar-inline" />
            <div class="chat-message-bubble chat-message-bubble--system" style="border-left: 4px solid #dc3545;">
                <div class="chat-bubble-header">${headingText}</div>
                <div class="chat-message-content">${diffHtml}</div>
            </div>
        </div>`;
}

export function getPraiseHTML(praiseData) {
    if (!praiseData) return "";
    if (typeof praiseData === 'string') return praiseData;
    if (typeof praiseData === 'object' && praiseData.type === 'image') {
        return `<img src="${praiseData.content}" alt="Praise" class="praise-image" style="max-width: 200px; border-radius: 8px; display: block; margin: 10px auto;">`;
    }
    if (typeof praiseData === 'object' && praiseData.text) {
        return praiseData.text;
    }
    return "";
}

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
                const diffTokens = buildGrammarDiff(section.diff.original, section.diff.corrected);
                let userHTML = '', corrHTML = '';
                const isPunct = tok => /^[^\p{L}\p{N}]+$/u.test(tok);
                diffTokens.forEach(({ type, val }) => {
                    const v = val.replace(/</g, '&lt;');
                    if (type === 'eq') { userHTML += v; corrHTML += v; }
                    else if (type === 'del') {
                        if (isPunct(val)) { userHTML += v; }
                        else { userHTML += `<span class="diff-del">${v}</span>`; }
                    }
                    else if (type === 'ins') {
                        if (isPunct(val)) { corrHTML += v; }
                        else { corrHTML += `<span class="diff-ins">${v}</span>`; }
                    }
                });
                grammarDiffHtml = `<div class="diff-del-bubble">${userHTML}</div><div style="margin-top:6px">${corrHTML}</div>`;
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