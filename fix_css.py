import re

with open("style.css", "r") as f:
    content = f.read()

# Add the new flexbox classes for chat bubbles
new_classes = """

/* WhatsApp style chat bubble container */
.chat-message-wrapper {
  display: flex;
  align-items: flex-end;
  margin-bottom: 12px;
  max-width: 100%;
}

/* User aligns right, AI aligns left */
.user-message-wrapper {
  flex-direction: row-reverse;
  justify-content: flex-start;
}

.ai-message-wrapper {
  flex-direction: row;
  justify-content: flex-start;
}

.chat-avatar-inline {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
  margin: 0 8px;
  flex-shrink: 0;
}

.chat-bubble-header {
  font-size: 0.8em;
  font-weight: bold;
  color: #17a2b8; /* Same color as header strings */
  margin-bottom: 4px;
  opacity: 0.8;
}

/* Override existing margins from previous design since wrapper handles it */
.chat-message-wrapper .chat-bubble,
.chat-message-wrapper .chat-bubble-sent {
  margin-bottom: 0 !important;
  margin-top: 0 !important;
}

"""

if ".chat-message-wrapper {" not in content:
    content += new_classes

# Modify original .chat-bubble max-width so they fit nicely with the avatar
content = content.replace("max-width: 85%;", "max-width: 80%;")

with open("style.css", "w") as f:
    f.write(content)
