import './modules/log-control.js';
import '../assets/css/utils.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

console.log('[React Entry] Initializing React Entry Point');

const videoFrame = document.querySelector('.video-frame');
const lifecycleRootEl = document.createElement('div');
lifecycleRootEl.id = 'react-lifecycle-root';
if (videoFrame) {
    videoFrame.appendChild(lifecycleRootEl);
} else {
    document.body.appendChild(lifecycleRootEl);
}

const root = createRoot(lifecycleRootEl);
root.render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
