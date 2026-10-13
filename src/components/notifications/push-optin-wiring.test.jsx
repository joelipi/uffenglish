// components/notifications/push-optin-wiring.test.jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Controllable browser-side inputs; the pure decision logic runs for real.
const webOnly = vi.hoisted(() => ({
    support: { supported: true, permission: 'default' },
    existing: null,
    dismissed: false,
    justInstalled: false,
    subscribeResult: { ok: true },
    subscribe: vi.fn(),
    markDismissed: vi.fn(),
}));

vi.mock('../../modules/api/supabase.js', () => ({ supabase: { from: vi.fn() } }));
vi.mock('../../modules/notifications/push-subscription-webonly.js', () => ({
    readPushSupport: () => webOnly.support,
    readExistingSubscription: async () => webOnly.existing,
    readPromptDismissed: () => webOnly.dismissed,
    markPromptDismissed: (...args) => webOnly.markDismissed(...args),
    consumeJustInstalled: () => webOnly.justInstalled,
    subscribeToPush: (...args) => webOnly.subscribe(...args),
    syncExistingSubscription: async () => ({ ok: false, reason: 'none' }),
    listenForPushSubscriptionChange: () => () => {},
    resolveClientVapidPublicKey: () => DEFAULT_VAPID_PUBLIC_KEY,
}));

import PushNotificationsOptIn from './PushNotificationsOptIn.web.jsx';
import { DEFAULT_VAPID_PUBLIC_KEY } from '../../modules/notifications/push-config.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(__dirname, rel), 'utf8');

function render(element) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => { root.render(element); });
    return {
        container,
        unmount() { act(() => root.unmount()); container.remove(); },
    };
}

/** Let the mount effect's awaited sequence settle. */
async function flush() {
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => {
    webOnly.support = { supported: true, permission: 'default' };
    webOnly.existing = null;
    webOnly.dismissed = false;
    webOnly.justInstalled = false;
    webOnly.subscribeResult = { ok: true };
    webOnly.subscribe = vi.fn(async () => webOnly.subscribeResult);
    webOnly.markDismissed = vi.fn();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('PushNotificationsOptIn — menu entry', () => {
    it('offers the entry point when every gate holds, and subscribes on tap', async () => {
        const { container, unmount } = render(
            <PushNotificationsOptIn lang="en" variant="menu-item" userId="user-1" />
        );
        await flush();
        const button = container.querySelector('[data-testid="push-enable"]');
        expect(button).toBeTruthy();
        expect(button.textContent).toContain('Enable');

        await act(async () => { button.click(); });
        expect(webOnly.subscribe).toHaveBeenCalledTimes(1);
        expect(webOnly.subscribe.mock.calls[0][0].userId).toBe('user-1');
        // A successful subscribe hides the entry point for this device.
        expect(container.querySelector('[data-testid="push-enable"]')).toBeNull();
        unmount();
    });

    it('keeps the entry point when the subscribe attempt fails', async () => {
        webOnly.subscribeResult = { ok: false, reason: 'failed' };
        const { container, unmount } = render(
            <PushNotificationsOptIn lang="en" variant="menu-item" userId="user-1" />
        );
        await flush();
        await act(async () => { container.querySelector('[data-testid="push-enable"]').click(); });
        expect(container.querySelector('[data-testid="push-enable"]')).toBeTruthy();
        unmount();
    });

    it('renders nothing for a guest (not signed in)', async () => {
        const { container, unmount } = render(
            <PushNotificationsOptIn lang="en" variant="menu-item" userId={null} />
        );
        await flush();
        expect(container.querySelector('[data-testid="push-enable"]')).toBeNull();
        unmount();
    });

    it('renders nothing when the browser cannot push, or permission is denied, or already subscribed', async () => {
        const cases = [
            { support: { supported: false, permission: 'unsupported' } },
            { support: { supported: true, permission: 'denied' } },
            { existing: { endpoint: 'https://push.example/x' } },
            { dismissed: true },
        ];
        for (const patch of cases) {
            // Reset to the offering baseline, then apply one blocking input.
            webOnly.support = { supported: true, permission: 'default' };
            webOnly.existing = null;
            webOnly.dismissed = false;
            webOnly.justInstalled = false;
            Object.assign(webOnly, patch);

            const { container, unmount } = render(
                <PushNotificationsOptIn lang="en" variant="menu-item" userId="user-1" />
            );
            await flush();
            expect(container.querySelector('[data-testid="push-enable"]'), JSON.stringify(patch)).toBeNull();
            unmount();
        }
    });
});

describe('PushNotificationsOptIn — post-install prompt', () => {
    it('shows once right after an install and dismisses without subscribing', async () => {
        webOnly.justInstalled = true;
        const { container, unmount } = render(
            <PushNotificationsOptIn lang="en" variant="prompt" userId="user-1" />
        );
        await flush();
        expect(container.querySelector('[data-testid="push-prompt"]')).toBeTruthy();
        expect(container.textContent).toContain('Turn on notifications');

        await act(async () => { container.querySelector('[data-testid="push-dismiss"]').click(); });
        expect(webOnly.markDismissed).toHaveBeenCalled();
        expect(webOnly.subscribe).not.toHaveBeenCalled();
        expect(container.querySelector('[data-testid="push-prompt"]')).toBeNull();
        unmount();
    });

    it('does not show on a later launch (not a fresh install)', async () => {
        webOnly.justInstalled = false;
        const { container, unmount } = render(
            <PushNotificationsOptIn lang="en" variant="prompt" userId="user-1" />
        );
        await flush();
        expect(container.querySelector('[data-testid="push-prompt"]')).toBeNull();
        unmount();
    });
});

describe('push opt-in wiring source guards', () => {
    it('mounts both variants in HomeScreen, gated on a real signed-in user', () => {
        const homeScreen = read('../homescreen/HomeScreen.jsx');
        expect(homeScreen).toContain("import PushNotificationsOptIn from '../notifications/PushNotificationsOptIn.web.jsx'");
        expect(homeScreen).toContain('<PushNotificationsOptIn lang={lang} variant="prompt" userId={viewerId} />');
        expect(homeScreen).toContain('variant="menu-item"');
        expect(homeScreen).toContain("viewerId && viewerId !== 'guest'");
    });

    it('requests permission only from inside the click path (iOS needs a gesture)', () => {
        const webOnlySource = read('../../modules/notifications/push-subscription-webonly.js');
        const requestAt = webOnlySource.indexOf('Notification.requestPermission()');
        expect(requestAt).toBeGreaterThan(-1);
        // It lives in subscribeToPush, whose only caller is the click handler.
        expect(webOnlySource.slice(0, requestAt)).toContain('export async function subscribeToPush(');
        const component = read('PushNotificationsOptIn.web.jsx');
        expect(component).toContain('onClick={handleEnable}');
        expect(component).not.toContain('useEffect(async');
    });

    it('keeps the browser reads out of the pure logic module', () => {
        const logic = read('../../modules/notifications/push-logic.js');
        expect(logic).not.toContain('navigator');
        expect(logic).not.toContain('localStorage');
        expect(logic).not.toContain("from 'react'");
    });

    it('ships localized copy for the push keys in every UI language', () => {
        const strings = read('../../data/strings.js');
        for (const key of ['push_friend_response_title', 'push_optin_title', 'push_optin_body', 'push_optin_enable', 'push_optin_dismiss']) {
            const from = strings.indexOf(`'${key}'`);
            expect(from, key).toBeGreaterThan(-1);
            const entry = strings.slice(from, strings.indexOf('},', from));
            for (const lang of ['en', 'es', 'pt', 'fr', 'hi', 'bn']) {
                expect(entry, `${key}/${lang}`).toContain(`${lang}:`);
            }
            // Real Hindi and Bengali script, not English placeholders.
            expect(entry, `${key} hi`).toMatch(/[\u0900-\u097F]/);
            expect(entry, `${key} bn`).toMatch(/[\u0980-\u09FF]/);
        }
    });
});

describe('VAPID key shape', () => {
    it('the committed public key is a 65-byte uncompressed point', () => {
        const key = DEFAULT_VAPID_PUBLIC_KEY;
        expect(key).toMatch(/^[A-Za-z0-9_-]+$/);
        const bytes = Buffer.from(key, 'base64url');
        expect(bytes.length).toBe(65);
        expect(bytes[0]).toBe(0x04);
    });
});
