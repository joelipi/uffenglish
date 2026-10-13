# The `/courses` page scrolls to reach every course card

## Context

The public course-listings page (`/courses`, story 056) renders longer than one screen: a back bar, the heading, the two-step numbered list, and one card per available friend course (today four: `friend`, `friendchain`, `wouldrather`, `wouldyourather`, each with a hero image and mission dropdown). The whole thing is clipped and **cannot be scrolled at all**.

Measured on the real page (Playwright, bundled Chromium, `http://localhost:3000/courses`):

| viewport | `#root` client height | `/courses` shell height | `#root` `overflow-y` | scrollable elements on the page | `scrollY` after an 800px wheel |
| --- | --- | --- | --- | --- | --- |
| 390×844 | 844 | 1299.75 | `hidden` | **none** | 0 |
| 1280×720 | 720 | 1308.19 | `hidden` | **none** | 0 |

Root cause: the app shell is a fixed 9:16 frame. `index.html` sets `html, body { height: 100%; overflow: hidden }` and `#root` is `.video-frame` (`overflow: hidden`, `height: 100%`). Every full-page route therefore has to own its own scrolling — `LegalPage.jsx` does it with an explicit `overflow: hidden` flex-column shell plus an inner `flex: 1; overflowY: auto` region (there is even a comment saying so, and `LegalPage.test.jsx` guards it), and `HomeScreen`/`PublicProfile`/`UserProfile` use `height: '100dvh'; overflowY: 'auto'`. `CourseListings` is the **only** page that uses `minHeight: '100dvh'` with no `overflowY` and no scroll region, so its content grows past the frame and is clipped with no scrollbar and no wheel/touch scrolling — the last three course cards are unreachable, and so is the plain-text onboarding step 2 on a short phone.

Why now: `/courses` is the destination of the profile's "Practice English Free" link, i.e. the entry point for a brand-new visitor with no share code. A visitor who cannot scroll it cannot start a conversation.

The fix follows the established `LegalPage` pattern: the page shell becomes a `100dvh` clipping flex column with a fixed (non-scrolling) header and one internal scroll region. `/courses` deliberately keeps the 9:16 phone frame (product decision recorded in `docs/product.md` — only `/` lifts it via `#root:has(> .uff-home-bs)`), so an internal scroll region is the correct shape, not a frame lift.

Verified fix (same Playwright harness, three viewports): the shell becomes 100dvh with `overflow: hidden`, the scroll region is `viewport − header` tall with `scrollHeight 1240–1248`, a wheel scroll moves it (`scrollTop` 456/588/700), the last course card reaches the viewport, and the back button stays visible.

## Out of Scope

- **Lifting the 9:16 phone frame on `/courses`.** `/courses` stays inside the phone frame like `/home`, `/profile`, `/:shareCode` and the lesson routes; only `/` is a full-width desktop page. This is the recorded product decision, not a bug.
- **Other routes' scrolling.** `/privacy` and `/terms` (`LegalPage`), `/home` (`HomeScreen`), `/profile` (`UserProfile`) and `/:shareCode` (`PublicProfile`) already have scroll regions. Only `/courses` is broken.
- **Making the header sticky/pinned with a shadow or gradient.** The existing dark header (background inherited from the shell, `1px solid #1a3a5a` bottom border) is kept exactly as-is; it only stops moving.
- **Any content, copy, layout, ordering, string, config or routing change.** No `src/config/*.json`, no `strings.js`, no `friend-courses-logic.js`, no `CourseListingsContainer`, no `routes.jsx`, no `guest-modal-logic.js` change.
- **A layout/scroll test for the lesson player, homepage, or profile pages.**
- **Native (React Native) implementations.**

## Implementation approach

### 1. `src/components/courses/CourseListings.jsx` — the page owns its scrolling

Mirror `LegalPage.jsx` exactly (same shell/scroll-region split, same `overflow: hidden` + `flex: 1; overflowY: auto` pair, same inline-style style object shape). Three style objects change and one wrapper element is added; nothing else in the file changes.

Shell (was `minHeight: '100dvh'` with no flex/overflow):

```js
const containerStyle = {
    height: '100dvh',
    display: 'flex',
    flexDirection: 'column',
    // index.html hides overflow on html/body (full-screen app shell) and #root is
    // the 9:16 .video-frame (overflow: hidden), so this page must own its
    // scrolling — same contract as LegalPage. `minHeight` alone grows the shell
    // past the frame and leaves it clipped with no scroller.
    overflow: 'hidden',
    backgroundColor: '#0b1a2a',
    color: 'white',
    fontFamily: "'Inter', 'Plus Jakarta Sans', sans-serif",
};
```

Header (unchanged visuals — same padding/border/gap — plus `flexShrink: 0` so it keeps its height and never scrolls):

```js
const headerStyle = {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    padding: '16px',
    borderBottom: '1px solid #1a3a5a',
    gap: '12px',
};
```

Scroll region (new; absorbs the old shell `paddingBottom: '40px'` so the last card keeps its bottom breathing room):

```js
const scrollStyle = {
    flex: 1,
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch',
    paddingBottom: '40px',
};
```

Markup: wrap the existing `<FriendCoursesView … />` (unchanged props) in the region; the header stays the shell's sibling:

```jsx
<div style={containerStyle}>
    <div style={headerStyle}>
        ...unchanged back button + title span...
    </div>
    <div data-testid="friend-courses-scroll" style={scrollStyle}>
        <FriendCoursesView lang={lang} courses={courses} isLoading={isLoading} isError={isError} />
    </div>
</div>
```

No `minHeight: 0` is needed on the region: an `overflow: auto` flex item has an automatic minimum size of `0`, so `flex: 1` shrinks it below its content (verified — the region measured 540px tall inside a 1240px-tall content column).

`FriendCoursesView`, `CourseListingsContainer`, `CourseMissionDropdown` and the pure `friend-courses-logic.js` module are untouched; the scroll region wraps the view's existing `padding: '24px 16px'` container, so spacing is unchanged.

### 2. Tests

**Unit (DOM, no source-text guard needed): extend `src/components/courses/CourseListings.test.jsx`** with a `describe('CourseListings scrolling', …)` block in the shape of `LegalPage.test.jsx`'s scrolling block (jsdom has no layout, so the contract is asserted on the inline styles React writes, exactly as `LegalPage.test.jsx:50-55` does). Reuse the file's existing `render(container, props)` helper.

**Browser: extend `tests/friend-courses.spec.js`** with one behavioural spec. It must be able to fail — with the current code `[data-testid="friend-courses-scroll"]` does not exist and the last card sits ~640px below a 600px viewport, so every assertion below fails today. Verified pre-fix (0 scrollable elements, `scrollTop` 0 after a 900px wheel) and post-fix (region 540/660/784px tall, `scrollTop` 700/588/456, last card in viewport) at 390×600, 1280×720 and 390×844.

## Tasks

### Task 1 — `/courses` shell owns its scrolling (`src/components/courses/CourseListings.jsx`)

- ready state (`courses` = 2 fixtures) + render
  - → an element `[data-testid="friend-courses-scroll"]` exists whose inline `overflowY` is `auto`
  - → that element's inline `flex` (or `flexGrow`) is truthy
  - → its `parentElement` has inline `height` `100dvh`, `display` `flex`, `flexDirection` `column`, `overflow` `hidden`
  - → the header row (`[data-testid="friend-courses-back"]`'s `parentElement`) is a descendant of the shell but **not** a descendant of the scroll region (`header.parentElement === shell` and `scroll.contains(header) === false`)
  - → `[data-testid="friend-courses-heading"]`, `[data-testid="friend-courses-steps"]` and every `[data-testid="friend-course-card"]` are all descendants of the scroll region
- loading state (`courses: undefined, isLoading: true`) + render
  - → the scroll region exists with inline `overflowY` `auto`
- error state (`courses: undefined, isError: true`) + render
  - → the scroll region exists with inline `overflowY` `auto`
- empty state (`courses: []`) + render
  - → the scroll region exists with inline `overflowY` `auto`

### Task 2 — the page actually scrolls in a browser (`tests/friend-courses.spec.js`)

- `/courses` loaded at a 390×600 viewport with the real configs (the 4 friend courses), after `await expect(page.getByTestId('friend-course-card').first()).toBeVisible()` so the assertions never race the config load
  - → `[data-testid="friend-courses-scroll"]` has `scrollHeight > clientHeight` (content genuinely overflows, so the next assertion is meaningful)
  - → after `page.mouse.move(…, mid-page)` + `page.mouse.wheel(0, 1000)`, its `scrollTop` is `> 0`
  - → after that scroll, the last `[data-testid="friend-course-card"]` is in the viewport
  - → after that scroll, `[data-testid="friend-courses-back"]` is still in the viewport (the header does not scroll away)
- the three pre-existing specs in this file (`lists the friend courses…`, `excludes the test fixture…`, `does not open the guest modal…`)
  - → still pass unchanged (no edits to them)

## Technical Context

No new runtime or dev dependencies; no `package.json` change. Relevant existing versions (`package.json`): React `19.2.0`, react-router-dom `7.15.1`, @tanstack/react-query `5.100.14`, vite `8.0.10`, vitest `4.1.6`, @playwright/test `1.60.0`.

- The scroll contract is already established in this repo, so this is not a new pattern: `src/components/legal/LegalPage.jsx:16-41` (`height: '100dvh'`, `display: 'flex'`, `flexDirection: 'column'`, `overflow: 'hidden'` shell + `flex: 1`, `overflowY: 'auto'`, `WebkitOverflowScrolling: 'touch'` region, `data-testid="legal-scroll"`) with its explanatory comment, unit-guarded by `LegalPage.test.jsx:40-55`; `HomeScreen.jsx:170-178`, `PublicProfile.jsx:14-21` and `UserProfile.jsx:271` use `height: '100dvh'; overflowY: 'auto'`.
- Why the frame cannot be relied on to scroll: `index.html` sets `html, body { height: 100%; overflow: hidden }`; `#root` is `class="video-frame …"` → `src/assets/css/app.css:347-368` (`overflow: hidden`, `height: 100%`, and at ≥576px `height: 100dvh`, `aspect-ratio: 9/16`). `CourseListings` was the only `src/**` page using `minHeight: '100dvh'` with no `overflowY`, so no scrollbar or wheel/touch scroll exists anywhere in its ancestor chain.
- Playwright spec runs at the config `baseURL` (`http://localhost:5173`, `playwright.config.js` `webServer`); the specs set their own viewport via `page.setViewportSize`. Bundled Chromium is fine here — no video/H.264 is involved.
- The repo's `tests/friend-courses.spec.js` helper `cardCourseIds` and the three existing tests stay as they are; only additive changes are wanted.
- `src/modules/video/recorder-page.test.js` scans every file under `src/**` for the operator recorder token; neither touched file contains it.

## Notes

- **Header behaviour is a deliberate decision.** The bug is "the page does not scroll", and the minimal fix could have been to let the header scroll away with the list (the `HomeScreen`/`PublicProfile` shape). This story instead keeps the header fixed, because `/courses` renders inside the 9:16 phone frame where the back button is the only in-app way back; scrolling it away would leave the visitor with no visible exit. Both shapes fix the bug; the `LegalPage` shape is the repo's own convention for exactly this situation. If the reviewer prefers the header to scroll away, only `headerStyle.flexShrink`/the wrapper position change — the ACs above would need adjusting.
- **The `minHeight: '100dvh'` removal is load-bearing, not cosmetic.** Keeping `minHeight` (or setting `height` alongside it) while adding `overflowY` to the same element does not fix the bug: the shell still grows to its content height inside the clipping frame, so the element's own `scrollHeight === clientHeight` and it never scrolls. The shell must be height-constrained to `100dvh` with the scrolling delegated to a child region.
- **The visual result is identical except that it scrolls.** Background, colours, header border, paddings (`24px 16px` from `FriendCoursesView`, `paddingBottom: 40px` moved onto the region) and card styles are unchanged; the header simply no longer moves.
- **Manual check:** `npm run dev`, open `/courses` on a phone-sized viewport, and confirm the last card can be reached and the back arrow stays visible. The whole flow is reachable without logging in — `/courses` is in `PUBLIC_ROUTES`.
- Knowledge for `docs/learnings.md` (implementer to judge whether it is worth an entry): "A full-page route inside `#root.video-frame` must own its scrolling (`height: 100dvh` + an inner `overflowY: auto` region); `minHeight: 100dvh` alone grows past the frame and is silently clipped."
