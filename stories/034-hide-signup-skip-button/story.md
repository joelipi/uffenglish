# Hide the pre-video signup modal's "Not now" button and align the name fields

## Context

When a guest presses the create-video button on the lesson success screen, `SaveClipsModal` (`src/components/modals/SaveClipsModal.web.jsx`) opens and gates video generation behind signup/login. Its "Not now" button (`#saveClipsNotNowBtn`) lets the guest dismiss the modal and generate the video without an account. Product wants that escape hatch hidden (the element stays in the DOM; only its visibility changes) so the modal reads as a signup gate.

Separately, the first/last name fields in both signup forms use `col-6` / `col-md-6` classes that do not exist in this repo's hand-written stylesheet: `src/assets/css/app.css` is a Bootstrap-subset that defines only `.col-4` (line 245), and Bootstrap's own grid CSS is never imported (`src/main.jsx` imports only `bootstrap-icons/font/bootstrap-icons.css`; no `bootstrap/dist/css` import exists anywhere). The `.row` wrapper is `display:flex; flex-wrap:wrap` (app.css:244), so the two name `<div>`s fall back to `flex: 0 1 auto` and shrink to content width instead of each taking half the row. The result is that the name inputs do not line up with the full-width email/password fields below them. The same dead classes appear in `src/components/auth/SignupForm.web.jsx` (the standalone `/signup` page), so both forms are fixed here.

## Out of Scope

- Removing the "Not now" button from the DOM, or changing `handleNotNow` / the `saveClipsModalOpen` state machine. The button is hidden with CSS only.
- Changing the native `<dialog>` Escape/backdrop close behavior. Escape and backdrop clicks still close the modal and run `handleDialogClose` → `handleNotNow`; that is unchanged.
- The pre-lesson `GuestLoginModal` (`#guestContinueBtn` "Continue as Guest") — a different modal, not the pre-video one.
- Any change to signup submission, validation, or Supabase calls.
- Adding Bootstrap's full grid CSS or importing the `bootstrap` package stylesheet.

## Implementation approach

**1. Hide the "Not now" button with CSS.**
Add a rule to `src/assets/css/app.css` in the existing modal section (near the `#guestLoginModal` block, ~line 2224) that targets the button by its existing id:

```css
#saveClipsNotNowBtn { display: none; }
```

- The element remains rendered in the DOM (React still mounts it; `handleNotNow` still exists), satisfying "hide, do not remove".
- `display: none` removes it from layout and from the accessibility tree, so it is not focusable and cannot be clicked.
- The id string `saveClipsNotNowBtn` appears as a literal in `SaveClipsModal.web.jsx`, so `vite-plugin-purgecss` (vite.config.js:43) retains the rule. This matches the existing pattern of id selectors in `app.css` (e.g. `#guestLoginModal` at line 2227).
- No JSX change to `SaveClipsModal.web.jsx` is required.

**2. Make the name fields align with the other fields.**
The root cause is the missing grid column classes. Add the missing classes to `src/assets/css/app.css` beside the existing `.col-4` rule (line 245), mirroring Bootstrap 5's grid semantics so the existing JSX class names become effective:

```css
.col-6 { flex: 0 0 auto; width: 50%; }
@media (min-width: 768px) {
    .col-md-6 { flex: 0 0 auto; width: 50%; }
    .mt-md-0 { margin-top: 0 !important; }
}
```

- `.col-6` is used by `SaveClipsSignupForm.jsx` (lines 38, 51) and applies at all widths.
- `.col-md-6` is used by `SignupForm.web.jsx` (lines 61, 72) and applies at ≥768px; below that the columns stack full-width, which is the intended mobile behavior.
- `.mt-md-0` is used by `SignupForm.web.jsx` line 72 (`col-md-6 mt-3 mt-md-0`) to cancel the mobile top margin once the columns sit side by side. `.mt-3` already exists (app.css:70); `.mt-md-0` does not.
- The `.row` wrapper's negative horizontal margins (`-0.5 * 1.5rem` each side, app.css:244) are cancelled by the columns' own padding only if the columns carry horizontal padding. Bootstrap columns normally carry `padding-right/left: calc(var(--bs-gutter-x) * .5)`. To keep the name row's outer edges flush with the full-width `.mb-3` fields (which have no negative margin), add the matching gutter padding to the new column classes:

```css
.col-6, .col-md-6 { padding-right: calc(var(--bs-gutter-x, 1.5rem) * 0.5); padding-left: calc(var(--bs-gutter-x, 1.5rem) * 0.5); }
```

  This makes the left edge of the first-name column and the right edge of the last-name column line up with the email/password inputs, and the gutter between the two name columns equal the row gutter. The existing `.col-4` rule is left untouched (out of scope; changing it would affect `ScoreBoard`).

**Alignment verification rule (explicit):** after the fix, in a viewport ≥768px, the left edge of `#save-clips-first-name` and the left edge of `#save-clips-email` must differ by ≤1px, and the right edge of `#save-clips-last-name` and the right edge of `#save-clips-email` must differ by ≤1px. The same holds for `#first-name` / `#email` on the standalone signup page.

## Tasks

### Task 1 - Hide the "Not now" button in the pre-video signup modal

- `SaveClipsModal` is open (`saveClipsModalOpen === true`) + the modal is rendered
  - → `#saveClipsNotNowBtn` is present in the DOM (`count() === 1`)
  - → `#saveClipsNotNowBtn` is not visible (`toBeHidden()`)
  - → its computed `display` is `none`
- `SaveClipsModal` is open + the modal is rendered
  - → the signup submit button (`#saveClipsModal form button[type="submit"]`) is still visible
  - → `#saveClipsLoginLink` (the log-in link) is still visible
- `src/components/modals/SaveClipsModal.web.jsx` source inspected
  - → still contains the `saveClipsNotNowBtn` element and the `handleNotNow` handler (button hidden, not removed)
- `src/assets/css/app.css` source inspected
  - → contains a `#saveClipsNotNowBtn` rule whose declaration includes `display: none`

### Task 2 - Align the first/last name fields with the other fields

- Standalone signup page (`/signup`) at viewport width ≥768px + form rendered
  - → `#first-name` and `#last-name` are each ~50% of the form width and sit side by side
  - → left edge of `#first-name` is within 1px of the left edge of `#email`
  - → right edge of `#last-name` is within 1px of the right edge of `#email`
  - → `#first-name` and `#last-name` have equal widths (within 1px)
  - → top edge of `#first-name` is within 1px of the top edge of `#last-name` (`mt-md-0` cancels `mt-3`)
- Standalone signup page at viewport width <768px + form rendered
  - → `#first-name` and `#last-name` stack vertically (each full width)
  - → `#last-name` has a non-zero top margin (`mt-3` applies; `mt-md-0` does not)
- Pre-video signup modal (`SaveClipsModal`) at viewport width ≥768px + form rendered
  - → left edge of `#save-clips-first-name` is within 1px of the left edge of `#save-clips-email`
  - → right edge of `#save-clips-last-name` is within 1px of the right edge of `#save-clips-email`
  - → `#save-clips-first-name` and `#save-clips-last-name` have equal widths (within 1px)
  - → top edge of `#save-clips-first-name` is within 1px of the top edge of `#save-clips-last-name`
- Pre-video signup modal at viewport width <768px + form rendered
  - → `#save-clips-first-name` and `#save-clips-last-name` remain side by side at ~50% width each (`col-6` applies at all widths; the modal form does not stack)
- `src/assets/css/app.css` source inspected
  - → contains `.col-6` and `.col-md-6` rules with `width: 50%`
  - → contains an `.mt-md-0` rule with `margin-top: 0`

## Technical Context

- **No new dependencies.** This is a CSS-only change plus test coverage. `package.json` already has `@playwright/test` (^1.60.0) and `vitest` (^4.1.6); no installs are needed.
- **Styling system:** `src/assets/css/app.css` is a hand-written Bootstrap-subset, not Bootstrap's stylesheet. Bootstrap's grid CSS is never imported (`src/main.jsx` imports only `bootstrap-icons/font/bootstrap-icons.css`). Only `.col-4` exists today (app.css:245). New grid classes must be added to `app.css`.
- **Purgecss:** `vite-plugin-purgecss` (vite.config.js:43) scans the built bundle. Class names used in JSX (`col-6`, `col-md-6`, `mt-md-0`) and the id `saveClipsNotNowBtn` all appear as literals in source, so the new rules are retained. The existing `safelist` does not need changes. If a production build is observed to strip any of these rules, add the selector to the `safelist` array in `vite.config.js` (the same mechanism already protects `ivp-token-*` and `step-*`).
- **Modal mechanics:** `SaveClipsModal` is a native `<dialog>` (`#saveClipsModal`) opened via `showModal()` when `saveClipsModalOpen` flips true (SaveClipsModal.web.jsx:33-47). The guest reaches it by pressing `#processBtn` on the success screen while not logged in (SuccessButtons.jsx:172-176). Escape/backdrop still close it and run `handleNotNow` (SaveClipsModal.web.jsx:72-76) — unchanged.
- **Test URL:** `http://localhost:3000/course/model/lesson/g` (lesson `g` carries the success step). The standalone signup page is `http://localhost:3000/signup`.
- **Test bypasses:** the guest modal is a native `<dialog>` in the top layer; dismiss it before interacting (agents.md §6). To mount the success screen without a real login, follow `tests/success-concat-button.spec.js` `setupSuccessScreen` (sets `isLoggedIn`/`userData` and `setSuccessScreen`). To open `SaveClipsModal` directly, set `appStore.getState().setSaveClipsModalOpen(true)` via `page.evaluate`.
- **Existing tests that touch the hidden button:** `tests/helpers/lesson-e2e.js:75`, `tests/landscape-warning.spec.js:21`, and `tests/whisper-engine-fallback.spec.js:31` click `#guestContinueBtn` (the *pre-lesson* modal), not `#saveClipsNotNowBtn`, so they are unaffected. No existing test clicks `#saveClipsNotNowBtn`.

## Notes

- The user explicitly asked to hide, not remove, the button. Do not delete the JSX element or the `handleNotNow` handler.
- Hiding "Not now" means the visible modal has no non-login action. The native `<dialog>` can still be dismissed with Escape or a backdrop click, which runs `handleNotNow` and lets generation proceed. This is existing behavior and is intentionally left unchanged; if product later wants to block that path too, it is a separate change.
- The `.col-4` rule is deliberately left as-is; it is used by `ScoreBoard` and is out of scope.
- Alignment is asserted by comparing `getBoundingClientRect()` edges of the name inputs against the email input, not by asserting class names, so the test verifies the rendered result rather than the implementation.
