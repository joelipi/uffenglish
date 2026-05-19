import React from 'react';
import { createRoot } from 'react-dom/client';
import { appStore } from './modules/store.js';

console.log('[React Entry] Initializing React Entry Point');

const ChatRoot = () => <></>;
const StatsRoot = () => <></>;

const chatRootEl = document.getElementById('react-root-chat');
if (chatRootEl) {
    console.log('[React Entry] Mounting ChatRoot');
    const root = createRoot(chatRootEl);
    root.render(
        <React.StrictMode>
            <ChatRoot />
        </React.StrictMode>
    );
}

const statsRootEl = document.getElementById('react-root-stats');
if (statsRootEl) {
    console.log('[React Entry] Mounting StatsRoot');
    const root = createRoot(statsRootEl);
    root.render(
        <React.StrictMode>
            <StatsRoot />
        </React.StrictMode>
    );
}
