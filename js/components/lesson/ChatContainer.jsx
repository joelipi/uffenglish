import React from 'react';
import { createPortal } from 'react-dom';
import ChatInterface from '../chat/ChatInterface.jsx';

export default function ChatContainer() {
    const chatRootEl = document.getElementById('react-root-chat');

    return (
        <div className="react-lesson-chat">
            {chatRootEl && createPortal(<ChatInterface />, chatRootEl)}
        </div>
    );
}
