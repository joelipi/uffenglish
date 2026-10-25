import './modules/user/log-control-webonly.js';
import './assets/css/app.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './modules/api/api.js';
import App from './App.jsx';
import { installStaleChunkReload } from './modules/utils/stale-chunk-reload.js';
import { formatBuildLog } from './modules/utils/build-id.js';

installStaleChunkReload();

console.log('[React Entry] Initializing React Entry Point');
// The entry chunk's hashed name identifies the build, so a tester can tell a
// fresh deployment from a precached older shell.
console.log(formatBuildLog(import.meta.url));

const root = createRoot(document.getElementById('root'));
root.render(
    <React.StrictMode>
        <QueryClientProvider client={queryClient}>
            <App />
        </QueryClientProvider>
    </React.StrictMode>
);
