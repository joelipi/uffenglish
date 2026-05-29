import './modules/log-control.js';
import '../assets/css/utils.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

console.log('[React Entry] Initializing React Entry Point');

const root = createRoot(document.getElementById('root'));
root.render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
