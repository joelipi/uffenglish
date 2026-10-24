import { useEffect, useState } from 'react';
import {
    formatDiagnosticsText,
    shouldShowDiagnostics,
    takeDiagnostics,
} from '../../modules/diagnostics/take-diagnostics.js';
import { copyDiagnostics } from '../../modules/diagnostics/copy-diagnostics.webonly.js';

/**
 * The recording/playback diagnostics, on screen, behind `?diag=1`
 * (stories/094-fix-ipad-recorded-take-autoplay).
 *
 * The iPad field reports come from a device where copying the eruda console is
 * impractical, so the same payloads the app logs are also pushed to
 * `takeDiagnostics` and rendered here: a small fixed panel with selectable text
 * and a copy button. It renders nothing unless the URL asks for it, so learners
 * never see it. Render-only: formatting and the URL rule live in the module.
 */
export default function TakeDiagnosticsOverlay() {
    const [entries, setEntries] = useState(() => takeDiagnostics.entries());
    const [copied, setCopied] = useState(false);
    const enabled = typeof window !== 'undefined' && shouldShowDiagnostics(window.location.search);

    useEffect(() => {
        if (!enabled) return undefined;
        setEntries(takeDiagnostics.entries());
        return takeDiagnostics.subscribe((next) => setEntries(next));
    }, [enabled]);

    if (!enabled) return null;

    const text = formatDiagnosticsText(entries);

    const handleCopy = async () => {
        const ok = await copyDiagnostics(text);
        setCopied(ok);
        setTimeout(() => setCopied(false), 1500);
    };

    return (
        <div
            id="take-diagnostics"
            style={{
                position: 'fixed',
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 4000,
                maxHeight: '46vh',
                overflowY: 'auto',
                padding: '6px 8px 8px',
                background: 'rgba(0, 0, 0, 0.88)',
                color: '#e9f7ff',
                fontFamily: 'ui-monospace, Menlo, monospace',
                fontSize: 10,
                lineHeight: 1.3,
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <strong id="takeDiagnosticsTitle" style={{ fontSize: 10, letterSpacing: 0.6 }}>DIAGNOSTICS</strong>
                <button
                    id="takeDiagnosticsCopy"
                    onClick={handleCopy}
                    style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, border: '1px solid #9fd6ee', background: 'transparent', color: '#e9f7ff' }}
                >
                    {copied ? 'copied' : 'copy'}
                </button>
                <button
                    id="takeDiagnosticsClear"
                    onClick={() => takeDiagnostics.clear()}
                    style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, border: '1px solid #9fd6ee', background: 'transparent', color: '#e9f7ff' }}
                >
                    clear
                </button>
            </div>
            <pre
                id="takeDiagnosticsText"
                style={{
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    userSelect: 'text',
                    WebkitUserSelect: 'text',
                }}
            >
                {text}
            </pre>
        </div>
    );
}
