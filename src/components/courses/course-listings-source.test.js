// Story 070 — raw-source guards for the `/courses` signed-out notice.
//
// These complement the behavioural DOM tests in `CourseListings.test.jsx`: those
// prove the rendered output, these pin the two structural facts that are easy to
// break with an innocent refactor and invisible in a screenshot —
//
//   1. the notice is declared ABOVE the `friend-courses-scroll` region, and
//   2. it is NOT nested inside the `userId`-gated install/notification block.
//
// Both are asserted as index order or nesting on RAW source, with each slice
// bounded at a real marker. Whole-file `toContain` is not used: it would stay
// green if the notice were deleted, because the string also appears in a
// comment (AGENTS.md: a guard must be able to fail).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(__dirname, 'CourseListings.jsx'), 'utf8');

describe('CourseListings notice placement', () => {
    it('declares the notice above the scroll region', () => {
        const noticeAt = src.indexOf('data-testid="courses-guest-notice"');
        const scrollAt = src.indexOf('data-testid="friend-courses-scroll"');
        expect(noticeAt).toBeGreaterThan(-1);
        expect(scrollAt).toBeGreaterThan(noticeAt);
    });

    it('keeps the notice a sibling of the scroll region, not a child of it', () => {
        // The gate that opens the scroll region and the one that closes it.
        const openAt = src.indexOf('<div data-testid="friend-courses-scroll"');
        expect(openAt).toBeGreaterThan(-1);
        // Bound the slice at the component's final closing `);` rather than EOF:
        // a function appended later would otherwise join the slice (AGENTS.md).
        const closeAt = src.indexOf('\n        </div>', openAt);
        expect(closeAt).toBeGreaterThan(openAt);
        const scrollBlock = src.slice(openAt, closeAt);
        expect(scrollBlock).not.toContain('courses-guest-notice');
        expect(scrollBlock).not.toContain('courses-guest-signin');
    });

    it('gates the notice and the signed-in banners off the same predicate', () => {
        expect(src).toContain('import { isGuestViewer, buildCoursesSignInHref }');
        // One predicate, two gates: `isGuest` for the notice, `!isGuest` for the
        // install/notification banners. A second inline sentinel would let the
        // two disagree about who is a guest.
        expect(src).toContain('const isGuest = isGuestViewer(userId);');
        expect(src).toMatch(/\{isGuest && \(\s*<div data-testid="courses-guest-notice"/);
        expect(src).toMatch(/\{!isGuest && \(\s*<>/);
        // The raw sentinel is not re-typed here — it lives in the logic module.
        expect(src).not.toContain("'guest'");
    });

    it('builds the sign-in href through the shared helper, not a literal', () => {
        expect(src).toContain('href={buildCoursesSignInHref()}');
        // A hardcoded /login?redirect= here could drift from the module the
        // /signup redirect uses.
        expect(src).not.toContain('/login?redirect=');
    });
});

// The whole spam argument for closing /signup rests on one fact: a friend
// lesson cannot be completed without a camera and mic, because the mode chooser
// withholds text and audio-only. `AGENTS.md` used to state the opposite as a
// standing rule ("always visible and usable", no exception), so the next agent
// reasoning about this funnel would have started from a falsehood.
describe('the friend-lesson text-mode exception is documented', () => {
    const agentsSrc = readFileSync(path.join(__dirname, '..', '..', '..', 'AGENTS.md'), 'utf8');

    it('AGENTS.md carries the exception inside the voice-first rule, not elsewhere', () => {
        const ruleAt = agentsSrc.indexOf('**Voice-first, text available (product rule).**');
        expect(ruleAt).toBeGreaterThan(-1);
        // Bound at the next bolded paragraph heading, never at EOF.
        const end = agentsSrc.indexOf('\n**', ruleAt + 10);
        expect(end).toBeGreaterThan(ruleAt);
        const rule = agentsSrc.slice(ruleAt, end);
        expect(rule).toMatch(/Exception:\s*a friend lesson is video-only/);
        // Names the code that implements it, so the rule is checkable.
        expect(rule).toContain('IntroChoices.jsx');
        expect(rule).toContain('stories/070-lazy-signup-funnel/story.md');
    });

    it('IntroChoices really does withhold text on a friend lesson', () => {
        // Without this the documented exception is a claim about nothing.
        const introChoices = readFileSync(
            path.join(__dirname, '..', 'widgets', 'IntroChoices.jsx'),
            'utf8',
        );
        expect(introChoices).toMatch(/const textOnlyBtn = friendLesson \? null :/);
        // Audio-only is gated the same way.
        expect(introChoices).toMatch(/\{!friendLesson && \(\s*<button[^}]*id="audioOnlyButton"/);
    });
});