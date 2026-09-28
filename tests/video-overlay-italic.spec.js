// @ts-check
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Real-browser (Chromium) verification that localized recap-overlay text is
// upright for Bengali, where no true italic face exists and the browser would
// otherwise apply synthetic oblique. The app stylesheet is injected directly so
// the test does not depend on the lesson backend.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_CSS = readFileSync(path.join(__dirname, '..', 'src', 'assets', 'css', 'app.css'), 'utf8');

const MARKUP = `
  <div id="state-lesson-success">
    <p class="success-share-cta">
      Share this video<br /><span lang="bn">এই ভিডিওটি শেয়ার করুন</span>
    </p>
    <div class="ivp-choice-label">
      <div class="ivp-choice-label-text">
        CONTINUE<br /><span lang="bn">চালিয়ে যান</span>
      </div>
    </div>
  </div>
  <div class="ivp-overlay">
    <div class="ivp-overlay-content">
      <p class="ivp-overlay-text">
        Continue<br /><span lang="bn">চালিয়ে যান</span>
      </p>
    </div>
  </div>
  <div class="chat-message-bubble">
    <span lang="bn">চ্যাট বার্তা</span>
  </div>`;

test('Bengali recap-overlay text is upright (no synthetic italic)', async ({ page }) => {
    await page.setContent(`<style>${APP_CSS}</style>${MARKUP}`);

    const styles = await page.evaluate(() => {
        const fontStyle = (sel) => {
            const el = document.querySelector(sel);
            if (!el) throw new Error(`missing selector: ${sel}`);
            return getComputedStyle(el).fontStyle;
        };
        return {
            shareCta: fontStyle('#state-lesson-success .success-share-cta [lang]'),
            actionLabel: fontStyle('#state-lesson-success .ivp-choice-label-text [lang]'),
            playerOverlay: fontStyle('.ivp-overlay-text [lang]'),
            nonVideoUi: fontStyle('.chat-message-bubble [lang]'),
        };
    });

    expect(styles).toEqual({
        shareCta: 'normal',
        actionLabel: 'normal',
        playerOverlay: 'normal',
        nonVideoUi: 'italic',
    });
});
