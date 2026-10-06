# Add Terms of Service / Privacy Policy links to the sign-up modal footer

## Context

Every account-creation surface should point at the legal pages. The app already has a homepage/dashboard legal footer (`src/components/legal/LegalFooter.jsx`) plus public `/privacy` and `/terms` routes (registered before the `/:shareCode` catch-all and whitelisted in `PUBLIC_ROUTES`), but the sign-up surfaces themselves have no legal links.

The sign-up modal is the pre-video signup gate: `SaveClipsModal` (`src/components/modals/SaveClipsModal.web.jsx`), which renders the inline signup form `SaveClipsSignupForm.jsx`. Story 034 calls `SaveClipsModal` "the pre-video signup modal" and `GuestLoginModal` "a different modal". The standalone signup form (`src/components/auth/SignupForm.web.jsx`, rendered by `/signup`) is the other account-creation surface and is included so both stay consistent (see Notes for the interpretation).

## Out of Scope

- `GuestLoginModal` — a language/login-choice modal, not a signup form (story 034 explicitly distinguishes it from the signup modal). Its "Sign Up" button navigates to `/signup`, which now carries the links.
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

**2. Render it as the bottom of every signup form.**
Append `<LegalLinks lang={lang} />` as the last element of the returned fragment in both signup forms (`lang` is already computed in each):
- `src/components/modals/SaveClipsSignupForm.jsx` — after the `<div className="text-center mt-3">` login-link block (so it sits at the bottom of `SaveClipsModal`'s `.modal-body`, below the form and above the CSS-hidden "Not now" button).
- `src/components/auth/SignupForm.web.jsx` — after the matching login-link block.

Placement rule (explicit): in each file the `<LegalLinks` element must appear **after** the closing `</form>` tag (footer position), and outside any conditional render, so the links are present in the error state too.

This attaches the links to the signup form components rather than to `SaveClipsModal`/`SignupRoute`, so any current or future surface that reuses a signup form inherits the footer automatically.

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

### Task 2 - Show the legal links in the sign-up modal and the standalone signup form

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

## Notes

- **Interpretation of "all the sign-up modals":** the codebase has exactly one true sign-up modal (`SaveClipsModal`, via `SaveClipsSignupForm`) plus the standalone `/signup` form (`SignupForm.web.jsx`). Both are wired here. `GuestLoginModal` is deliberately excluded (see Out of Scope). If product also wants the links on `GuestLoginModal`'s login-choice step, that is a one-line reuse of `LegalLinks` and a follow-up.
- No new dependencies. The tests run with the existing stack (React 19.2.0, react-router-dom 7.15.1, vitest 4.1.6 + jsdom). Both `SignupForm` and `SaveClipsModal` render in jsdom without mocking, so the tests assert the real DOM rather than source text (avoids the "guard that can never fail" class of bug from `docs/learnings.md`).
- Test files: `src/components/legal/LegalLinks.test.jsx` (Task 1) and `src/components/legal/signup-legal-links.test.jsx` (Task 2).
- `LegalFooter` is intentionally left untouched; `LegalLinks` duplicates its two-label markup rather than sharing it, to avoid changing the homepage/dashboard footer that `LegalFooter.test.jsx` and `legal-wiring.test.js` already lock.

