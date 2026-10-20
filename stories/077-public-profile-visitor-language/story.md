# The public profile reads in the visitor's language, not the profile owner's

## Context

The public profile (`/:shareCode`) is read by a **visitor** — someone who
opened a link a friend shared — but it was localized by the language of the
**profile being read**:

```jsx
// src/components/profile/PublicProfile.jsx (before)
const lang = profile.native_language?.toLowerCase() || 'en';
```

Every string on the page then came from that code: the heading, the stats
labels, the friend-practice area and the "User not found" state. So a Spanish
learner opening a Hindi speaker's profile read the page in **Hindi** — the one
language the visitor cannot read. The "member since" date was formatted in the
owner's locale too, so even the date order was wrong for the visitor.

The app already has the answer for "which language is the visitor reading?",
and it is used everywhere else: the guest-first session language,
`guestNativeLanguage || userData?.native_language || 'en'`
(`useNativeLanguage()` → `resolveConfigLanguage`, AGENTS.md). `HomeLandingContainer`
and `NotFoundRoute` — including the 404 page that shares this page's styling —
already resolve it that way. The public profile was the outlier: it read the
owner's `native_language` instead.

There is a second, smaller inconsistency: the "not found" branch resolved the
language by hand from the store (`appStore.getState().guestNativeLanguage ||
appStore.getState().userData?.native_language || 'en'`) instead of through the
hook, so it was not reactive and could disagree with the rest of the app.

## Out of Scope

- **The owner's own language on the page.** The profile does not display it
  today ("Native Language" is a field of the *private* profile editor), and
  adding it is a product decision, not a localization fix.
- **Browser-language auto-adoption on `/:shareCode`.** The public profile route
  deliberately never opens the guest modal (`isProfileRoute`), so an anonymous
  visitor with no stored language still reads the app default (English) — the
  same rule the 404 page follows. Silently adopting the browser language here
  (as the homepage does) is a separate product decision.
- **New translations.** The page reuses the existing `strings.js` copy; the
  only new key is the share-code label, which was hardcoded English.
- **Merging into `main`.**

## Implementation approach

### 1. One language source, the one the app already uses

`PublicProfile` resolves the language with `useNativeLanguage()` — the
guest-first session language — exactly like `HomeLandingContainer` and
`NotFoundRoute`. The owner's `native_language` is not read by the component at
all: the page has no business choosing a language from the profile it is
displaying.

The hook is called with the other hooks, before the loading / not-found early
returns, so both branches render the same language.

### 2. The date is formatted in the visitor's locale

The join date was formatted with `LOCALE_MAP[profile.native_language]`, i.e.
the owner's locale, and the lookup was case-sensitive (a lowercase or
region-tagged code missed `LOCALE_MAP` and silently fell back to English).

`src/modules/user/public-profile-logic.js` owns the formatting:

- `resolveProfileLocale(lang)` — the visitor's language code (any case/locale)
  → a BCP-47 locale tag, falling back to English for a code with no locale.
- `formatProfileJoinDate(joinDate, lang)` — the localized date, or `''` for a
  missing/unparseable date so the line is omitted instead of rendering
  "Invalid Date".

The date-fallback pattern follows `notification-logic.js`'s
`formatNotificationDate`, which resolves a locale from a language code the
same way.

### 3. The share-code label is localized

`Share Code:` was hardcoded English on a page that is now localized. It becomes
the `public_profile_share_code` key (en/es/pt/fr/hi/bn, like every other key
the strings table carries).

### 4. Guards

- `src/modules/app-language-guard.test.js` lists `PublicProfile.jsx` among the
  files that must resolve the language through the app's helpers and must not
  read `userData.native_language` directly.
- `PublicProfile.test.jsx` carries a raw-source guard proving the component
  never reads `native_language` off the profile (comments are stripped first,
  so the prose about the rule cannot satisfy the guard by itself).

## Tasks

- new `src/modules/user/public-profile-logic.js`
  → `resolveProfileLocale`, `formatProfileJoinDate` (pure, no React/DOM)
- `src/components/profile/PublicProfile.jsx`
  → `useNativeLanguage()` for every string + the join date; the ad-hoc store
    read in the not-found branch is gone
- `src/data/strings.js`
  → new `public_profile_share_code` key in six locales
- `src/modules/app-language-guard.test.js`
  → `PublicProfile.jsx` added to the resolution list
- new `src/modules/user/public-profile-logic.test.js`
- new `src/components/profile/PublicProfile.test.jsx`
  → the page renders in the visitor's language (and not in the owner's), the
    join date uses the visitor's locale, the not-found state is localized, plus
    the raw-source guard
- `tests/profile-visitor-lessons.spec.js`
  → the owner speaks Spanish, the visitor reads in Hindi: the page renders
    Hindi and no Spanish copy

## Acceptance criteria

1. the public profile renders its copy in the visitor's session language
   (`guestNativeLanguage || userData?.native_language || 'en'`)
   → `PublicProfile.test.jsx` renders with `guestNativeLanguage: 'HI'` and
   asserts the Hindi copy
2. the profiled user's own language never drives the page's copy
   → the same test with an owner whose `native_language` is `'ES'` asserts the
   Spanish copy is absent; a raw-source guard proves the component never reads
   `native_language` off the profile
3. the join date is formatted in the visitor's locale
   → `public-profile-logic.test.js` + a render test asserting the Spanish
   date format for a Spanish visitor
4. the "User not found" state is localized to the visitor's language
   → render test
5. the share-code label is localized (no hardcoded English "Share Code:")
   → render test + the new `strings.js` key carrying en/es/pt/fr/hi/bn
6. `PublicProfile.jsx` resolves the language through the app's single source of
   truth
   → `src/modules/app-language-guard.test.js` lists the file
7. `npx vitest run` reports 0 failures; `npm run build` and `npm run lint` exit
   0; the Playwright spec for the public profile passes
   → commands and output recorded in the completion report

## Notes for reviewers

- **The owner's language is not "wrong" data — it is simply the wrong input.**
  The owner speaks their own language; that is what the field means. The page
  must read in the *reader's* language, which is what the guest-first session
  language is for.
- **A first-time anonymous visitor still sees English.** The public profile
  route never opens the guest modal (so it never gates a profile behind a
  language prompt), and an anonymous visitor with no stored language has no
  preference to honour — the same behaviour as the 404 page. Browser-language
  adoption on this route is deliberately out of scope.
- **`useNativeLanguage()` keeps the store's casing** (`'ES'`, `'bn-BD'`).
  `Strings.get` and `resolveProfileLocale` both normalize internally, so the
  code is never used as a raw map key.
