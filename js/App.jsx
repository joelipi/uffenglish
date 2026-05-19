import React from 'react';
import { createPortal } from 'react-dom';

const ChatRoot = () => <></>;
const StatsRoot = () => <></>;

export default function App() {
    const chatRootEl = document.getElementById('react-root-chat');
    const statsRootEl = document.getElementById('react-root-stats');

    return (
        <>
            {chatRootEl && createPortal(<ChatRoot />, chatRootEl)}
            {statsRootEl && createPortal(<StatsRoot />, statsRootEl)}
        </>
    );
}
