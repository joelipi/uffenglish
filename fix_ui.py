import re

with open('js/components/ui.js', 'r') as f:
    content = f.read()

# Fix renderUserResponse
content = re.sub(
    r'<div class="chat-message-content">\s*<div class="chat-bubble-header">\$\{firstName\}</div>\s*<div class="chat-bubble-sent mt-2"([^>]*)>(.*?)</div>\s*</div>',
    r'<div class="chat-message-content">\n            <div class="chat-bubble-sent mt-2"\1>\n                <div class="chat-bubble-header" style="font-weight: bold; font-size: 0.85em; color: #dcf8c6; filter: invert(0.2); margin-bottom: 4px;">${firstName}</div>\n                \2\n            </div>\n        </div>',
    content,
    flags=re.DOTALL
)

# Fix AI bubbles - we have several
# find all instances of <div class="chat-bubble-header">${botName}</div> \n <div class="chat-bubble...
def replace_ai_bubble(m):
    header = m.group(1)
    bubble_class = m.group(2)
    bubble_attrs = m.group(3)
    bubble_content = m.group(4)
    # Put header inside bubble
    new_header = f'<div class="chat-bubble-header" style="font-weight: bold; font-size: 0.85em; color: #128C7E; margin-bottom: 4px;">{header}</div>'
    return f'<div class="chat-message-content">\n        <div class="{bubble_class}"{bubble_attrs}>\n            {new_header}\n            {bubble_content}\n        </div>\n    </div>'

content = re.sub(
    r'<div class="chat-message-content">\s*<div class="chat-bubble-header">(.*?)</div>\s*<div class="(chat-bubble[^"]*)"([^>]*)>(.*?)</div>\s*</div>',
    replace_ai_bubble,
    content,
    flags=re.DOTALL
)

with open('js/components/ui.js', 'w') as f:
    f.write(content)
