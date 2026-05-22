import React from 'react';
import { createPortal } from 'react-dom';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';

export default function ChatHeader() {
    const userFirstName = useStore(appStore, (state) => state.userFirstName);
    const headerText = userFirstName ? `${userFirstName}'s Fluency Team` : 'Your Fluency Team';

    const headerRootEl = document.getElementById('chat-window-header');

    return headerRootEl ? createPortal(
        <div className="card-header text-white p-0 chat-window-header">
            {headerText}
        </div>,
        headerRootEl
    ) : null;
}