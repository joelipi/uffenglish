# The public profile (and the rest of the app) shows the shared app header

## Context

The app has one shared header — the brand bar with the menu button, the UFF
logo and the notification bell, plus the slide-out drawer
(`src/components/layout/AppHeader.web.jsx`). It is mounted ONCE by the app
shell (`src/routes/AppShellLayout.jsx`), so every page inside the shell shows
the same header.

The **public share-code profile** (`/:shareCode`) was one of the pages outside
it, with its own chrome: a back arrow and the page title. So a visitor who
opened a friend's link (the most-shared link in the product) landed on a page
that looked like a different app — no menu, no drawer, no way to the rest of
the app except the back arrow.

The pages outside the shell were the landing page (`/`), the lesson player, the
auth pages, the public profile and the 404. Only the first two have a reason to
keep their own chrome: the landing page is a marketing page and the lesson
player has its own top bar. The auth pages, the public profile and the 404 do
not.

## Out of Scope

- **The landing page (`/`)** and the **lesson player** — they keep their own
  chrome, and their containers keep their own `100dvh`.
- **The drawer's contents** and the "is this viewer registered?" gate
  (`src/modules/navigation/app-menu-logic.js`) — unchanged.
- **The guest modal**: the public profile still never opens it
  (`isProfileRoute` in `guest-modal-logic.js`).
- **Merging into `main`.**

## Implementation approach

### 1. The routes move into the shell

`src/routes/routes.jsx`: the auth routes (`/login`, `/signup`,
`/recover-password`, `/reset-password`, `/confirm-email`), the public
share-code profile (`/:shareCode`) and the 404 (`*`) become children of the
app shell, alongside the pages that were already inside it. The shell's
children keep their order — the static routes first, then `/:shareCode`, then
`*` — so a mistyped single-segment path is still read as a share code and a
multi-segment one still falls through to the 404.

### 2. The pages stop claiming the frame

The shell owns the frame height, so a page inside it is a flex child of the
region below the header and must not claim `height: '100dvh'` (that overflows
the clipping `.video-frame` and cuts the bottom of the page off):

- `PublicProfile.jsx` — the container becomes `flex: 1; minHeight: 0` with
  `overflowY: 'auto'` (the page owns its scrolling); the loading state's
  centred spinner loses its `100dvh` too.
- `NotFoundRoute.jsx` — the same (`flex: 1; minHeight: 0`), so the 404 is
  centred in the region below the header instead of the whole viewport.
- `AuthLayout.jsx` — `flex: 1; minHeight: 0`, and its **own gradient logo bar
  is removed**: the shell's header already carries the UFF logo, so keeping a
  second one would stack two bars. The centred login/signup card stays.

### 3. The guards follow

- `src/routes/app-shell-header.test.jsx` — the public profile, the 404 and the
  auth pages move from the "outside" list to the "inside" list, and the guard
  that kept the public profile out of the shell now asserts it is INSIDE it.
- `src/routes/not-found-routing.test.jsx` — the profile and the 404 are now
  rendered through the shell, so the shell's header is stubbed there (that test
  is about route matching, and the header has its own guard).

## Tasks

- `src/routes/routes.jsx` → the auth routes, `/:shareCode` and `*` move into the shell's children
- `src/components/profile/PublicProfile.jsx` → the container and the loading state become flex children
- `src/routes/NotFoundRoute.jsx` → the container becomes a flex child
- `src/routes/AuthLayout.jsx` → the container becomes a flex child; the duplicate logo bar is removed
- `src/routes/app-shell-header.test.jsx` → the inside/outside lists follow
- `src/routes/not-found-routing.test.jsx` → the shell's header is stubbed
- `AGENTS.md` → the rule now reads "every page except the landing page and the lesson player"

## Acceptance criteria

1. the public share-code profile shows the shared app header (the menu button,
   the logo, the drawer)
   → the shell-header guard lists `/abcd` among the inside paths and renders
     the header there
2. the 404 page and the auth pages are inside the shell too
   → the shell-header guard lists `*`, `/login`, `/signup` and
     `/confirm-email` among the inside paths
3. only the landing page and the lesson player stay outside the shell
   → the shell-header guard's outside list is exactly `['/',
     '/course/model/lesson/m-g']`
4. no page inside the shell claims `height: '100dvh'` (the bottom would be cut
   off under the header)
   → the public profile, the 404 and the auth layout use `flex: 1;
     minHeight: 0`
5. the auth pages show ONE logo bar (the shell's header), not two
   → `AuthLayout` no longer renders its own header bar
6. `npx vitest run` reports 0 failures; `npm run build` and `npm run lint` exit
   0; the public-profile browser spec passes
   → commands and output recorded in the completion report

## Notes for reviewers

- **The profile's own title row stays** (the back arrow + "Practice Speaking
  English with Me"): it is a title strip in the style the other inside pages
  use, not a second gradient bar.
- **The route order inside the shell matters**: the static routes come before
  `/:shareCode`, which comes before `*`.
- **The public profile still never opens the guest modal** — the header's
  drawer is a different thing (it is the app's navigation, and it is available
  to anonymous visitors).
