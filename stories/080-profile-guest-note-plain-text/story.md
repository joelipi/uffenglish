# The "no account yet" note on the public profile is plain text and points at the links below

## Context

The logged-out banner on a public profile had two lines:

```
Log in to see lessons you've done together.      ← a link to /login?redirect=…
No account yet? You can start practicing free.    ← a link to #friend-lesson-links
```

The second line was an anchor that jumped to the section's own anchor id
(`#friend-lesson-links`) — the anchor the links below it already live under. So
it was a link that pointed at the block of links directly beneath it: clicking
it moved the page by a few pixels and taught the visitor nothing about what to
do next. Its wording ("You can start practicing free") also did not say where
the practice was.

The banner only renders in the section's **active** mode (the expired branch
returns before it), so there is always a set of lesson links below it.

## Out of Scope

- **The "Log in to see lessons you've done together." line** — still a link to
  the login page with the `?redirect=` contract.
- **The lesson links themselves** and the 48h window.
- **New copy for the expired state** ("All this user's lessons have expired…").
- **Merging into `main`.**

## Implementation approach

`VisitorLoginBanner` (`src/components/profile/FriendLessonLinksSection.jsx`)
renders the second line as a `<p>` instead of an `<a>`: the same muted colour,
no underline, no `href`. The wording changes to say what to do and where:

> No account yet? Start practicing free. Click one of the links below to start.

The copy lives in `src/data/strings.js` under `profile_guest_start_free`, in all
six locales the table carries (en/es/pt/fr/hi/bn).

The element's test id changes with it: `visitor-guest-link` →
`visitor-guest-note`, because it is no longer a link (story 064 named it
`visitor-guest-link` when it was an anchor).

## Tasks

- `src/components/profile/FriendLessonLinksSection.jsx`
  → the guest line becomes plain text (`<p>`), with the `visitor-guest-note`
    test id
- `src/data/strings.js`
  → `profile_guest_start_free` carries the new wording in en/es/pt/fr/hi/bn
- `src/components/profile/FriendLessonLinksSection.test.jsx`
  → asserts the new copy, that the element is a `<p>`, and that no
    `visitor-guest-link` anchor is rendered
- `tests/profile-visitor-lessons.spec.js`
  → the browser assertion follows the new copy/test id
  → and the fixture injection now waits for the profile query to settle
    (`networkidle`) before writing the row into the query cache: the in-flight
    fetch resolved with "no such profile" and overwrote the injected row, so
    the page stayed on "User not found" with no links (a pre-existing flake in
    this spec, not caused by this change)

## Acceptance criteria

1. the "no account yet" line is plain text — not a link
   → the component test asserts the element is a `<p>`, that it contains no
     anchor, and that no `visitor-guest-link` element is rendered
2. the copy reads "No account yet? Start practicing free. Click one of the
   links below to start."
   → the component test and the browser spec assert the exact text
3. the copy is translated (the page reads in the visitor's language)
   → `strings.js` carries en/es/pt/fr/hi/bn; the strings coverage test
     (every key must carry hi + bn) passes
4. the "Log in…" line is unchanged and still links to
   `/login?redirect=<profile>`
   → the component test and the browser spec keep asserting it
5. `npx vitest run` reports 0 failures; `npm run build` and `npm run lint` exit
   0; the public-profile browser spec passes
   → commands and output recorded in the completion report

## Notes for reviewers

- **The note is only rendered when there are links below it** (the expired
  branch returns before the banner), so "click one of the links below" is
  never a promise the page cannot keep.
- **The spec's fixture injection was racing the profile query.** Waiting for
  the network to settle before writing the row into the query cache makes the
  spec deterministic; without it the injected profile was overwritten by the
  in-flight request and the page kept showing "User not found".
