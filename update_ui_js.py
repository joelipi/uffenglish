import re

with open("js/components/ui.js", "r") as f:
    content = f.read()

# Add getFirstName helper
if "export function getFirstName" not in content:
    content = """import { State } from '../modules/state.js';
""" + content

    get_first_name_helper = """
export function getFirstName(displayName) {
    if (!displayName) return "User";
    return displayName.split(' ')[0];
}
"""
    content = content.replace("export function flashElement", get_first_name_helper + "\nexport function flashElement")


# 1. Update renderUserResponse
render_user_response_orig = """export function renderUserResponse(text, statsHtml = "") {
    const safeText = escapeHTML(text);
    const html = `
        <div class='userResponse chat-bubble-sent chat-msg'>${safeText}</div>
        ${statsHtml}`;
    safeRenderChatInterface(false, html);
}"""

render_user_response_new = """export function renderUserResponse(text, statsHtml = "") {
    const safeText = escapeHTML(text);
    const userName = getFirstName(State.userData?.display_name);
    const userAvatarUrl = State.userData?.profilepicurl || 'assets/img/teacherprofile.png';
    const html = `
        <div class='chat-message-wrapper user-message-wrapper'>
            <div class='userResponse chat-bubble-sent chat-msg'>
                <div class='chat-bubble-header'>~ ${userName}</div>
                ${safeText}
            </div>
            <img src='${userAvatarUrl}' alt='${userName}' class='chat-avatar-inline' />
        </div>
        ${statsHtml}`;
    safeRenderChatInterface(false, html);
}"""
content = content.replace(render_user_response_orig, render_user_response_new)

# 2. Update renderAIAnalysisLoading
render_ai_orig = """export function renderAIAnalysisLoading(text) {
    const defaultText = Strings.get('ai_analyzing', State.userData?.native_language);
    const displayText = text || defaultText;
    const html = `
        <div class='chat-bubble chat-msg' id='ai-loading-status'>
            <strong><span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> ${displayText}</strong>
        </div>`;
    safeRenderChatInterface(true, html);
}"""

render_ai_new = """export function renderAIAnalysisLoading(text) {
    const defaultText = Strings.get('ai_analyzing', State.userData?.native_language);
    const displayText = text || defaultText;
    const aiAvatarUrl = 'assets/img/ai-avatar.png'; // Use a default AI avatar
    const html = `
        <div class='chat-message-wrapper ai-message-wrapper' id='ai-loading-status'>
            <img src='${aiAvatarUrl}' alt='AI' class='chat-avatar-inline' />
            <div class='chat-bubble chat-msg'>
                <div class='chat-bubble-header'>FluIntel AI</div>
                <strong><span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> ${displayText}</strong>
            </div>
        </div>`;
    safeRenderChatInterface(true, html);
}"""
content = content.replace(render_ai_orig, render_ai_new)

# 3. Update createPragmaticsBubbleHTML
pragmatics_orig = """export function createPragmaticsBubbleHTML(headingHTML, contentHTML, correctionHTML = "") {
    return `<div class='chat-bubble chat-msg' style='margin-top: 12px; display: block;'>
        ${headingHTML ? headingHTML : ''}
        ${contentHTML}
        ${correctionHTML ? `<div style="margin-top: 6px; font-weight: bold; color: #17a2b8;">${correctionHTML}</div>` : ''}
    </div>`;
}"""

pragmatics_new = """export function createPragmaticsBubbleHTML(headingHTML, contentHTML, correctionHTML = "", botName = "Pragmatics Bot", avatarUrl = "assets/img/ai-avatar.png") {
    return `
        <div class='chat-message-wrapper ai-message-wrapper' style='margin-top: 12px;'>
            <img src='${avatarUrl}' alt='${botName}' class='chat-avatar-inline' />
            <div class='chat-bubble chat-msg' style='display: block;'>
                <div class='chat-bubble-header'>${botName}</div>
                ${headingHTML ? headingHTML : ''}
                ${contentHTML}
                ${correctionHTML ? `<div style="margin-top: 6px; font-weight: bold; color: #17a2b8;">${correctionHTML}</div>` : ''}
            </div>
        </div>`;
}"""
content = content.replace(pragmatics_orig, pragmatics_new)


# 4. Update createStatsBubbleHTML
stats_orig = """export function createStatsBubbleHTML(header, statsParts) {
    const listHtml = statsParts && statsParts.length > 0 ? `<ul>${statsParts.map(part => `<li>${part}</li>`).join('')}</ul>` : '';
    return `
        <div class='chat-bubble chat-msg' style='margin-bottom: 12px; display: block; border-left: 4px solid #17a2b8;'>
            ${createHeaderHTML(header)}
            ${listHtml}
        </div>`;
}"""

stats_new = """export function createStatsBubbleHTML(header, statsParts, botName = "Stats Bot", avatarUrl = "assets/img/ai-avatar.png") {
    const listHtml = statsParts && statsParts.length > 0 ? `<ul>${statsParts.map(part => `<li>${part}</li>`).join('')}</ul>` : '';
    return `
        <div class='chat-message-wrapper ai-message-wrapper' style='margin-bottom: 12px;'>
            <img src='${avatarUrl}' alt='${botName}' class='chat-avatar-inline' />
            <div class='chat-bubble chat-msg' style='display: block; border-left: 4px solid #17a2b8;'>
                <div class='chat-bubble-header'>${botName}</div>
                ${createHeaderHTML(header)}
                ${listHtml}
            </div>
        </div>`;
}"""
content = content.replace(stats_orig, stats_new)

# 5. Update createGrammarDiffHTML
grammar_orig = """export function createGrammarDiffHTML(original, correction, headingText = "") {
    const { userHTML, corrHTML } = buildGrammarDiff(original, correction);
    return `
        <div class='chat-bubble chat-msg' style='margin-top: 12px; display: block;'>
            ${createHeaderHTML(headingText)}
            <div class="diff-del-bubble">${userHTML}</div>
            <div style="margin-top:6px">${corrHTML}</div>
        </div>`;
}"""

grammar_new = """export function createGrammarDiffHTML(original, correction, headingText = "", botName = "Grammar Bot", avatarUrl = "assets/img/ai-avatar.png") {
    const { userHTML, corrHTML } = buildGrammarDiff(original, correction);
    return `
        <div class='chat-message-wrapper ai-message-wrapper' style='margin-top: 12px;'>
            <img src='${avatarUrl}' alt='${botName}' class='chat-avatar-inline' />
            <div class='chat-bubble chat-msg' style='display: block;'>
                <div class='chat-bubble-header'>${botName}</div>
                ${createHeaderHTML(headingText)}
                <div class="diff-del-bubble">${userHTML}</div>
                <div style="margin-top:6px">${corrHTML}</div>
            </div>
        </div>`;
}"""
content = content.replace(grammar_orig, grammar_new)


# 6. Update renderTutorMessage
tutor_msg_orig = """export function renderTutorMessage(text, isUser) {
    if (isUser) {
        renderUserResponse(text);
    } else {
        const safeText = escapeHTML(text);
        const html = `<div class='chat-bubble chat-msg'>${safeText}</div>`;
        safeRenderChatInterface(true, html);
    }
}"""

tutor_msg_new = """export function renderTutorMessage(text, isUser) {
    if (isUser) {
        renderUserResponse(text);
    } else {
        const safeText = escapeHTML(text);
        const aiAvatarUrl = 'assets/img/ai-avatar.png'; // Default tutor avatar
        const html = `
            <div class='chat-message-wrapper ai-message-wrapper'>
                <img src='${aiAvatarUrl}' alt='Tutor' class='chat-avatar-inline' />
                <div class='chat-bubble chat-msg'>
                    <div class='chat-bubble-header'>Tutor</div>
                    ${safeText}
                </div>
            </div>`;
        safeRenderChatInterface(true, html);
    }
}"""
content = content.replace(tutor_msg_orig, tutor_msg_new)

with open("js/components/ui.js", "w") as f:
    f.write(content)
