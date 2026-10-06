# Add Terms of Service / Privacy Policy links to the sign-up modal footer

## Context

Every account-creation surface should point at the legal pages. The app already has a homepage/dashboard legal footer (`src/components/legal/LegalFooter.jsx`) plus public `/privacy` and `/terms` routes (registered before the `/:shareCode` catch-all and whitelisted in `PUBLIC_ROUTES`), but the sign-up surfaces themselves have no legal links.

Every place a learner can sign up must show the legal links. The app has three account-creation entry points, and all three are in scope:

1. `SaveClipsModal` (`src/components/modals/SaveClipsModal.web.jsx`) — the pre-video signup gate (story 034's "pre-video signup modal"), which renders the inline signup form `SaveClipsSignupForm.jsx`.
2. `GuestLoginModal` (`src/components/modals/GuestLoginModal.web.jsx`) — its `login-choice` step presents **Sign Up** (and Log In / Continue as Guest); clicking Sign Up navigates to `/signup`.
3. `SignupForm.web.jsx` — the standalone signup form rendered by `/signup` (where the modal's Sign Up buttons actually land).

## Out of Scope

- The **login** flow (`/login`, `LoginForm.web.jsx`) — only sign-up surfaces are in scope.
- Changing `LegalFooter` (the homepage/dashboard footer) or the legal pages/routes/content.
- A consent checkbox or any record of acceptance — only the links are requested.
- The "Not now" button, the `saveClipsModalOpen` state machine, and the native `<dialog>` Escape/backdrop behavior (story 034).
- Native (React Native) stubs — `SignupForm.native.jsx` and `GuestLoginModal.native.jsx` return `null`.
- Adding a `pt` translation for the legal link labels; `Strings.get` falls back to English.

## Implementation approach

**1. New shared component `src/components/legal/LegalLinks.jsx`.**
A small, dependency-free links row (mirrors the markup already in `LegalFooter.jsx`):

```jsx
// src/components/legal/LegalLinks.jsx
import React from 'react';
import { Link } from 'react-router-dom';
import Strings from '../../data/strings.js';

export default function LegalLinks({ lang = 'en' }) {
    const containerStyle = {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px',
        marginTop: '12px',
        fontSize: '12px',
        color: '#adb5bd',
    };
    const linkStyle = { color: '#adb5bd', textDecoration: 'underline' };

    return (
        <div data-testid="legal-links" style={containerStyle}>
            <Link to="/privacy" target="_blank" rel="noopener noreferrer" style={linkStyle}>
                {Strings.get('legal_privacy', lang)}
            </Link>
            <span aria-hidden="true">·</span>
            <Link to="/terms" target="_blank" rel="noopener noreferrer" style={linkStyle}>
                {Strings.get('legal_terms', lang)}
            </Link>
        </div>
    );
}
```

Rules:
- `data-testid="legal-links"` is the stable hook for tests.
- Small text is `font-size: 12px` on the container (body text is 16px).
- Labels come from the existing `legal_privacy` / `legal_terms` string keys, so en/es/fr/hi/bn are localized and an unsupported locale (`pt`) falls back to English via `Strings.get` (`src/data/strings.js:1774`).
- Order is Privacy · Terms to match the existing `LegalFooter` (visual consistency across the app).
- `target="_blank" rel="noopener noreferrer"` is required, not cosmetic: both modals are mounted once in `RootLayout` (`src/routes/RootLayout.jsx:21-22`) and their `<dialog>` open state is store-driven, so a same-tab `Link` navigation to `/privacy` would leave the modal's top-layer `<dialog>` covering the legal page and would discard the half-filled signup form. A new tab keeps both intact and the legal pages are public (`PUBLIC_ROUTES` in `src/modules/user/guest-modal-logic.js`), so the new tab never opens the guest modal.

**2. Render it at the bottom of both signup forms.**
Append `<LegalLinks lang={lang} />` as the last element of the returned fragment in both signup forms (`lang` is already computed in each):
- `src/components/modals/SaveClipsSignupForm.jsx` — after the `<div className="text-center mt-3">` login-link block (so it sits at the bottom of `SaveClipsModal`'s `.modal-body`, below the form and above the CSS-hidden "Not now" button).
- `src/components/auth/SignupForm.web.jsx` — after the matching login-link block.

Placement rule (explicit): in each file the `<LegalLinks` element must appear **after** the closing `</form>` tag (footer position), and outside any conditional render, so the links are present in the error state too.

**3. Render it in `GuestLoginModal`'s footer on both steps.**
`GuestLoginModal.web.jsx` renders one `<div className="modal-content">` that swaps between the `select-language` and `login-choice` step fragments. Append `<LegalLinks ... />` as the last child of that `.modal-content` `<div>`, **after** the `{guestModalStep === 'select-language' ? (…) : (…)}` expression, so the legal footer is on the modal regardless of step. Pass the step's language:

```jsx
<LegalLinks lang={guestModalStep === 'select-language' ? step1Lang : step2Lang} />
```

- Both `step1Lang` and `step2Lang` already exist in the component (lines 81/83).
- Placing it after the conditional (not inside either branch) is the explicit rule that makes it appear on **both** steps.

This attaches the links to the signup form components and to the modal shell rather than to a route, so any current or future surface that reuses a signup form inherits the footer automatically.

## Tasks

### Task 1 - Add the shared LegalLinks component

- `<LegalLinks />` rendered inside `MemoryRouter`
  - → `[data-testid="legal-links"]` exists
  - → it contains exactly two `a` elements
  - → their `href` values are `['/privacy', '/terms']`
  - → their text labels are `['Privacy Policy', 'Terms of Service']`
  - → each anchor has `target="_blank"` and a `rel` containing `noopener`
  - → the container's inline `font-size` is `12px`
- `<LegalLinks lang="es" />` rendered
  - → labels are `['Política de Privacidad', 'Términos del Servicio']`
- `<LegalLinks lang="pt" />` rendered (no `pt` entry in `legal_privacy`/`legal_terms`)
  - → labels fall back to `['Privacy Policy', 'Terms of Service']`

### Task 2 - Show the legal links on every sign-up surface

- `SaveClipsModal` rendered in `MemoryRouter` (store `saveClipsModalOpen: true`)
  - → `#saveClipsModal [data-testid="legal-links"]` exists
  - → its two anchors point to `/privacy` and `/terms`
  - → the legal-links block comes after the modal's `<form>` in document order
- `SaveClipsSignupForm` rendered in `MemoryRouter`
  - → `[data-testid="legal-links"]` exists with anchors `['/privacy', '/terms']`
  - → the legal-links block comes after the `<form>` in document order
- `SignupForm` (web, `/signup`) rendered in `MemoryRouter`
  - → `[data-testid="legal-links"]` exists with anchors `['/privacy', '/terms']`
  - → the legal-links block comes after the `<form>` in document order
- `SaveClipsSignupForm` rendered in `MemoryRouter` (no interaction, initial render)
  - → the legal links are present without any submit/interaction
  - → the legal-links element is **not** a descendant of the `<form>` (`form.contains(links) === false`), so clicking a legal link can never submit the signup form
- `GuestLoginModal` rendered in `MemoryRouter` (store `isGuestModalOpen: true, guestModalStep: 'login-choice', guestNativeLanguage: 'EN'`)
  - → `#guestLoginModal [data-testid="legal-links"]` exists
  - → its two anchors point to `/privacy` and `/terms`
  - → the legal-links element is a descendant of the modal's `.modal-content`
  - → `#guestSignupBtn` (the Sign Up CTA) is also present in the same render
- `GuestLoginModal` rendered (store `isGuestModalOpen: true, guestModalStep: 'select-language', guestDetectedLang: 'ES'`)
  - → `#guestLoginModal [data-testid="legal-links"]` also exists (the footer shows on both steps)
  - → the anchor labels are localized: `['Política de Privacidad', 'Términos del Servicio']`

## Notes

- **Every sign-up surface is covered:** `SaveClipsModal` (via `SaveClipsSignupForm`), `GuestLoginModal` (both steps), and the standalone `/signup` form (`SignupForm.web.jsx`). The native stubs are the only sign-up-related components left alone, and they render `null`.
- **GuestLoginModal footer is on both steps**, because it is one modal and the legal footer should not flicker in/out as the guest moves from language selection to the Log In / Sign Up choice; the labels follow the step's active language.
- No new dependencies. The tests run with the existing stack (React 19.2.0, react-router-dom 7.15.1, vitest 4.1.6 + jsdom). `SignupForm`, `SaveClipsSignupForm`, and `GuestLoginModal` all render in jsdom without mocking, so the tests assert the real DOM rather than source text (avoids the "guard that can never fail" class of bug from `docs/learnings.md`).
- Test files: `src/components/legal/LegalLinks.test.jsx` (Task 1) and `src/components/legal/signup-legal-links.test.jsx` (Task 2; renders all three sign-up surfaces).
- `LegalFooter` is intentionally left untouched; `LegalLinks` duplicates its two-label markup rather than sharing it, to avoid changing the homepage/dashboard footer that `LegalFooter.test.jsx` and `legal-wiring.test.js` already lock.

