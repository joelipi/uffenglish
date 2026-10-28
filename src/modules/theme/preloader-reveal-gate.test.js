import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { LANG_HEADING_FAMILIES } from './brand-fonts.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..', '..');
const read = (...segments) => readFileSync(path.join(ROOT, ...segments), 'utf8');

const INDEX_HTML = read('index.html');

/**
 * Comments stripped, for bare-identifier checks only. The explanatory comment
 * beside the face list names the very families the "must not force-load"
 * assertions look for, so leaving comments in would let prose satisfy them (or
 * trip them spuriously).
 *
 * The line-comment pattern requires the `//` NOT to follow a colon, so the
 * `//` in `https://fonts.googleapis.com` survives — these are not URL checks,
 * but there is no reason to risk it.
 */
const CODE = INDEX_HTML
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** The inline reveal script, by its marker line. */
const REVEAL_SCRIPT = (() => {
    const start = INDEX_HTML.indexOf("(function () {");
    expect(start, 'no reveal script in index.html').toBeGreaterThan(-1);
    const end = INDEX_HTML.indexOf('</script>', start);
    return INDEX_HTML.slice(start, end);
})();

const SCRIPT_CODE = REVEAL_SCRIPT.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('preloader reveal gate', () => {
    // Why this exists: the brand fonts load non-render-blocking so the Whisper
    // model download can start early, which means the first paint can land
    // before the webfonts. The preloader cover is held until the first-paint
    // faces resolve so the user is never shown the fallback stack and then a
    // swap — the gate is what makes the non-blocking font load safe.

    describe('the cover is held, then lifted', () => {
        it('no longer lifts merely because React rendered', () => {
            // The old rule was `#root:not(:empty) ~ #appLoadingImageDiv`, which
            // lifted on mount regardless of whether the fonts had arrived — the
            // exact behaviour this gate replaces.
            expect(CODE).not.toMatch(/root:not\(:empty\)\s*~\s*#appLoadingImageDiv/);
        });

        it('lifts on an explicit app-ready class', () => {
            expect(CODE).toMatch(/\.app-ready\s+#appLoadingImageDiv\s*\{[^}]*display:\s*none/);
            expect(SCRIPT_CODE).toContain("classList.add('app-ready')");
        });

        it('reveals with no interaction required', async () => {
            // The timing assertion lives in Playwright (a unit test cannot see
            // document.fonts or a CSS animation). What matters here is that the
            // spec exists AND is not in playwright.config's testIgnore, which is
            // how a stale spec silently reports green without running.
            const spec = read('tests', 'preloader-reveal.spec.js');
            expect(spec).toContain('preloader reveal gate');
            expect(spec).toContain('#appLoadingImageDiv');

            const config = read('playwright.config.js');
            const ignored = config.slice(config.indexOf('testIgnore'), config.indexOf(']', config.indexOf('testIgnore')));
            expect(ignored).not.toContain('preloader-reveal');
        });
    });

    describe('the gate can never hold the app hostage', () => {
        it('is capped at 2 seconds', () => {
            // The cover is a 2s loading state by design, not a wait for the
            // network — a slow or blocked font CDN must fall through to the cap.
            expect(SCRIPT_CODE).toMatch(/CAP_MS\s*=\s*2000/);
        });

        it('has a minimum display floor of the same window', () => {
            // Without the floor the cover vanishes after ~300ms on a warm cache,
            // which is what made the preloader image effectively invisible, so
            // the minimum is as load-bearing as the cap. A value out of range on
            // either side breaks this (too short: no perceptible image; too long:
            // holds an idle user hostage).
            expect(SCRIPT_CODE).toMatch(/MIN_DISPLAY_MS\s*=\s*2000/);
        });

        it('races the faces against that cap', () => {
            // Composition, not mere presence: with `Promise.race` and
            // `setTimeout(resolve, CAP_MS)` checked separately, deleting `cap`
            // from the race array leaves both strings still in the file and the
            // guard stays green while the cap no longer bounds anything.
            // Two composition guards: the cap is still raced, and `minDisplay`
            // is actually a member of the inner Promise.all — deleting it from
            // the array alone must still fail. Both are tested by mutation.
            expect(SCRIPT_CODE).toMatch(
                /Promise\.race\(\[\s*Promise\.all\(\[\s*whenFacesRegistered\(\)\.then\(loadFirstPaintFaces\),\s*whenAppRendered\(\),\s*minDisplay\s*\]\s*\)\s*,\s*cap\s*\]\s*\)\.then\(reveal,\s*reveal\)/
            );
            expect(SCRIPT_CODE).toMatch(/minDisplay\s*=\s*new Promise\([\s\S]{0,120}?setTimeout\(\s*resolve,\s*MIN_DISPLAY_MS\s*\)/);
            expect(SCRIPT_CODE).toMatch(/cap\s*=\s*new Promise\([\s\S]{0,80}?setTimeout\(\s*resolve,\s*CAP_MS\s*\)/);
        });

        it('resolves even if the gate itself throws', () => {
            // `.then(reveal, reveal)` — the rejection handler is what stops a
            // failed font load from leaving the app behind the image.
            expect(SCRIPT_CODE).toMatch(/\]\)\.then\(reveal,\s*reveal\)/);
        });

        it('gives up when document.fonts is unavailable and reveals immediately', () => {
            expect(SCRIPT_CODE).toMatch(/if \(!document\.fonts \|\| !document\.fonts\.load\)/);
        });

        it('has a CSS-only failsafe for when the script never runs', () => {
            // An inline-script failure must not strand the app; the animation
            // clears the overlay regardless. Its delay must be LONGER than the
            // JS cap, or it would preempt it.
            const animation = CODE.match(/animation:\s*preloaderFailsafe\s+0s\s+linear\s+(\d+)s/);
            expect(animation, 'no preloaderFailsafe animation').not.toBeNull();
            expect(Number(animation[1])).toBeGreaterThan(2000 / 1000);
            expect(CODE).toMatch(/@keyframes\s+preloaderFailsafe\s*\{[^}]*visibility:\s*hidden/);
        });

        it('bounds its own polling so it cannot loop forever', () => {
            expect(SCRIPT_CODE).toMatch(/POLL_TRIES\s*=\s*\d+/);
            // Both waits are bounded, not just the outer cap.
            expect(SCRIPT_CODE.match(/tries\+\+\s*>=\s*POLL_TRIES/g) ?? []).toHaveLength(2);
        });
    });

    describe('what it waits for', () => {
        it('waits for the faces on screen at first paint', () => {
            expect(SCRIPT_CODE).toContain("'400 1rem Inter'");
            expect(SCRIPT_CODE).toContain("'italic 700 1rem \"Titillium Web\"'");
            expect(SCRIPT_CODE).toContain("'900 1rem \"Titillium Web\"'");
        });

        it('waits for React to have painted, so it never reveals an empty frame', () => {
            // Also composition: `whenAppRendered()` has to be one of the two
            // things the race waits on, not merely defined somewhere.
            expect(SCRIPT_CODE).toMatch(
                /Promise\.all\(\[\s*whenFacesRegistered\(\)\.then\(loadFirstPaintFaces\),\s*whenAppRendered\(\),\s*minDisplay\s*\]\s*\)\s*,\s*cap/
            );
            expect(SCRIPT_CODE).toContain("getElementById('root')");
            expect(SCRIPT_CODE).toContain('childElementCount');
        });

        it('waits for the font faces to be REGISTERED before loading them', () => {
            // The stylesheet is non-blocking, so at parse time no @font-face rule
            // exists and document.fonts.load() would match nothing and resolve
            // instantly — lifting the cover before the fonts had started.
            expect(SCRIPT_CODE).toContain('document.fonts.length');
            expect(SCRIPT_CODE).toContain('whenFacesRegistered().then(loadFirstPaintFaces)');
        });

        it('passes a text sample so only the latin subset is pulled', () => {
            // Without the text argument document.fonts.load() fetches EVERY
            // unicode-range slice Google serves for the family (21 for Inter),
            // which on a phone is the opposite of the point of this gate.
            expect(SCRIPT_CODE).toMatch(/document\.fonts\.load\(face,\s*LATIN_SAMPLE\)/);
            expect(SCRIPT_CODE).toMatch(/LATIN_SAMPLE\s*=/);
        });

        it('never force-loads the :lang() override faces', () => {
            // Those CJK/Devanagari families are large and only needed once such
            // text is on screen; pre-pulling them would cost megabytes of every
            // user's first load.
            for (const family of LANG_HEADING_FAMILIES) {
                expect(SCRIPT_CODE).not.toContain(family);
            }
        });
    });

    describe('the image itself', () => {
        // Binary, so it must be read as a Buffer — the text `read` helper
        // would mangle it and has no byteLength.
        const image = readFileSync(path.join(ROOT, 'public', 'assets', 'img', 'uff-big.png'));

        it('is still a transparent PNG', () => {
            // The overlay gradient shows through it; JPEG would kill that.
            expect(image.subarray(1, 4).toString('latin1')).toBe('PNG');
            expect(image.subarray(12, 16).toString('latin1')).toBe('IHDR');

            // Transparency can be carried three ways, and the optimiser is free
            // to move between them: 6 = RGBA, 4 = greyscale+alpha, 3 = indexed
            // with a tRNS chunk. The original was 6; the lossless re-encode is 3
            // with tRNS. What matters is that transparency survives at all — so
            // 3 is only acceptable if tRNS is actually present.
            const colourType = image.readUInt8(25);
            expect([3, 4, 6]).toContain(colourType);
            const hasTrns = image.includes(Buffer.from('tRNS'));
            if (colourType === 3) expect(hasTrns, 'indexed PNG without tRNS has no transparency').toBe(true);
            else expect(hasTrns).toBe(false);
        });

        it('stays within a sensible precache budget', () => {
            // The new genuine ship is ~92,782 B after optimisation. This
            // budget backstops against a future unoptimised multi-MB drop of a
            // 1080×1350 UFF logo; anything beyond 300 KB is likely raw Can't-avoid
            // source. (The previous 4 KB budget tracked a *different*, corrupted
            // sparse file.)
            expect(image.byteLength).toBeLessThanOrEqual(300000);
        });

        it('sits on the gradient, which is never transformed away', () => {
            // The grow/fade animates .appLoadingImage only. If someone moved the
            // animation onto #appLoadingImageDiv the gradient would scale with
            // it and its edges would show through the transparent PNG.
            expect(CODE).toMatch(/\.appLoadingImage\s*\{[^}]*animation:\s*preloaderImageIn/);
            expect(CODE).not.toMatch(/#appLoadingImageDiv\s*\{[^}]*transform:/);
            expect(CODE).toMatch(/#appLoadingImageDiv\s*\{[^}]*background:\s*linear-gradient/);
        });

        it('grows and fades in on mount', () => {
            const inFrames = CODE.match(/@keyframes preloaderImageIn\s*\{([\s\S]*?)\n\s{8}\}/);
            expect(inFrames, 'no @keyframes preloaderImageIn').not.toBeNull();
            const body = inFrames[1];
            // Percentages need a left boundary: without one `0%\s*\{` also
            // matches the `0%` inside `100% {`.
            const step = (pct) => {
                const m = body.match(new RegExp(`(?:^|[^0-9.])${pct}%\\s*\\{([^}]*)\\}`));
                expect(m, `no ${pct}% keyframe in preloaderImageIn`).not.toBeNull();
                return m[1];
            };
            expect(step(0)).toMatch(/opacity:\s*0\b/);
            expect(step(0)).toMatch(/scale\(\s*0?\.\d/);
            expect(step(100)).toMatch(/opacity:\s*1\b/);
            expect(step(100)).toMatch(/scale\(1\)/);
        });

        it('fades out on reveal, NOT on its own fixed timeline', () => {
            // This was a real bug: with one fixed-length animation the gate —
            // which reveals whenever the fonts and React are ready, typically a
            // few hundred ms in — hid the overlay while the keyframes were still
            // holding opacity 1, so the image popped away instead of fading.
            // The exit has to be triggered by the reveal, not by the clock.
            expect(CODE).toMatch(
                /\.app-revealing \.appLoadingImage\s*\{\s*animation:\s*preloaderImageOut\s+(\d+)ms/
            );
            const outFrames = CODE.match(/@keyframes preloaderImageOut\s*\{([\s\S]*?)\n\s{8}\}/);
            expect(outFrames, 'no @keyframes preloaderImageOut').not.toBeNull();
            expect(outFrames[1]).toMatch(/(?:^|[^0-9.])0%\s*\{\s*opacity:\s*1/);
            expect(outFrames[1]).toMatch(/(?:^|[^0-9.])100%\s*\{\s*opacity:\s*0/);

            // And the gate must actually drive it: add .app-revealing, wait for
            // that animation's animationend, and only then hide the overlay.
            expect(SCRIPT_CODE).toContain("classList.add('app-revealing')");
            expect(SCRIPT_CODE).toMatch(
                /addEventListener\('animationend'[\s\S]{0,160}animationName === 'preloaderImageOut'[\s\S]{0,80}hideCover\(\)/
            );
            // `.app-ready` (display:none) must be added by hideCover only — if
            // reveal() also set it directly, the fade would be skipped again.
            // A textual "not near reveal()" check cannot work here because
            // hideCover is nested inside reveal, so assert the count instead:
            // exactly one place in the whole script may hide the cover.
            expect(SCRIPT_CODE.match(/classList\.add\('app-ready'\)/g) ?? []).toHaveLength(1);
            expect(SCRIPT_CODE).toMatch(/function hideCover\(\)\s*\{[\s\S]{0,200}classList\.add\('app-ready'\)/);
        });

        it('hands off from the entry animation so the exit never jumps', () => {
            // If the reveal lands while `preloaderImageIn` is still running,
            // switching straight to the exit animation restarts it at opacity 1
            // and the image visibly jumps up before fading out.
            expect(SCRIPT_CODE).toMatch(
                /var entry = image\.getAnimations\(\)[\s\S]{0,200}animationName === 'preloaderImageIn'/
            );
            expect(SCRIPT_CODE).toMatch(
                /entry\.playState === 'running'\)[\s\S]{0,120}addEventListener\('finish',\s*startExit/
            );
            expect(SCRIPT_CODE).toMatch(/function startExit\(\)\s*\{\s*html\.classList\.add\('app-revealing'\)/);
        });

        it('keeps the logo centred through the entry and exit keyframes', () => {
            // The giant logo is centred by the absolutely-positioned img's own
            // `transform: translate(-50%, -50%)`. The grow/fade animations run on
            // the CONTAINER and only scale it (opacity + scale), so the keyframes
            // must never translate the container — a translate there would be the
            // one thing that could push the finished/filled logo off centre.
            expect(CODE).toMatch(/\.appLoadingImage img\s*\{[^}]*transform:\s*translate\(-50%\s*,\s*-50%\)/);

            const inFrames = CODE.match(/@keyframes preloaderImageIn\s*\{([\s\S]*?)\n\s{8}\}/);
            expect(inFrames, 'no @keyframes preloaderImageIn').not.toBeNull();
            expect(inFrames[1]).not.toMatch(/translate\(/);

            const outFrames = CODE.match(/@keyframes preloaderImageOut\s*\{([\s\S]*?)\n\s{8}\}/);
            expect(outFrames, 'no @keyframes preloaderImageOut').not.toBeNull();
            expect(outFrames[1]).not.toMatch(/translate\(/);
        });

        it('keeps ENTRY_FADE_MS in step with the entry animation duration', () => {
            const css = CODE.match(/preloaderImageIn\s+(\d+)ms/);
            const js = SCRIPT_CODE.match(/ENTRY_FADE_MS\s*=\s*(\d+)/);
            expect(Number(css[1])).toBe(Number(js[1]));
        });

        it('hides the cover even if the exit animation never ends', () => {
            // Generous enough to cover both the entry handoff and the exit.
            expect(SCRIPT_CODE).toMatch(
                /setTimeout\(hideCover,\s*EXIT_FADE_MS\s*\+\s*\d+\s*\+\s*ENTRY_FADE_MS\)/
            );
        });

        it('keeps EXIT_FADE_MS in step with the exit animation duration', () => {
            const css = CODE.match(/preloaderImageOut\s+(\d+)ms/);
            const js = SCRIPT_CODE.match(/EXIT_FADE_MS\s*=\s*(\d+)/);
            expect(Number(css[1])).toBe(Number(js[1]));
        });

        it('is idempotent when the cap and the faces both fire', () => {
            expect(SCRIPT_CODE).toMatch(
                /if \(html\.classList\.contains\('app-revealing'\)\) return;/
            );
        });

        it('survives a synchronous failure while wiring the gate up', () => {
            // Otherwise the only fallback is the 4s CSS failsafe and the 2s cap
            // silently becomes 4s.
            expect(SCRIPT_CODE).toMatch(/\}\s*catch \(error\)\s*\{[\s\S]{0,160}reveal\(\);/);
        });

        it('waits for React on the no-Font-Loading-API path too', () => {
            // This branch used to reveal immediately during head parse, before
            // React painted — inconsistent with the design rationale.
            expect(SCRIPT_CODE).toMatch(
                /if \(!document\.fonts \|\| !document\.fonts\.load\)\s*\{[\s\S]{0,200}whenAppRendered\(\)\.then\(reveal,\s*reveal\);[\s\S]{0,40}return;/
            );
        });

        it('drops the scale under prefers-reduced-motion', () => {
            const reduced = CODE.match(
                /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\s{8}\}/
            );
            expect(reduced, 'no reduced-motion block').not.toBeNull();
            expect(reduced[1]).toContain('@keyframes preloaderImageIn');
            expect(reduced[1]).not.toContain('transform');
        });
    });
});
