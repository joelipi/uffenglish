import { readFileSync } from 'fs';
const content = readFileSync('js/components/ui.js', 'utf8');
if (content.includes("class='chat-message-wrapper user-message-wrapper'") &&
    content.includes("class='chat-avatar-inline'") &&
    content.includes("class='chat-bubble-header'")) {
    console.log("ui.js structure verified.");
} else {
    console.log("ui.js structure missing!");
}
