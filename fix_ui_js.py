import re

with open("js/components/ui.js", "r") as f:
    content = f.read()

# Update renderAIFeedback general chunks to use wrappers
# The logic iterates through chunks. We need to replace the fragment building logic.
old_render_ai_feedback = """        .forEach(chunk => {
            if (typeof chunk === 'string') {
                if (chunk.includes("chat-bubble")) {
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = chunk;
                    while (tempDiv.firstChild) {
                        fragment.appendChild(tempDiv.firstChild);
                    }
                } else {
                    const bubble = document.createElement('div');
                    bubble.className = 'chat-bubble chat-msg';
                    bubble.style.marginTop = '12px';
                    bubble.style.display = 'block';
                    bubble.innerHTML = chunk;
                    fragment.appendChild(bubble);
                }
            } else if (chunk instanceof Node) {
                // If it's already a node, ensure it has chat-bubble styling if appropriate, or just append it
                if (chunk.nodeType === Node.ELEMENT_NODE && !chunk.classList.contains('chat-msg')) {
                    // It's just a raw element, maybe we wrap it or trust the caller to have styled it.
                    // The caller might be providing a fully constructed bubble.
                    // If it doesn't have chat-bubble, we'll wrap it to maintain style.
                    const wrapper = document.createElement('div');
                    wrapper.className = 'chat-bubble chat-msg';
                    wrapper.style.marginTop = '12px';
                    wrapper.style.display = 'block';
                    wrapper.appendChild(chunk);
                    fragment.appendChild(wrapper);
                } else {
                    fragment.appendChild(chunk);
                }
            }
        });"""

new_render_ai_feedback = """        .forEach(chunk => {
            if (typeof chunk === 'string') {
                if (chunk.includes("chat-message-wrapper") || chunk.includes("chat-bubble")) {
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = chunk;
                    while (tempDiv.firstChild) {
                        fragment.appendChild(tempDiv.firstChild);
                    }
                } else {
                    const wrapper = document.createElement('div');
                    wrapper.className = 'chat-message-wrapper ai-message-wrapper';
                    wrapper.style.marginTop = '12px';

                    const img = document.createElement('img');
                    img.src = 'assets/img/ai-avatar.png';
                    img.alt = 'FluIntel AI';
                    img.className = 'chat-avatar-inline';

                    const bubble = document.createElement('div');
                    bubble.className = 'chat-bubble chat-msg';
                    bubble.style.display = 'block';
                    bubble.innerHTML = `<div class='chat-bubble-header'>FluIntel AI</div>${chunk}`;

                    wrapper.appendChild(img);
                    wrapper.appendChild(bubble);
                    fragment.appendChild(wrapper);
                }
            } else if (chunk instanceof Node) {
                if (chunk.nodeType === Node.ELEMENT_NODE && !chunk.classList.contains('chat-msg') && !chunk.classList.contains('chat-message-wrapper')) {
                    const outerWrapper = document.createElement('div');
                    outerWrapper.className = 'chat-message-wrapper ai-message-wrapper';
                    outerWrapper.style.marginTop = '12px';

                    const img = document.createElement('img');
                    img.src = 'assets/img/ai-avatar.png';
                    img.alt = 'FluIntel AI';
                    img.className = 'chat-avatar-inline';

                    const wrapper = document.createElement('div');
                    wrapper.className = 'chat-bubble chat-msg';
                    wrapper.style.display = 'block';

                    const header = document.createElement('div');
                    header.className = 'chat-bubble-header';
                    header.textContent = 'FluIntel AI';

                    wrapper.appendChild(header);
                    wrapper.appendChild(chunk);
                    outerWrapper.appendChild(img);
                    outerWrapper.appendChild(wrapper);
                    fragment.appendChild(outerWrapper);
                } else {
                    fragment.appendChild(chunk);
                }
            }
        });"""

content = content.replace(old_render_ai_feedback, new_render_ai_feedback)

with open("js/components/ui.js", "w") as f:
    f.write(content)
