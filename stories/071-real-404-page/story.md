# A real 404 for unrecognized URLs, without breaking share links

## Context

There is no 404 page. Two different failures happen instead, decided purely by
how many segments the URL has (`src/routes/routes.jsx:55-56`):

| URL typed | Route matched | What the user sees |
| --- | --- | --- |
| `/nonsense` (one segment) | `/:shareCode` | **"User not found"** (`PublicProfile.jsx:61-77`) |
| `/a/b/c` (two or more) | `*` | Silently bounced to `/` (`<Navigate to="/" replace />`) |
| `/cources` (typo) | `*` | Bounced to `/` with no indication anything went wrong |

Both behaviours are wrong in different ways. A mistyped path is reported as a
**missing person**, and a multi-segment typo is **silently swallowed** — the user
is dumped on the homepage with no signal that the site is broken, which is the
"is this thing working?" feeling the signup redirect also produced.

Separately, one-segment URLs are genuinely ambiguous: `/nonsense` may be a
mistyped share link (the whole product is share-code based) or a bad path. Today
the app always guesses "share link", so every random path produces a "User not
found" page.

`/:shareCode` is **load-bearing** — it is how every shared lesson link resolves.
Anything here must treat a real share code as inviolable.

## Out of Scope

- **Changing what a share link does when the code is valid.** No new share-URL
  format, no slug migration, no change to `PublicProfile` for a found profile.
- **A server-side 404 status.** Pages serves the SPA shell for all paths; the
  response code stays 200. Changing that is a hosting/SEO project of its own.
- **SEO work** (custom 404 document, `sitemap.xml`, redirect map). Not asked for.
- **Softening the guest modal or any other route behaviour.**
- **Merging into `main`.**

## Implementation approach

### 1. Decide the one-segment ambiguity explicitly

Use the share-code shape already defined in `src/modules/utils/short-id.js`:
`ALPHABET` (32 chars, `abcdefghijkmnpqrstuvwxyz23456789`) and a length of 4+
(`toShortId`'s `minLength = 4`). A single path segment is treated as a share code
**only if** it matches that shape; otherwise it falls through to the real 404.

This is derived from the generator rather than a second hand-written regex, so a
change to the alphabet or the length cannot leave the two out of step.

Rejected alternative: keep guessing (treat every single segment as a share code).
Simpler, but a bot typing random paths still gets "User not found" pages and the
app never admits it does not know what a path is. The cost of the stricter rule
is one extra helper and a test; the benefit is correct semantics.

A mistyped share code (`abcd` → `abxd`) still lands on the "User not found"
page — the user genuinely did aim at a profile, and that message is right.

### 2. A real 404 route

Add a `NotFoundRoute` rendered for `*`, replacing `<Navigate to="/" replace />`.

- Localized via `strings.js` (`en/es/pt/fr/hi/bn`) — a hardcoded English page
  would be the one route in the app with no translations.
- Visually consistent with the existing not-found treatment in `PublicProfile`
  (warning glyph, centered copy) so the two read as one family rather than two
  unrelated screens.
- Offers the two useful exits: **Courses** (the page a lost visitor most likely
  wanted, and now the lazy-signup landing) and **Home**.
- Must call `finishPreloader()` like every other route, or the app sits behind
  the preloader on a page it can never leave.

### 3. Preserve share links, loudly

- `/:shareCode` stays declared **before** `*` (`routes.jsx:55-56` carries this
  same warning for `/courses` and `/friends`).
- The shape check only re-routes segments that **cannot** be share codes, so no
  valid link changes behaviour.
- Guards assert real codes (`abcd`, `k9gyi`, a 5-char code) still route to the
  profile, and that a truncated/uppercase/over-long segment does not.

## Tasks

### Task 1 — Share-code shape predicate

- new pure predicate in `src/modules/utils/short-id.js` (the generator's own home)
  → true for `abcd`, `k9gyi`, 5-char codes; false for `nonsense`, `Abcd` (the
    alphabet is lowercase), over-long strings, empty strings, non-strings
- derived from `ALPHABET` and the min length, not a duplicated literal
- unit tests, including the generated-code round trip: `toShortId(n)` is always
  accepted by the predicate

### Task 2 — `NotFoundRoute`

- new `src/routes/NotFoundRoute.jsx`
  → localized, `finishPreloader()` on mount, links to `/courses` and `/`
- new `strings.js` keys in six locales
- a render test asserting the copy is localized (not English) for `hi`

### Task 3 — Wire it up

- `routes.jsx`: `*` renders `NotFoundRoute` instead of `<Navigate to="/" replace />`
  → raw-source guard asserting the `Navigate`-to-home fallback is gone
- `/:shareCode` stays before `*`
  → raw-source index-order guard
- routing test: `/a/b/c` renders the 404 page; `/abcd` still routes to the
  profile route; `/nonsense` renders the 404 page rather than "User not found"

### Task 4 — Docs

- `docs/product.md` records the behaviour
- guard tests assert on raw source, scoped slices, and are proven failable

## Acceptance criteria

1. `isShareCodeSegment` accepts real share codes and rejects malformed ones, and
   is derived from `ALPHABET` + the min length rather than a second literal
   → `short-id` unit tests, including a `toShortId` round trip
2. a two-or-more-segment unknown URL renders the 404 page instead of redirecting
   to `/`
   → routing test + raw-source guard that `<Navigate to="/" replace />` is gone
3. the 404 page is localized in all six locales and renders non-English copy for
   `hi`
   → render test + `strings.test.js`
4. the 404 page calls `finishPreloader()`, so the app is not stuck behind it
   → render test asserting the preloader was finished
5. the 404 page links to `/courses` and `/`
   → render test
6. a valid share code still routes to the profile page, unchanged
   → routing test asserting `PublicProfileRoute` is still matched for `abcd`
7. `/:shareCode` is still declared before `*`
   → raw-source index-order guard
8. a one-segment URL that cannot be a share code shows the 404 page, not
   "User not found"
   → routing test for `/nonsense`
9. `docs/product.md` records the new behaviour
10. `npx vitest run` reports 0 failures; `npm run build` and `npm run lint` exit
    0; verified locally with no workflow dispatched
    → commands and output recorded in the completion report

## Notes for reviewers

- **`/:shareCode` is the product.** Every shared lesson link resolves through it,
  and a change that turns a real code into a 404 loses a share. The guards are
  written from that direction: assert the codes still route, not just that the
  404 appears.
- **The shape check is the risky part.** Any predicate stricter than the
  generator would reject codes the app itself mints. That is why Task 1 requires
  a `toShortId` round-trip assertion — it pins "everything we generate, we
  accept", which is the property that actually matters.
- **This stays a separate story from
  [070-lazy-signup-funnel](../070-lazy-signup-funnel/story.md) on purpose.** 070
  is a small reversible experiment; routing changes have a much larger blast
  radius and must be revertible independently.
- No status code changes (the SPA shell is always 200), so nothing here affects
  crawling — but it is worth remembering this is a UX fix, not an SEO one.