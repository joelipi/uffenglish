// @ts-check
import { test, expect } from '@playwright/test';

test.describe('React App Load Verification', () => {
    let consoleMessages = [];
    let pageErrors = [];

    test.beforeEach(async ({ page }) => {
        consoleMessages = [];
        pageErrors = [];

        page.on('console', msg => {
            const entry = { type: msg.type(), text: msg.text() };
            consoleMessages.push(entry);
            if (msg.type() === 'error') {
                const text = msg.text();
                const noise = ['favicon', 'source map', 'Whisper', '401 (Unauthorized)'];
                if (!noise.some(n => text.includes(n))) {
                    pageErrors.push(text);
                }
            }
        });

        page.on('pageerror', err => {
            pageErrors.push(`PAGE_ERROR: ${err.message}`);
        });
    });

    test('React app loads and mounts at /course/gt2/lesson/a', async ({ page }) => {
        await page.goto('http://localhost:3000/course/gt2/lesson/a', { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Wait for React to mount the lifecycle root
        await page.waitForSelector('#react-lifecycle-root', { timeout: 30000 });

        // Wait for appStore to be populated
        await page.waitForFunction(() => {
            const state = window.appStore?.getState();
            return state && state.configData && state.currentLessonIndex >= 0;
        }, { timeout: 30000 });

        // Wait for loading screen to be hidden
        await page.waitForFunction(() => {
            const el = document.getElementById('appLoadingImageDiv');
            return !el || el.style.display === 'none' || el.classList.contains('d-none');
        }, { timeout: 15000 });

        // --- Check DOM elements ---
        const reactRoot = await page.$('#react-lifecycle-root');
        expect(reactRoot).not.toBeNull();

        const reactRootHTML = await reactRoot.innerHTML();
        expect(reactRootHTML.length).toBeGreaterThan(0);

        const appState = await page.evaluate(() => {
            const state = window.appStore?.getState();
            return {
                hasConfigData: !!state?.configData,
                hasConfigDataLessons: Array.isArray(state?.configData?.lessons),
                lessonCount: state?.configData?.lessons?.length || 0,
                hasCourseId: !!state?.courseId,
                courseId: state?.courseId,
                currentLessonIndex: state?.currentLessonIndex,
                currentStepIndex: state?.currentStepIndex,
                hasUserData: !!state?.userData,
                userDataKeys: state?.userData ? Object.keys(state.userData) : [],
            };
        });

        expect(appState.hasConfigData).toBe(true);
        expect(appState.hasConfigDataLessons).toBe(true);
        expect(appState.lessonCount).toBeGreaterThan(0);
        expect(appState.hasCourseId).toBe(true);

        // Check loading screen is hidden
        const loadingHidden = await page.evaluate(() => {
            const el = document.getElementById('appLoadingImageDiv');
            if (!el) return true;
            const style = window.getComputedStyle(el);
            return style.display === 'none' || style.visibility === 'hidden' || el.classList.contains('d-none');
        });
        expect(loadingHidden).toBe(true);

        // Check for lesson content visibility (chat area, stats bar, etc.)
        const bodyText = await page.evaluate(() => document.body?.innerText || '');
        const hasContent = bodyText.length > 100;
        expect(hasContent).toBe(true);

        // Take screenshot
        await page.screenshot({
            path: 'tests/screenshots/react-load-verification.png',
            fullPage: true,
        });

        // --- Report all console messages ---
        console.log('\n========== CONSOLE MESSAGES ==========');
        const errors = consoleMessages.filter(m => m.type === 'error');
        const warns = consoleMessages.filter(m => m.type === 'warning');
        const infos = consoleMessages.filter(m => m.type === 'info' || m.type === 'log');

        console.log(`\n--- ERRORS (${errors.length}) ---`);
        errors.forEach(e => console.log(`  [ERROR] ${e.text}`));

        console.log(`\n--- WARNINGS (${warns.length}) ---`);
        warns.forEach(w => console.log(`  [WARN] ${w.text}`));

        console.log(`\n--- KEY INFO/LOGS (${Math.min(infos.length, 30)}) ---`);
        const keyLogs = infos.filter(m =>
            m.text.includes('[Bootstrap]') ||
            m.text.includes('[React]') ||
            m.text.includes('[LessonContainer]') ||
            m.text.includes('[App]') ||
            m.text.includes('[Init]') ||
            m.text.includes('[Store]') ||
            m.text.includes('success') ||
            m.text.includes('SUCCESS') ||
            m.text.includes('loaded') ||
            m.text.includes('Loaded') ||
            m.text.includes('mount') ||
            m.text.includes('Mount')
        );
        keyLogs.forEach(l => console.log(`  [LOG] ${l.text}`));
        if (keyLogs.length === 0) {
            infos.slice(0, 30).forEach(l => console.log(`  [LOG] ${l.text}`));
        }

        console.log(`\n--- PAGE ERRORS (${pageErrors.length}) ---`);
        pageErrors.forEach(e => console.log(`  ${e}`));

        console.log(`\n--- APP STATE ---`);
        console.log(JSON.stringify(appState, null, 2));

        console.log(`\n--- BODY TEXT (first 500 chars) ---`);
        console.log(bodyText.substring(0, 500));

        console.log('\n========== VERIFICATION COMPLETE ==========');
    });
});
