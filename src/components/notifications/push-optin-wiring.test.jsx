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
    installed: true,
    subscribeResult: { ok: true },
    subscribe: vi.fn(),
    appInstalledHandlers: [],
}));

vi.mock('../../modules/api/supabase.js', () => ({ supabase: { from: vi.fn() } }));
vi.mock('../../modules/notifications/push-subscription-webonly.js', () => ({
    readPushSupport: () => webOnly.support,
    readExistingSubscription: async () => webOnly.existing,
    readIsStandalone: () => webOnly.installed,
    listenForAppInstalled: (handler) => {
        webOnly.appInstalledHandlers.push(handler);
        return () => {};
    },
    subscribeToPush: (...args) => webOnly.subscribe(...args),
    syncExistingSubscription: async () => ({ ok: false, reason: 'none' }),
    listenForPushSubscriptionChange: () => () => {},
    resolveClientVapidPublicKey: () => DEFAULT_VAPID_PUBLIC_KEY,
}));

import PushNotificationsOptIn from './PushNotificationsOptIn.web.jsx';
import Strings from '../../data/strings.js';
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
    webOnly.installed = true;
    webOnly.subscribeResult = { ok: true };
    // Realistic: after a successful subscribe the browser holds a subscription,
    // which is what readExistingSubscription() reports on the recompute.
    webOnly.subscribe = vi.fn(async () => {
        if (webOnly.subscribeResult && webOnly.subscribeResult.ok) {
            webOnly.existing = { endpoint: 'https://push.example/device-1' };
        }
        return webOnly.subscribeResult;
    });
    webOnly.appInstalledHandlers = [];
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

    it('offers to a signed-in user who never installed the app', async () => {
        webOnly.installed = false;
        const { container, unmount } = render(
            <PushNotificationsOptIn lang="en" variant="menu-item" userId="user-1" />
        );
        await flush();
        expect(container.querySelector('[data-testid="push-enable"]')).toBeTruthy();
        unmount();
    });

    it('explains a denied permission instead of reusing the dismiss label', async () => {
        webOnly.subscribeResult = { ok: false, reason: 'denied' };
        const { container, unmount } = render(
            <PushNotificationsOptIn lang="en" variant="prompt" userId="user-1" />
        );
        await flush();
        await act(async () => { container.querySelector('[data-testid="push-enable"]').click(); });

        const outcome = container.querySelector('[data-testid="push-outcome"]');
        expect(outcome).toBeTruthy();
        expect(outcome.textContent).toBe(Strings.get('push_optin_denied_hint', 'en'));
        expect(outcome.textContent).not.toBe(Strings.get('push_optin_dismiss', 'en'));
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

    it('renders nothing when the browser cannot push or this device is already subscribed', async () => {
        // Denial is deliberately NOT in this list: a denied user is still shown
        // the offer (disabled, with the unblock hint) rather than being hidden.
        const cases = [
            { support: { supported: false, permission: 'unsupported' } },
            { existing: { endpoint: 'https://push.example/x' } },
        ];
        for (const patch of cases) {
            // Reset to the offering baseline, then apply one blocking input.
            webOnly.support = { supported: true, permission: 'default' };
            webOnly.existing = null;
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

describe('PushNotificationsOptIn — installed-app prompt', () => {
    it('offers the card to an installed user who has not enabled notifications', async () => {
        const { container, unmount } = render(
            <PushNotificationsOptIn lang="en" variant="prompt" userId="user-1" />
        );
        await flush();
        expect(container.querySelector('[data-testid="push-prompt"]')).toBeTruthy();
        expect(container.textContent).toContain('Turn on notifications');
        unmount();
    });

    it('has no "Not now" escape hatch — the offer persists until enabled', async () => {
        const { container, unmount } = render(
            <PushNotificationsOptIn lang="en" variant="prompt" userId="user-1" />
        );
        await flush();
        expect(container.querySelector('[data-testid="push-prompt"]')).toBeTruthy();
        expect(container.querySelector('[data-testid="push-dismiss"]')).toBeNull();
        // The accept button must not be light-on-light: --uff-btn-bg is white
        // and --uff-btn-fg near-black (app.css :root).
        const enable = container.querySelector('[data-testid="push-enable"]');
        expect(enable.style.color).toContain('--uff-btn-fg');
        expect(enable.style.color).not.toBe('white');
        expect(enable.style.background).toContain('--uff-btn-bg');
        unmount();
    });

    it('does not show the card in a plain browser tab (not installed)', async () => {
        webOnly.installed = false;
        const { container, unmount } = render(
            <PushNotificationsOptIn lang="en" variant="prompt" userId="user-1" />
        );
        await flush();
        expect(container.querySelector('[data-testid="push-prompt"]')).toBeNull();
        unmount();
    });

    it('starts offering in the installing tab as soon as appinstalled fires', async () => {
        webOnly.installed = false;
        const { container, unmount } = render(
            <PushNotificationsOptIn lang="en" variant="prompt" userId="user-1" />
        );
        await flush();
        expect(container.querySelector('[data-testid="push-prompt"]')).toBeNull();

        await act(async () => { webOnly.appInstalledHandlers.forEach((fn) => fn()); });
        expect(container.querySelector('[data-testid="push-prompt"]')).toBeTruthy();
        unmount();
    });

    it('stops offering once this device is subscribed', async () => {
        webOnly.existing = { endpoint: 'https://push.example/x' };
        const { container, unmount } = render(
            <PushNotificationsOptIn lang="en" variant="prompt" userId="user-1" />
        );
        await flush();
        expect(container.querySelector('[data-testid="push-prompt"]')).toBeNull();
        unmount();
    });

    it('switches to blocked when the attempt itself ends in a denial', async () => {
        // The user declines the OS dialog: the OS has now recorded `denied`, so
        // the offer must stop pretending the button can do anything.
        webOnly.subscribeResult = { ok: false, reason: 'denied' };
        webOnly.subscribe = vi.fn(async () => {
            // The browser's permission flips as a result of the request.
            webOnly.support = { supported: true, permission: 'denied' };
            return { ok: false, reason: 'denied' };
        });

        const { container, unmount } = render(
            <PushNotificationsOptIn lang="en" variant="prompt" userId="user-1" />
        );
        await flush();
        expect(container.querySelector('[data-testid="push-enable"]').disabled).toBe(false);

        await act(async () => { container.querySelector('[data-testid="push-enable"]').click(); });

        expect(container.querySelector('[data-testid="push-enable"]').disabled).toBe(true);
        expect(container.querySelector('[data-testid="push-outcome"]').textContent)
            .toBe(Strings.get('push_optin_denied_hint', 'en'));
        unmount();
    });

    for (const variant of ['prompt', 'menu-item']) {
        it(`${variant}: a denial disables the button in the same window the hint appears`, async () => {
            // `outcome === 'denied'` with permission not yet reflected: hint AND
            // disabled must agree, in both variants.
            webOnly.subscribeResult = { ok: false, reason: 'denied' };
            webOnly.subscribe = vi.fn(async () => ({ ok: false, reason: 'denied' }));

            const { container, unmount } = render(
                <PushNotificationsOptIn lang="en" variant={variant} userId="user-1" />
            );
            await flush();
            await act(async () => { container.querySelector('[data-testid="push-enable"]').click(); });

            expect(container.querySelector('[data-testid="push-outcome"]')).toBeTruthy();
            expect(container.querySelector('[data-testid="push-enable"]').disabled).toBe(true);
            unmount();
        });

        it(`${variant}: a dismissed prompt leaves the button usable`, async () => {
            // The user closed the OS dialog: nothing was blocked, so they must be
            // able to try again without reloading.
            webOnly.subscribeResult = { ok: false, reason: 'dismissed' };
            webOnly.subscribe = vi.fn(async () => ({ ok: false, reason: 'dismissed' }));

            const { container, unmount } = render(
                <PushNotificationsOptIn lang="en" variant={variant} userId="user-1" />
            );
            await flush();
            await act(async () => { container.querySelector('[data-testid="push-enable"]').click(); });

            expect(container.querySelector('[data-testid="push-outcome"]')).toBeNull();
            expect(container.querySelector('[data-testid="push-enable"]').disabled).toBe(false);
            unmount();
        });
    }

    it('shows the unblock hint on the menu entry too when permission is denied', async () => {
        webOnly.support = { supported: true, permission: 'denied' };
        const { container, unmount } = render(
            <PushNotificationsOptIn lang="en" variant="menu-item" userId="user-1" />
        );
        await flush();
        expect(container.querySelector('[data-testid="push-enable"]').disabled).toBe(true);
        expect(container.querySelector('[data-testid="push-outcome"]').textContent)
            .toBe(Strings.get('push_optin_denied_hint', 'en'));
        unmount();
    });

    it('still offers (with an actionable hint) when the OS has denied permission', async () => {
        webOnly.support = { supported: true, permission: 'denied' };
        const { container, unmount } = render(
            <PushNotificationsOptIn lang="en" variant="prompt" userId="user-1" />
        );
        await flush();
        const card = container.querySelector('[data-testid="push-prompt"]');
        expect(card).toBeTruthy();
        expect(container.querySelector('[data-testid="push-outcome"]').textContent)
            .toBe(Strings.get('push_optin_denied_hint', 'en'));
        // The button cannot re-prompt a denied permission, so it is disabled.
        expect(container.querySelector('[data-testid="push-enable"]').disabled).toBe(true);
        unmount();
    });
});

describe('push opt-in wiring source guards', () => {
    it('mounts the prompt variant on the dashboard and the menu variant in the shared header', () => {
        const homeScreen = read('../homescreen/HomeScreen.jsx');
        expect(homeScreen).toContain("import PushNotificationsOptIn from '../notifications/PushNotificationsOptIn.web.jsx'");
        expect(homeScreen).toContain('<PushNotificationsOptIn lang={lang} variant="prompt" userId={viewerId} />');
        // The menu entry moved to the shared app header (every inside page
        // shows that menu), gated on a real signed-in user.
        const appHeader = read('../layout/AppHeader.web.jsx');
        expect(appHeader).toContain("import PushNotificationsOptIn from '../notifications/PushNotificationsOptIn.web.jsx'");
        expect(appHeader).toContain('variant="menu-item"');
        expect(appHeader).toContain('isRegisteredViewer(viewerId)');
    });

    it('mounts the notification prompt on /profile and /courses for signed-in users', () => {
        const profile = read('../profile/UserProfile.jsx');
        expect(profile).toContain("import PushNotificationsOptIn from '../notifications/PushNotificationsOptIn.web.jsx'");
        expect(profile).toContain('<PushNotificationsOptIn lang={lang} variant="prompt" userId={profile?.$id} />');
        const courses = read('../courses/CourseListings.jsx');
        expect(courses).toContain("import PushNotificationsOptIn from '../notifications/PushNotificationsOptIn.web.jsx'");
        expect(courses).toContain('<PushNotificationsOptIn lang={lang} variant="prompt" userId={userId} />');
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
        for (const key of ['push_friend_response_title', 'push_optin_title', 'push_optin_body', 'push_optin_enable', 'push_optin_dismiss', 'push_optin_denied_hint']) {
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
