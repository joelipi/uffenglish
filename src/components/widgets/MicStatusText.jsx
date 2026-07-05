import React from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';

function renderIcon(type) {
    switch (type) {
        case 'speak-now':
            return <i className="bi bi-mic" style={{ color: 'green', fontSize: '100px' }} />;
        case 'engine-error':
            return <i className="bi bi-exclamation-triangle" style={{ color: 'red', fontSize: '30px' }} />;
        case 'engine-ready':
            return <i className="bi bi-check-circle text-success" />;
        case 'stop-early':
            return <i className="bi bi-exclamation-triangle-fill" style={{ color: 'red', fontSize: 'large' }} />;
        case 'gibberish':
            return <i className="bi bi-ear-x" style={{ color: '#ff9800', fontSize: 'large' }} />;
        case 'alert':
            return <i className="bi bi-exclamation-diamond" />;
        default:
            return null;
    }
}

function renderContent(type) {
    switch (type) {
        case 'restarting':
            return <div className="spinner-border spinner-border-sm" role="status" />;
        default:
            return null;
    }
}

function colorClass(type) {
    switch (type) {
        case 'engine-error':
        case 'stop-early':
        case 'danger':
        case 'preflight-rejected':
            return 'text-danger';
        case 'engine-ready':
            return 'text-success';
        case 'analyzing':
        case 'restarting':
            return 'text-warning';
        case 'gibberish':
            return 'mt-3';
        default:
            return '';
    }
}

function renderText(text) {
    return <span>{text}</span>;
}

function renderBilingual(bilingual) {
    if (!bilingual.localized) return <span>{bilingual.english}</span>;
    return (
        <span>
            {bilingual.english}<br />
            <span lang={bilingual.lang}>{bilingual.localized}</span>
        </span>
    );
}

export default function SystemMessageOverlay() {
    const systemMessage = useStore(appStore, (state) => state.systemMessage);
    const systemMessageText = useStore(appStore, (state) => state.systemMessageText);

    if (systemMessage) {
        const { type, text, bilingual } = systemMessage;
        return (
            <div id="react-root-micstatus" className="d-flex justify-content-center align-items-center">
                <div id="micStatusText" className={`text-center ${colorClass(type)}`}>
                    {renderContent(type)}
                    {type === 'restarting' && ' '}
                    {renderIcon(type)}
                    {type === 'speak-now' && <br />}
                    {bilingual ? renderBilingual(bilingual) : renderText(text)}
                </div>
            </div>
        );
    }

    if (!systemMessageText) return null;

    return (
        <div id="react-root-micstatus" className="d-flex justify-content-center align-items-center">
            <div id="micStatusText">{micStatusText}</div>
        </div>
    );
}
