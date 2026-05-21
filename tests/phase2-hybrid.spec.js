// @ts-check
import { test, expect } from '@playwright/test';

test.describe('Phase 2.5 — Hybrid flow: React shell + vanilla step-loader', () => {

    test('Lesson loads through React shell with vanilla step content', async ({ page }) => {
        const consoleOutput = [];
        page.on('console', msg => {
            consoleOutput.push({ type: msg.type(), text: msg.text() });
        });
        page.on('pageerror', err => consoleOutput.push({ type: 'pageerror', text: err.message }));

        await page.goto('/course/gt2/lesson/a');

        // Wait for React boot + vanilla initializeApp + lesson load
        await page.waitForTimeout(15000);

        // 1. React shell mounted
        const shell = await page.evaluate(() => {
            return document.getElementById('react-lifecycle-root') !== null;
        });
        expect(shell).toBeTruthy();
        console.log('  ✓ React shell mounted');

        // 2. Core DOM elements exist
        const domChecks = await page.evaluate(() => {
            return {
                videoFrame: document.querySelector('.video-frame') !== null,
                statsContainer: document.getElementById('stats-container') !== null,
                chatWindow: document.getElementById('chat-window-container') !== null,
                mediaViewport: document.getElementById('media-viewport') !== null,
                micBtn: document.getElementById('micBtn') !== null,
                micStatusText: document.getElementById('micStatusText') !== null,
                progressBar: document.getElementById('progress-bar') !== null,
            };
        });
        console.log('  DOM elements:', JSON.stringify(domChecks));
        expect(domChecks.videoFrame).toBeTruthy();
        expect(domChecks.chatWindow).toBeTruthy();
        expect(domChecks.micBtn).toBeTruthy();
        console.log('  ✓ Core DOM elements present');

        // 3. React portals have content
        const portalChecks = await page.evaluate(() => {
            return {
                stats: (document.getElementById('react-root-stats')?.children?.length || 0) > 0,
                activity: (document.getElementById('react-root-activity')?.children?.length || 0) > 0,
                mic: (document.getElementById('react-root-mic')?.children?.length || 0) > 0,
                chat: (document.getElementById('react-root-chat')?.children?.length || 0) > 0,
                errorAnchor: document.getElementById('react-root-critical-error') !== null,
                guestDialog: document.querySelector('dialog#guestLoginModal') !== null,
            };
        });
        console.log('  Portals:', JSON.stringify(portalChecks));
        expect(portalChecks.stats).toBeTruthy();
        expect(portalChecks.activity).toBeTruthy();
        expect(portalChecks.mic).toBeTruthy();
        expect(portalChecks.guestDialog).toBeTruthy();
        console.log('  ✓ React portals mounted');

        // 4. Expected init logs fired
        const initLogs = consoleOutput.filter(e => e.type === 'log' && e.text.includes('[React Entry]'));
        expect(initLogs.length).toBeGreaterThanOrEqual(1);
        const routerLogs = consoleOutput.filter(e => e.type === 'log' && e.text.includes('[Router]'));
        expect(routerLogs.length).toBeGreaterThanOrEqual(1);
        console.log(`  ✓ ${initLogs.length} React Entry + ${routerLogs.length} Router logs fired`);

        // 5. No critical console errors
        const criticalErrors = consoleOutput.filter(e =>
            e.type === 'pageerror' ||
            (e.type === 'error' &&
                !e.text.includes('favicon') &&
                !e.text.includes('Whisper') &&
                !e.text.includes('Idiom checker') &&
                !e.text.includes('Failed to load resource') &&
                !e.text.includes('source map') &&
                !e.text.includes('vite'))
        );
        if (criticalErrors.length > 0) {
            console.log('Console errors:', JSON.stringify(criticalErrors, null, 2));
        }
        expect(criticalErrors).toEqual([]);
        console.log('  ✓ No critical console errors');
    });

});
