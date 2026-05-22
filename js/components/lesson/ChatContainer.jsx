import React from 'react';
import { createPortal } from 'react-dom';
import ChatInterface from '../chat/ChatInterface.jsx';
import ChatHeader from '../chat/ChatHeader.jsx';

export default function ChatContainer() {
    const chatRootEl = document.getElementById('react-root-chat');
    const headerRootEl = document.getElementById('chat-window-header');

    return (
        <div className="react-lesson-chat">
            {headerRootEl && createPortal(<ChatHeader />, headerRootEl)}
            {chatRootEl && createPortal(<ChatInterface />, chatRootEl)}
        </div>
    );
}
