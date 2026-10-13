// modules/notifications/push-sw.test.js
// Static guard for the service worker's push handlers. The handlers run in a
// worker (no DOM, no import), so their contract is pinned by source: the three
// listeners exist, a malformed payload still shows a notification, the click
// handler only ever opens a same-origin path, and the worker never gets a secret
// baked into it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '../../..');
const sw = readFileSync(path.join(repoRoot, 'public/push-sw.js'), 'utf8');
const viteConfig = readFileSync(path.join(repoRoot, 'vite.config.js'), 'utf8');

describe('public/push-sw.js — listeners', () => {
    it('registers exactly the three push listeners', () => {
        expect(sw).toContain("self.addEventListener('push'");
        expect(sw).toContain("self.addEventListener('notificationclick'");
        expect(sw).toContain("self.addEventListener('pushsubscriptionchange'");
    });

    it('shows a notification even when the payload is missing or malformed', () => {
        expect(sw).toContain('showNotification');
        // The parser swallows bad JSON and the caller falls back to defaults.
        expect(sw).toContain('return null;');
        expect(sw).toContain('FALLBACK_TITLE');
    });

    it('parses the payload and passes title/body/icon/badge/url to showNotification', () => {
        expect(sw).toContain('event.data.json()');
        expect(sw).toContain("icon: '/pwa-192x192.png'");
        expect(sw).toContain("badge: '/pwa-64x64.png'");
        expect(sw).toContain('data: { url }');
        expect(sw).toContain('const title =');
        expect(sw).toContain('const body =');
    });

    it('never re-subscribes in the worker (it has no session)', () => {
        // The worker only tells the app; the app re-registers the endpoint.
        expect(sw).not.toContain('pushManager');
        expect(sw).not.toContain('subscribe(');
        expect(sw).toContain("type: 'push-subscription-changed'");
    });

    it('only ever opened a same-origin relative path from an untrusted payload', () => {
        // notificationUrl() rejects anything that is not a single-slash path.
        expect(sw).toContain("if (!url.startsWith('/') || url.startsWith('//')) return FALLBACK_URL;");
        expect(sw).toContain('new URL(target, origin).href');
    });

    it('closes the notification and focuses an existing window before opening one', () => {
        expect(sw).toContain('event.notification.close()');
        expect(sw).toContain('self.clients.matchAll(');
        expect(sw).toContain('return client.focus();');
        expect(sw).toContain('self.clients.openWindow(targetUrl)');
    });

    it('reports a subscription change to the app instead of storing secrets or endpoints', () => {
        expect(sw).toContain("postMessage({ type: 'push-subscription-changed' })");
        // The worker must not carry the VAPID key or any fetches of its own.
        expect(sw).not.toMatch(/VAPID/i);
        expect(sw).not.toMatch(/fetch\(/);
        expect(sw).not.toMatch(/p256dh|auth:/);
    });

    it('does not touch the generated precache or routing', () => {
        expect(sw).not.toContain('precacheAndRoute');
        expect(sw).not.toContain('registerRoute');
        expect(sw).not.toContain('navigateFallback');
    });
});

describe('vite.config.js — service worker wiring', () => {
    it('imports the push handlers into the generated worker', () => {
        expect(viteConfig).toContain("importScripts: ['push-sw.js']");
        // …while keeping the reviewed generateSW strategy (not injectManifest).
        expect(viteConfig).toContain("strategies: 'generateSW'");
    });

    it('ships public/push-sw.js, which is what importScripts resolves at /', () => {
        expect(() => readFileSync(path.join(repoRoot, 'public/push-sw.js'), 'utf8')).not.toThrow();
    });
});
