import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

console.log('[React Entry] Initializing React Entry Point');

const lifecycleRootEl = document.createElement('div');
lifecycleRootEl.id = 'react-lifecycle-root';
document.body.appendChild(lifecycleRootEl);

const root = createRoot(lifecycleRootEl);
root.render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
