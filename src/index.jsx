import './modules/user/log-control-webonly.js';
import './assets/css/app.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './modules/api/api.js';
import App from './App.jsx';

console.log('[React Entry] Initializing React Entry Point');

const root = createRoot(document.getElementById('root'));
root.render(
    <React.StrictMode>
        <QueryClientProvider client={queryClient}>
            <App />
        </QueryClientProvider>
    </React.StrictMode>
);
