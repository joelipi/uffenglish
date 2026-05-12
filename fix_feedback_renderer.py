import re

with open("js/components/feedback-renderer.web.js", "r") as f:
    content = f.read()

# Update the manual grammar bubble rendering to use the new layout logic
# and update the createStatsBubbleHTML calls to pass names/avatars.

def get_bot_details(key_str):
    return f"""(() => {{
        switch ({key_str}) {{
            case 'grammar': return {{ name: 'Grammar Bot', avatar: 'assets/img/ai-avatar.png' }};
            case 'vocabulary': return {{ name: 'Vocabulary Bot', avatar: 'assets/img/ai-avatar.png' }};
            case 'flow': return {{ name: 'Flow Bot', avatar: 'assets/img/ai-avatar.png' }};
            case 'pronunciation': return {{ name: 'Pronunciation Bot', avatar: 'assets/img/ai-avatar.png' }};
            case 'listening': return {{ name: 'Listening Bot', avatar: 'assets/img/ai-avatar.png' }};
            case 'formality': return {{ name: 'Formality Bot', avatar: 'assets/img/ai-avatar.png' }};
            case 'nativeLike': return {{ name: 'Idiom Bot', avatar: 'assets/img/ai-avatar.png' }};
            case 'understanding': return {{ name: 'Pragmatics Bot', avatar: 'assets/img/ai-avatar.png' }};
            case 'fluency': return {{ name: 'Fluency Bot', avatar: 'assets/img/ai-avatar.png' }};
            default: return {{ name: 'FluIntel AI', avatar: 'assets/img/ai-avatar.png' }};
        }}
    }})()"""


# Fix grammar manual block
grammar_block_orig = """            let grammarDiffHtml = '';
            if (section.diff) {
                grammarDiffHtml = createGrammarDiffHTML(section.diff.original, section.diff.corrected, '')
                    .replace(/^<div class='chat-bubble chat-msg'[^>]*>/, '')
                    .replace(/<\\/div>$/, '');
            }

            return `
                <div class='chat-bubble chat-msg' style='margin-bottom: 12px; display: block; border-left: 4px solid #17a2b8;'>
                    ${grammarHeader}
                    ${grammarListHtml}
                    ${grammarDiffHtml}
                </div>`;"""

# We'll just replace the return block and keep diff extraction or just use the wrapper
grammar_block_new = """            let grammarDiffHtml = '';
            if (section.diff) {
                // we only want the inner part of diff
                grammarDiffHtml = `
                <div class="diff-del-bubble">${buildGrammarDiff(section.diff.original, section.diff.corrected).userHTML}</div>
                <div style="margin-top:6px">${buildGrammarDiff(section.diff.original, section.diff.corrected).corrHTML}</div>
                `;
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
                </div>`;"""

# We need to import buildGrammarDiff but it's not exported. Let's just use createGrammarDiffHTML and strip the outer wrappers using DOM parser or regex. Actually the original regex stripped the outer wrapper, but now the outer wrapper is chat-message-wrapper. Let's adapt the regex.

grammar_block_new_regex = """            let grammarDiffHtml = '';
            if (section.diff) {
                // createGrammarDiffHTML returns a wrapper now, so we need to extract just the diff parts
                // The easiest way is to let the diff logic reside inside the bubble.
                // We'll just do a dirty regex to extract the inner content of the bubble.
                const fullDiffHTML = createGrammarDiffHTML(section.diff.original, section.diff.corrected, '');
                const match = fullDiffHTML.match(/<div class="diff-del-bubble">[\\s\\S]*?<\\/div>\\s*<div style="margin-top:6px">[\\s\\S]*?<\\/div>/);
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
                </div>`;"""

content = content.replace(grammar_block_orig, grammar_block_new_regex)

# Fix createStatsBubbleHTML calls
overall_fluency_orig = """        if (section.isOverall) {
            return createStatsBubbleHTML(`<strong>${section.header}</strong>`, []);
        }

        return createStatsBubbleHTML(section.header, htmlParts);"""

overall_fluency_new = """        const botInfo = (() => {
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

        return createStatsBubbleHTML(section.header, htmlParts, botInfo.name, botInfo.avatar);"""

content = content.replace(overall_fluency_orig, overall_fluency_new)

with open("js/components/feedback-renderer.web.js", "w") as f:
    f.write(content)
