import React from 'react';
import ChatInterface from '../chat/ChatInterface.jsx';
import ChatHeader from '../chat/ChatHeader.jsx';
import TutorChatInput from '../widgets/TutorChatInput.jsx';

export default function ChatContainer() {
    return (
        <div className="react-lesson-chat">
            <ChatHeader />
            <ChatInterface />
            <TutorChatInput />
        </div>
    );
}
