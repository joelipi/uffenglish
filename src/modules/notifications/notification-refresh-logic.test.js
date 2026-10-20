import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
    NOTIFICATION_REFRESH_INTERVAL_MS,
    resolveNotificationRefreshInterval,
    resolveNotificationRefreshOptions,
} from './notification-refresh-logic.js';

// The refresh policy for the in-app inbox. The bug it fixes: the bell is
// mounted ONCE by the app shell, so a query without a refresh rule never
// re-reads the inbox while the page stays open — the user had to reload to
// see a new notification.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(__dirname, 'notification-refresh-logic.js'), 'utf8');

describe('resolveNotificationRefreshInterval', () => {
    it('polls a signed-in viewer every few seconds', () => {
        expect(resolveNotificationRefreshInterval('u1')).toBe(NOTIFICATION_REFRESH_INTERVAL_MS);
        expect(NOTIFICATION_REFRESH_INTERVAL_MS).toBe(5000);
    });

    it('never polls a guest or an empty viewer', () => {
        expect(resolveNotificationRefreshInterval('guest')).toBe(false);
        expect(resolveNotificationRefreshInterval('')).toBe(false);
        expect(resolveNotificationRefreshInterval(null)).toBe(false);
        expect(resolveNotificationRefreshInterval(undefined)).toBe(false);
    });
});

describe('resolveNotificationRefreshOptions', () => {
    const options = resolveNotificationRefreshOptions('u1');

    it('re-reads the inbox when the app is opened', () => {
        expect(options.refetchOnMount).toBe('always');
        expect(options.staleTime).toBe(0);
    });

    it('re-reads the inbox when the user comes back to the tab', () => {
        expect(options.refetchOnWindowFocus).toBe('always');
    });

    it('re-reads the inbox every few seconds while the page is visible', () => {
        expect(options.refetchInterval).toBe(NOTIFICATION_REFRESH_INTERVAL_MS);
    });

    it('stops polling a hidden page (a backgrounded phone)', () => {
        expect(options.refetchIntervalInBackground).toBe(false);
    });

    it('carries no poll for a guest', () => {
        expect(resolveNotificationRefreshOptions('guest').refetchInterval).toBe(false);
        expect(resolveNotificationRefreshOptions(undefined).refetchInterval).toBe(false);
    });
});

// Platform separation (React Native–portable): the policy is domain logic, so
// it must not reach for React, the DOM or a data layer.
describe('logic / presentation separation', () => {
    it('keeps the policy free of React / React Native / DOM access', () => {
        expect(source).not.toMatch(/from ['"]react['"]/);
        expect(source).not.toMatch(/from ['"]react-native['"]/);
        expect(source).not.toMatch(/\bwindow\./);
        expect(source).not.toMatch(/\bdocument\./);
        expect(source).not.toMatch(/from ['"].*api\.js['"]/);
    });
});
