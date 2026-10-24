// Unit tests for the on-screen diagnostics transport (stories/094).

import { describe, it, expect, vi } from 'vitest';
import {
    TAKE_DIAGNOSTIC_PAYLOAD_MAX,
    TAKE_DIAGNOSTICS_LIMIT,
    createDiagnosticsLog,
    formatDiagnosticEntry,
    formatDiagnosticsText,
    shouldShowDiagnostics,
} from './take-diagnostics.js';

describe('formatDiagnosticEntry', () => {
    it('renders a label with its JSON payload on one line', () => {
        expect(formatDiagnosticEntry({ label: 'take media', payload: { videoWidth: 720 } }))
            .toBe('take media {"videoWidth":720}');
    });

    it('renders a label with no payload', () => {
        expect(formatDiagnosticEntry({ label: 'unmuted after muted start' })).toBe('unmuted after muted start');
    });

    it('truncates a long payload so the line stays readable', () => {
        const line = formatDiagnosticEntry({ label: 'big', payload: { blob: 'x'.repeat(1000) } });
        expect(line.length).toBeLessThan(TAKE_DIAGNOSTIC_PAYLOAD_MAX + 20);
        expect(line.endsWith('…')).toBe(true);
    });

    it('survives an unserialisable payload and a null entry', () => {
        const circular = {};
        circular.self = circular;
        expect(formatDiagnosticEntry({ label: 'circular', payload: circular })).toContain('circular');
        expect(formatDiagnosticEntry(null)).toBe('');
    });
});

describe('createDiagnosticsLog', () => {
    it('keeps the newest entries and drops the oldest at the limit', () => {
        const log = createDiagnosticsLog({ limit: 3, now: () => 0 });
        ['a', 'b', 'c', 'd'].forEach((label) => log.push(label));
        expect(log.entries().map((e) => e.label)).toEqual(['b', 'c', 'd']);
    });

    it('defaults to the panel limit', () => {
        expect(createDiagnosticsLog().limit).toBe(TAKE_DIAGNOSTICS_LIMIT);
    });

    it('notifies subscribers on push and clear', () => {
        const log = createDiagnosticsLog({ limit: 5, now: () => 0 });
        const seen = [];
        const unsub = log.subscribe((entries) => seen.push(entries.length));
        log.push('first');
        log.clear();
        unsub();
        log.push('ignored');
        expect(seen).toEqual([1, 0]);
    });

    it('survives a throwing subscriber and keeps the entry', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const log = createDiagnosticsLog({ now: () => 0 });
        log.subscribe(() => { throw new Error('boom'); });
        expect(() => log.push('ok')).not.toThrow();
        expect(log.entries()).toHaveLength(1);
        warn.mockRestore();
    });
});

describe('shouldShowDiagnostics', () => {
    it('is off without the flag', () => {
        expect(shouldShowDiagnostics('')).toBe(false);
        expect(shouldShowDiagnostics('?shareCode=abc')).toBe(false);
        expect(shouldShowDiagnostics(undefined)).toBe(false);
    });

    it('is on for ?diag=1 (with or without the leading ?)', () => {
        expect(shouldShowDiagnostics('?diag=1')).toBe(true);
        expect(shouldShowDiagnostics('diag=1')).toBe(true);
        expect(shouldShowDiagnostics('?shareCode=abc&diag=1')).toBe(true);
        expect(shouldShowDiagnostics('?diag=true')).toBe(true);
    });

    it('rejects other values', () => {
        expect(shouldShowDiagnostics('?diag=0')).toBe(false);
        expect(shouldShowDiagnostics('?diag=yes')).toBe(false);
    });
});

describe('formatDiagnosticsText', () => {
    it('joins the entries', () => {
        expect(formatDiagnosticsText([{ label: 'a' }, { label: 'b', payload: 1 }])).toBe('a\nb 1');
    });

    it('says so when there is nothing yet', () => {
        expect(formatDiagnosticsText([])).toBe('no diagnostics yet');
        expect(formatDiagnosticsText(null)).toBe('no diagnostics yet');
    });
});
