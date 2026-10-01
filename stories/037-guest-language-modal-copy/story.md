# Update guest language-selection modal copy and dropdown

## Context

The initial guest language-selection step (`guestModalStep === 'select-language'` in `src/components/modals/GuestLoginModal.web.jsx`) picks the learner's translation language. In practice it renders only in English. Today English is a first-class dropdown option, and for an English browser `detectBrowserLanguage()` returns `'EN'`, which the modal prepends to the top of the list and pre-selects, so English is the de-facto default. Product wants the step to lead with the value of practicing English and to make "no translations" an explicit, discouraged exit rather than an ordinary option: remove English from the dropdown, start English browsers unselected, and relabel the two non-translation buttons.

## Out of Scope

- Translating the new English copy into es/pt/fr/hi/bn. Only English renders on this modal; the non-English values of the changed keys are left as they are.
- `PROFILE_LANGUAGES` and `SIGNUP_LANGUAGES` — English stays in both.
- Step 2 (`login-choice`) copy and behavior.
- Friend-lesson language handling (silent adoption, `resolveGuestModalPlan`) and the store actions `confirmGuestLanguage` / `setGuestLanguageSilent`.
- Reordering or curating the remaining 18 languages.

## Implementation approach

- **Data:** in `src/data/languages.js`, delete only the `{ value: 'EN', label: 'English' }` row from `GUEST_LANGUAGES`. `PROFILE_LANGUAGES` and `SIGNUP_LANGUAGES` are untouched. `GUEST_LANGUAGES` is currently consumed only by the guest modal and `src/data/languages.test.js`.
- **Extract the modal's pure list logic** into `src/modules/user/guest-modal-logic.js` (same home as the other guest-modal pure helpers) so it is unit-testable without React:
  - `buildGuestLanguageOptions({ detectedLang, languages })`:
    - `detectedLang` falsy or equal to `ENGLISH_LANG` (`'EN'`) → return `languages` unchanged (this is what stops an English browser from re-adding English as a synthetic option).
    - detected value present in `languages` → return that entry first, then the rest in original order.
    - detected value absent from `languages` → prepend one synthetic `{ value: detectedLang, label }` where `label` comes from `Intl.DisplayNames([detectedLang], { type: 'language' })`, falling back to the code.
    - The result must never contain an option with value `'EN'`.
  - `resolveInitialGuestSelection({ detectedLang })`: return `''` when `detectedLang` is falsy or `'EN'`; otherwise return `detectedLang`.
- **Modal (`GuestLoginModal.web.jsx`):**
  - `languageOptions = useMemo(() => buildGuestLanguageOptions({ detectedLang: guestDetectedLang, languages: GUEST_LANGUAGES }), [guestDetectedLang])`.
  - The pre-select effect sets `resolveInitialGuestSelection({ detectedLang: guestDetectedLang })`, so an English browser stays unselected (`''`).
  - `chosenName = selectedLang ? nativeName(selectedLang) : ''`. The Continue button stays `disabled={!selectedLang}`; when nothing is selected it is disabled and blank. This removes the previous `nativeName('EN')` fallback, which would otherwise render the bare code `EN` now that `EN` is no longer in `GUEST_LANGUAGES`.
- **Heading:** keep the existing `guest_language_title` key — `src/data/strings.test.js` requires every key to carry `hi` and `bn` copy, and adding a new English-only key would fail that test. Set its `en` to the two lines joined by `\n`: `"Practice English with Us Free!\nSelect your language for translations"`. Render by splitting the resolved string on `\n` and inserting a `<br />` between lines. The existing es/hi/bn values remain single-line, which only affects languages that are not rendered in practice.
- **Buttons:** update the `en` values of `guest_language_english_only` and `guest_language_not_listed`, and the matching JSX fallback literals, to the new copy. Keep the keys, element ids (`guestEnglishOnlyBtn`, `guestNotListedBtn`), and onClick handlers (`confirmGuestLanguage('EN')` / `('OTHER')`) unchanged — multiple e2e specs and `tests/helpers/lesson-e2e.js` click `#guestEnglishOnlyBtn` to clear the gate.
- Update the component's top JSDoc comment so its summary of the step-1 buttons matches the new labels.

## Tasks

### Task 1 — English removed from the guest dropdown; English browsers start unselected

- `GUEST_LANGUAGES` read from `src/data/languages.js`
  - → contains no entry with value `'EN'` and no label `'English'`
  - → still contains `'ES'`, `'HI'`, and `'BN'` (other options retained)
- `buildGuestLanguageOptions({ detectedLang: 'EN', languages: GUEST_LANGUAGES })`
  - → no option has value `'EN'`
  - → length equals `GUEST_LANGUAGES.length` (no synthetic English prepended)
- `buildGuestLanguageOptions({ detectedLang: 'ES', languages: GUEST_LANGUAGES })`
  - → first option value is `'ES'`
  - → length equals `GUEST_LANGUAGES.length` and values contain no duplicate
- `buildGuestLanguageOptions({ detectedLang: 'DA', languages: GUEST_LANGUAGES })`
  - → first option value is `'DA'` with a non-empty label
  - → remaining entries are `GUEST_LANGUAGES` unchanged
- `buildGuestLanguageOptions({ detectedLang: undefined, languages: GUEST_LANGUAGES })`
  - → returns `GUEST_LANGUAGES` unchanged
- `resolveInitialGuestSelection({ detectedLang: 'EN' })` → `''`
- `resolveInitialGuestSelection({ detectedLang: 'ES' })` → `'ES'`
- `resolveInitialGuestSelection({ detectedLang: undefined })` → `''`
- (source guard) `src/components/modals/GuestLoginModal.web.jsx` imports and calls both `buildGuestLanguageOptions` and `resolveInitialGuestSelection`

### Task 2 — Two-line heading

- `Strings.get('guest_language_title', 'en')` → `"Practice English with Us Free!\nSelect your language for translations"`
- `Strings.get('guest_language_title', 'hi')` and `('bn')` still return the existing Hindi/Bengali strings (guards the global hi/bn coverage test)
- (source guard) the modal resolves `guest_language_title` and renders it split on `\n` with a `<br` between the lines

### Task 3 — Relabel the two non-translation exits

- `Strings.get('guest_language_english_only', 'en')` → `"No translations (not recommended)"`
- `Strings.get('guest_language_not_listed', 'en')` → `"My language is not on this list (continue without translations)"`
- (source guard) the modal's JSX fallback literals for both buttons match the new copy
- `Strings.get('guest_language_english_only', 'hi')` and `('bn')` still return the existing values (no localization-coverage regression)

### Task 4 — Rendered modal behavior (component test)

Render `GuestLoginModal` inside `MemoryRouter`, seeding `appStore` with `{ isGuestModalOpen: true, guestModalStep: 'select-language', guestModalFriendMode: false }`.

- `guestDetectedLang: 'EN'` rendered
  - → `#guestLanguageSelect` has no `<option>` with value `'EN'` and no option whose text is `'English'`
  - → `#guestLanguageSelect` value is `''`
  - → `#guestLanguageContinueBtn` is disabled
  - → `#guestLoginModalTitleText` text contains both heading lines and contains a `<br>` element
  - → `#guestEnglishOnlyBtnText` text equals `"No translations (not recommended)"`
  - → `#guestNotListedBtnText` text equals `"My language is not on this list (continue without translations)"`
  - → clicking `#guestEnglishOnlyBtn` sets `appStore` `guestNativeLanguage` to `'EN'` and advances `guestModalStep` to `'login-choice'`
  - → clicking `#guestNotListedBtn` sets `appStore` `guestNativeLanguage` to `'OTHER'`
- `guestDetectedLang: 'ES'` rendered
  - → first option is `'ES'`, `#guestLanguageSelect` value is `'ES'`, and `#guestLanguageContinueBtn` is enabled with text `'Español'`

## Notes

- `src/data/strings.test.js` asserts every key in `strings.js` has non-empty Hindi (Devanagari) and Bengali copy, so no English-only key may be added. The heading stays a single key with an embedded `\n`.
- The modal uses `<dialog>` + `showModal()`; under jsdom the call may be a no-op or throw. The existing effect wraps it in try/catch, so rendering asserts on children regardless of `open`.
- `react-router-dom`'s `useLocation` requires a router wrapper; `Link` is only rendered on step 2.
- Playwright's default locale is `en-US`, so the existing e2e gate helpers (`#guestEnglishOnlyBtn`) exercise the English path; keep those ids and click behavior stable.
- Only English is rendered in practice; all other `guest_language_*` and `guest_modal_*` translations are intentionally left unchanged.
