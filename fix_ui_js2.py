import re

with open("js/components/ui.js", "r") as f:
    content = f.read()

# Fix getPraiseHTML to use the new wrapper
old_praise_html = """            const praiseBubble = document.createElement('div');
            praiseBubble.classList.add('chat-bubble', 'chat-msg');
            praiseBubble.style.marginTop = '12px';
            const praiseStrong = document.createElement('strong');
            praiseStrong.innerHTML = getPraiseHTML(getRandomPraise('general', lang));
            praiseBubble.appendChild(praiseStrong);"""

new_praise_html = """            const praiseWrapper = document.createElement('div');
            praiseWrapper.className = 'chat-message-wrapper ai-message-wrapper';
            praiseWrapper.style.marginTop = '12px';

            const praiseImg = document.createElement('img');
            praiseImg.src = 'assets/img/ai-avatar.png';
            praiseImg.alt = 'FluIntel AI';
            praiseImg.className = 'chat-avatar-inline';

            const praiseBubble = document.createElement('div');
            praiseBubble.classList.add('chat-bubble', 'chat-msg');

            const praiseHeader = document.createElement('div');
            praiseHeader.className = 'chat-bubble-header';
            praiseHeader.textContent = 'FluIntel AI';
            praiseBubble.appendChild(praiseHeader);

            const praiseStrong = document.createElement('strong');
            praiseStrong.innerHTML = getPraiseHTML(getRandomPraise('general', lang));
            praiseBubble.appendChild(praiseStrong);

            praiseWrapper.appendChild(praiseImg);
            praiseWrapper.appendChild(praiseBubble);"""
content = content.replace(old_praise_html, new_praise_html)
content = content.replace("chunks.push(praiseBubble, questionData.headsUp);", "chunks.push(praiseWrapper, questionData.headsUp);")


old_correct_bubble = """            const correctBubble = document.createElement('div');
            correctBubble.classList.add('correct-answer-display', 'chat-bubble-sent', 'chat-msg');
            correctBubble.textContent = cue;"""

new_correct_bubble = """            const correctWrapper = document.createElement('div');
            correctWrapper.className = 'chat-message-wrapper ai-message-wrapper correct-answer-wrapper'; // reusing ai-message-wrapper for left alignment or user-message-wrapper for right depending on original
            // Actually the original was chat-bubble-sent which means right-aligned. Let's make it a user message style.
            correctWrapper.className = 'chat-message-wrapper user-message-wrapper correct-answer-wrapper';

            const correctImg = document.createElement('img');
            correctImg.src = State.userData?.profilepicurl || 'assets/img/teacherprofile.png';
            correctImg.alt = getFirstName(State.userData?.display_name);
            correctImg.className = 'chat-avatar-inline';

            const correctBubble = document.createElement('div');
            correctBubble.classList.add('correct-answer-display', 'chat-bubble-sent', 'chat-msg');

            const correctHeader = document.createElement('div');
            correctHeader.className = 'chat-bubble-header';
            correctHeader.textContent = '~ ' + getFirstName(State.userData?.display_name);
            correctBubble.appendChild(correctHeader);

            const correctTextSpan = document.createElement('span');
            correctTextSpan.textContent = cue;
            correctBubble.appendChild(correctTextSpan);"""

content = content.replace(old_correct_bubble, new_correct_bubble)
content = content.replace("const chunks = [correctBubble];", """            correctWrapper.appendChild(correctBubble);
            correctWrapper.appendChild(correctImg);
            const chunks = [correctWrapper];""")

with open("js/components/ui.js", "w") as f:
    f.write(content)
