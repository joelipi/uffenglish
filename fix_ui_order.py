import re

with open('js/components/ui.js', 'r') as f:
    content = f.read()

content = content.replace('''        <div class='chat-message-wrapper user-message-wrapper'>
            <div class='userResponse chat-bubble-sent chat-msg'>
                <div class='chat-bubble-header'>~ ${userName}</div>
                ${safeText}
            </div>
            <img src='${userAvatarUrl}' alt='${userName}' class='chat-avatar-inline' />
        </div>''', '''        <div class='chat-message-wrapper user-message-wrapper'>
            <img src='${userAvatarUrl}' alt='${userName}' class='chat-avatar-inline' />
            <div class='userResponse chat-bubble-sent chat-msg'>
                <div class='chat-bubble-header'>~ ${userName}</div>
                ${safeText}
            </div>
        </div>''')

with open('js/components/ui.js', 'w') as f:
    f.write(content)
