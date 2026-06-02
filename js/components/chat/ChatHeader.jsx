import React from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';

export default function ChatHeader() {
    const userFirstName = useStore(appStore, (state) => state.userFirstName);
    const headerText = userFirstName ? `${userFirstName}'s Fluency Team` : 'Your Fluency Team';

    return (
        <div className="card-header text-white p-0 chat-window-header">
            {headerText}
        </div>
    );
}
