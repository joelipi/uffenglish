# The notification panel opens by itself when a notification arrives (bell icon only in a lesson)

## Context

The in-app inbox is visible only if the learner clicks the bell
(`NotificationsBell.web.jsx`: `open` starts `false` and only `handleToggle`
changes it). A friend answers while the app is open → the row appears in the
inbox (story 081 made the inbox refresh itself every few seconds) → but the
learner still has to notice the badge and click the bell to read what arrived.

The request: **when there are new notifications, the notification area should
be open by default** — on every view except the lesson, where only the usual
bell icon shows.

## Why the lesson is excluded

The lesson player is the one screen where a panel that opens by itself is
harmful: it is a focused, full-screen activity (video, microphone capture,
answering) and the inbox panel would drop over the lesson content while the
learner is speaking or recording. The lesson already has its **own** bell —
`ActivityStats` renders `<NotificationsBell … compact />` inline with the
trophy and streak icons, and `ActivityStats` is used **only** by
`LessonContainer` — so the `compact` prop is an exact proxy for "in a lesson"
and no new plumbing is needed.

## Out of Scope

- **Changing what "viewed" means** (the `read_at` column, the dedupe upsert,
  the 48-hour copy) — the auto-open reuses the existing rule: a panel that is
  on screen counts as viewed.
- **A toast / OS-level popup.** This is the in-app panel under the bell.
- **Marking read per item, or a "mark all read" button.**
- **The web-push channel** (story 063) — unrelated.

## Implementation approach

The decision is domain logic, so it lives in the pure module
`src/modules/notifications/notification-logic.js`:

```js
shouldAutoOpenNotificationPanel({ previousUnreadCount, unreadCount, compact, isOpen })
```

- `compact` → never (the lesson keeps the bell icon only);
- `isOpen` → never (it is already showing the inbox);
- `unreadCount <= 0` → never (nothing unviewed);
- otherwise → only when the unread count **grew**: unviewed notifications
  appeared, either while the app was open or while it was closed (the user
  comes back to an inbox that is waiting for them).

The bell container keeps the previous unread count in a ref and, when the rule
says yes, opens the panel **and marks the unread rows read** — exactly what a
manual open does (`handleToggle`), because the panel is on screen. The badge
therefore clears at the same moment the panel appears, and the inbox never
shows a notification as unread while displaying it.

Marking read on the auto-open also keeps the panel from re-opening itself: the
count goes back to zero, so the next arrival is the only thing that can open
it again.

## Tasks

- `src/modules/notifications/notification-logic.js`
  → `shouldAutoOpenNotificationPanel(...)` (pure, no React/DOM)
- `src/components/homescreen/NotificationsBell.web.jsx`
  → the container tracks the previous unread count and opens the panel (and
    marks the unread rows read) when the rule says so
- `src/modules/notifications/notification-logic.test.js`
  → the rule: the lesson carve-out, the "already open" and "nothing unread"
    cases, and the count-grew condition
- `src/components/homescreen/NotificationsBell.web.test.jsx` (new)
  → the container: a notification arriving opens the panel and marks the rows
    read; the compact (lesson) bell does neither; a manual close is respected
- `tests/notifications.spec.js`
  → the browser assertion: a notification that arrives while `/home` is open
    opens the panel by itself, with no click
- `src/modules/video/recorder-page.test.js`
  → the per-story allowlist gains this story's paths

## Acceptance criteria

1. a notification that arrives while an inside page is open opens the inbox
   panel by itself
   → the container test re-renders with a new unread row and asserts the panel
     is rendered; the browser spec adds a row to the stubbed server and waits
     for the panel to appear with no click
2. the panel does not open when there is nothing unviewed
   → the container test asserts no panel with an empty inbox, and the rule
     returns false for `unreadCount: 0`
3. the lesson keeps the bell icon only — the panel never opens by itself there
   → the container test renders the bell in `compact` mode and asserts no
     panel and no mark-read; the rule returns false for `compact: true`
4. a manual close is respected — the panel does not spring open again
   → the container test closes the panel and asserts it stays closed while the
     unread count does not change
5. opening the panel (by hand or by itself) marks the notifications read, as
   before
   → the container test asserts the mark-read mutation is called with the
     unread ids
6. `npx vitest run` reports 0 failures; `npm run build` and `npm run lint`
   exit 0; the notifications browser spec passes
   → commands and output recorded in the completion report

## Notes for reviewers

- **The bell is mounted once by the app shell**, so the panel opens once per
  arrival, not once per page: the panel's `open` state lives in the shell's
  header and survives route changes.
- **The auto-open marks the rows read**, which is what stops the panel from
  re-opening itself: the unread count falls back to zero, so only the *next*
  arrival can open it again. It also matches the existing meaning of
  "viewed" — the panel is on screen.
- **The count-grew condition covers the "the app was closed" case** for free:
  the inbox query resolves with the unread rows the learner missed, the count
  goes from 0 to N, and the panel opens.
- **`compact` is the lesson switch**, not a new prop: `ActivityStats` is the
  only other consumer of the bell and it is used only by `LessonContainer`.
