# Homepage share-code entry

## Context

Today the root route `/` renders `HomeScreen` (`src/components/homescreen/HomeScreen.jsx`, mounted by `src/routes/HomeRoute.jsx:10`), which shows the menu top bar, a hardcoded Grocery Shopping course card (`HomeScreen.jsx:190` navigates to `/course/model/lesson/g`), the notification bell, and a Continue button. An anonymous visitor to `/` gets the same screen and is then interrupted by the guest language/login modal (`useGuestModalGuard`, `src/hooks/use-guest-modal-guard.js`), which opens for every anonymous visitor on a non-auth route.

There is currently no way for a visitor to act on the core friend-challenge loop from the homepage: a friend who received a share code/link out of band has to be told the `/` + `?sharecode=` convention, and the profile-URL route `/:shareCode` (`src/routes/routes.jsx:35`) is undiscoverable. This story gives anonymous visitors a homepage whose only job is the friend loop: enter a friend's share code to open that friend's public profile, or, if they have no code, jump straight into the Would You Rather ask lesson to create their own.

The entry lookup reuses the existing public-profile query (`useUserByShareCode`, `src/modules/api/api.js:291`), which reads `public.public_profiles` with a `user_profiles` fallback. Share codes are generated lowercase-only from the alphabet `abcdefghijkmnpqrstuvwxyz23456789` (`src/modules/utils/short-id.js:1`), and both existing entry points normalize them with `trim().toLowerCase()` (`getShareCodeFromSearch` in `src/modules/user/friend-lesson-detection.js:17`, and `App.jsx:30`). The Supabase lookup itself is case-sensitive (`api.js:300/306`), so the homepage must normalize too.

## Out of Scope

- The guest language/login modal and `useGuestModalGuard` — the modal still opens for anonymous visitors on `/`, unchanged.
- `HomeScreen` and the logged-in homepage. Logged-in users keep the existing screen (menu, course card, notification bell, Continue).
- `PublicProfile` and its own not-found state (`PublicProfile.jsx:49-65`). A direct deep link to a bad `/:shareCode` is unchanged.
- The `?sharecode=` deep link captured in `App.jsx:19-37`.
- Accepting a pasted full URL (e.g. `https://ultrafastfluency.com/abc123`) in the input — the field accepts a bare share code only.
- Backend/Supabase schema, migrations, RLS, and the `public_profiles` view.
- R2, video, speech/Whisper, and recap behavior.
- Native stubs (`*.native.jsx`).
- New dependencies — everything needed is already in `package.json`.

## Implementation approach

### Decisions

- The new landing is shown **only to anonymous visitors**. Logged-in users keep `HomeScreen`. This matches the request's "the visitor" and avoids regressing the notification bell (story 019) and the course/Continue entry points. The choice is carried by `HomeRoute`, gated on `useAuthStatus`.
- "I don't have a share code" navigates to `/course/wouldrather/lesson/a`. Evidence: `src/config/wouldrather.json` is the Would You Rather course (lesson `a` is "Would You Rather? — Ask", `wouldrather.json:6-9`); `AppLayout.jsx:20` fetches a course by route param, so the filename `wouldrather` is the route course id. Lesson id `a` is a friend-challenge lesson (`friend-lesson-detection.js:13`), so the guest guard treats this target as a friend lesson (low friction). `wouldrather.json` has two lessons (`a`, `b`, `src/config/wouldrather.test.js:19`), so the destination exists.
- Share code normalization is `raw.trim().toLowerCase()`; no format validation. Invalid/unknown codes fall through to a "not found" result from the lookup rather than a format error, so a typo and a non-existent code produce the same, accurate message.
- "Go" looks the code up **before** navigating. Only a resolved profile navigates to `/<code>`; a null result or a failed lookup shows an inline error on the landing (not the profile page's not-found state).
- The lookup is a plain async function, not a hook, so the submit handler can await it. `useUserByShareCode` is refactored to delegate to it (single source of truth), preserving the existing query key and cache for `PublicProfile`.
- New UI copy is added to `src/data/strings.js` with `en/es/pt/fr/hi/bn` values. `src/data/strings.test.js` requires every key to carry Devanagari (hi) and Bengali (bn) copy, so these are mandatory.

### New module: `src/modules/user/share-code-entry-logic.js`

Pure, no React/DOM/store/Supabase — unit-testable.

```js
export const GO_LESSON_PATH = '/course/wouldrather/lesson/a';

const ERROR_KEYS = {
  empty: 'home_landing_code_required',
  not_found: 'home_landing_code_not_found',
  lookup_failed: 'home_landing_lookup_error',
};

export function normalizeShareCode(raw) {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toLowerCase();
  return code || null;
}

// Decide what a submitted code should do. `profile` is the lookup result
// (null when no profile exists). Normalization is idempotent, so callers may
// pass an already-normalized code.
export function planShareCodeSubmit({ rawCode, profile } = {}) {
  const code = normalizeShareCode(rawCode);
  if (!code) return { action: 'error', reason: 'empty' };
  if (!profile) return { action: 'error', reason: 'not_found' };
  return { action: 'navigate', to: `/${code}` };
}

export function shareCodeErrorStringKey(reason) {
  return ERROR_KEYS[reason] || ERROR_KEYS.lookup_failed;
}
```

### `api.js`: extract `fetchUserByShareCode`

Move the body of the `useUserByShareCode` `queryFn` (`src/modules/api/api.js:294-315`) into an exported async function and have the hook delegate, keeping the query key and the `public_profiles` → `user_profiles` fallback identical:

```js
export async function fetchUserByShareCode(shareCode) {
  const SAFE_COLS = 'id,first_name,...,friend_links';
  async function queryPublicProfiles() { /* unchanged */ }
  async function queryLegacy() { /* unchanged */ }
  try { return await queryPublicProfiles(); } catch { return await queryLegacy(); }
}

export function useUserByShareCode(shareCode) {
  return useQuery({
    queryKey: ['user', 'profile', 'shareCode', shareCode],
    queryFn: () => fetchUserByShareCode(shareCode),
    enabled: !!shareCode,
  });
}
```

### Presentational: `src/components/homescreen/HomeLanding.jsx`

Owns the input value locally. Props: `{ lang = 'en', error = null, loading = false, onSubmitCode, onNoCode, onInputChange }`.

- Renders headline `data-testid="share-code-headline"` (`home_landing_headline`), subheadline `data-testid="share-code-subheadline"` (`home_landing_subheadline`).
- A `<form>` whose submit (`e.preventDefault()`) calls `onSubmitCode(code)` with the raw field value; the Go button is `type="submit"`, `data-testid="share-code-go"`, label `home_landing_go`, and `disabled={loading}`.
- Input `data-testid="share-code-input"`, placeholder `home_landing_code_placeholder`, `autoCapitalize="none"`, `autoCorrect="off"`, `spellCheck={false}`; `onChange` sets local state and calls `onInputChange?.()`.
- When `error` is non-null, renders `data-testid="share-code-error"` with `role="alert"` and the string; nothing when null.
- A second button `data-testid="no-code"`, label `home_landing_no_code`, `onClick={onNoCode}`.
- Reuses the HomeScreen dark palette (`#0b1a2a` page, `#1a3a5a` card, `#2a4a6a` border) and brand gradient `linear-gradient(135deg, #3a8fd5 0%, #00c0d8 100%)`; inline styles, matching the existing components.
- A minimal top bar shows the UFF title (`home_title`) and a `Link to="/login"` labelled `sign_in` (both existing keys), so a visitor keeps a login entry point without HomeScreen's menu. No new string is needed. Because the component imports `Link`, its test renders it inside a `MemoryRouter` (or mocks `react-router-dom`).

### Container: `src/components/homescreen/HomeLandingContainer.jsx`

```js
const navigate = useNavigate();
const guestLang = useStore(appStore, s => s.guestNativeLanguage);
const userLang = useStore(appStore, s => s.userData?.native_language);
const lang = guestLang || userLang || 'en';
const [error, setError] = useState(null);
const [loading, setLoading] = useState(false);

async function handleSubmit(rawCode) {
  const code = normalizeShareCode(rawCode);
  if (!code) { setError(shareCodeErrorStringKey('empty')); return; }
  setLoading(true);
  try {
    const profile = await fetchUserByShareCode(code);
    const plan = planShareCodeSubmit({ rawCode: code, profile });
    if (plan.action === 'navigate') { setError(null); navigate(plan.to); return; }
    setError(shareCodeErrorStringKey(plan.reason));
  } catch {
    setError(shareCodeErrorStringKey('lookup_failed'));
  } finally {
    setLoading(false);
  }
}

function handleNoCode() { navigate(GO_LESSON_PATH); }
function handleInputChange() { setError(null); }

return <HomeLanding lang={lang} error={error ? Strings.get(error, lang) : null}
                    loading={loading} onSubmitCode={handleSubmit}
                    onNoCode={handleNoCode} onInputChange={handleInputChange} />;
```

`error` holds a string key while in the container and is resolved with `Strings.get(error, lang)` at render.

### Route gate: `src/routes/HomeRoute.jsx`

```js
const { finishPreloader } = usePreloader();
const { data: isLoggedIn, isLoading } = useAuthStatus();
useEffect(() => { if (!isLoading) finishPreloader(); }, [isLoading, finishPreloader]);
if (isLoading) return null;            // branded Preloader stays up until auth settles
return isLoggedIn ? <HomeScreen /> : <HomeLandingContainer />;
```

Deferring `finishPreloader` until auth resolves avoids flashing one screen and then the other.

### New strings (`src/data/strings.js`)

| key | en | es | pt | fr | hi | bn |
| --- | --- | --- | --- | --- | --- | --- |
| `home_landing_headline` | Practice English with your friends for free. | Practica inglés con tus amigos gratis. | Pratique inglês com seus amigos de graça. | Pratiquez l'anglais avec vos amis gratuitement. | अपने दोस्तों के साथ मुफ़्त में अंग्रेज़ी का अभ्यास करें। | বন্ধুদের সাথে বিনামূল্যে ইংরেজি চর্চা করুন। |
| `home_landing_subheadline` | Enter your friend's share code | Ingresa el código de tu amigo | Digite o código do seu amigo | Entrez le code de partage de votre ami | अपने दोस्त का शेयर कोड दर्ज करें | আপনার বন্ধুর শেয়ার কোড লিখুন |
| `home_landing_code_placeholder` | Share code | Código | Código | Code | शेयर कोड | শেয়ার কোড |
| `home_landing_go` | Go | Ir | Ir | Aller | जाएँ | যান |
| `home_landing_no_code` | I don't have a share code | No tengo un código | Não tenho um código | Je n'ai pas de code | मेरे पास शेयर कोड नहीं है | আমার কাছে শেয়ার কোড নেই |
| `home_landing_code_required` | Enter a share code to continue. | Ingresa un código para continuar. | Digite um código para continuar. | Entrez un code pour continuer. | जारी रखने के लिए शेयर कोड दर्ज करें। | চালিয়ে যেতে একটি শেয়ার কোড লিখুন। |
| `home_landing_code_not_found` | We couldn't find a friend with that share code. Check it and try again. | No encontramos a un amigo con ese código. Verifícalo e inténtalo de nuevo. | Não encontramos um amigo com esse código. Verifique e tente novamente. | Nous n'avons trouvé aucun ami avec ce code. Vérifiez-le et réessayez. | उस शेयर कोड वाला कोई दोस्त नहीं मिला। जाँच कर फिर से कोशिश करें। | সেই শেয়ার কোডে কোনো বন্ধুকে পাওয়া যায়নি। যাচাই করে আবার চেষ্টা করুন। |
| `home_landing_lookup_error` | Something went wrong. Please try again. | Algo salió mal. Inténtalo de nuevo. | Algo deu errado. Tente novamente. | Une erreur s'est produite. Veuillez réessayer. | कुछ गलत हो गया। कृपया फिर से प्रयास करें। | কিছু ভুল হয়েছে। আবার চেষ্টা করুন। |

None of these keys contain `{placeholders}`.

### Test plan

- Pure logic: `src/modules/user/share-code-entry-logic.test.js`.
- Presentational: `src/components/homescreen/HomeLanding.test.jsx` — `createRoot` + `act`, `globalThis.IS_REACT_ACT_ENVIRONMENT = true` (pattern: `src/components/homescreen/NotificationList.web.test.js`), wrapped in `MemoryRouter` because the component imports `Link`.
- Container: `src/components/homescreen/HomeLandingContainer.test.jsx` — `vi.mock('react-router-dom')` supplying **both** `useNavigate` (a `vi.fn()`) and a passthrough `Link` stub (the rendered `HomeLanding` uses `Link`), `vi.mock('../../modules/api/api.js')` for `fetchUserByShareCode`, and drive the real `HomeLanding` DOM; set language via `appStore.setState({ guestNativeLanguage: 'en' })`.
- Route: `src/routes/HomeRoute.test.jsx` — `vi.mock` `../modules/api/api.js` (`useAuthStatus`), `../components/homescreen/HomeScreen.jsx`, `../components/homescreen/HomeLandingContainer.jsx`, `../hooks/usePreloader.js`; assert which child renders per auth state.
- Strings: extend `src/data/strings.test.js` with an exact-copy table for the new keys and a no-placeholder assertion.
- If any wiring is asserted by reading source text, follow `AGENTS.md`: scope the slice to the target block, assert every token, assert on raw source for scheme/URL checks, and prove the guard can fail by temporarily injecting the forbidden string.

## Tasks

### Task 1 - Share-code entry pure logic

Create `src/modules/user/share-code-entry-logic.js` and `src/modules/user/share-code-entry-logic.test.js`.

- lowercase code + `normalizeShareCode('abc123')`
  - → returns `'abc123'`
- padded/uppercase code + `normalizeShareCode('  ABC123  ')`
  - → returns `'abc123'`
- empty or non-string input + `normalizeShareCode('')`, `'   '`, `null`, `undefined`, `42`
  - → each returns `null`
- valid code + a profile object + `planShareCodeSubmit({ rawCode: 'abc123', profile: { id: 'u1' } })`
  - → returns `{ action: 'navigate', to: '/abc123' }`
- padded/uppercase code + a profile object
  - → returns `{ action: 'navigate', to: '/abc' }` (path uses the normalized code)
- unknown code + `profile: null`
  - → returns `{ action: 'error', reason: 'not_found' }`
- blank code + any profile + `planShareCodeSubmit({ rawCode: '   ', profile: { id: 'u1' } })`
  - → returns `{ action: 'error', reason: 'empty' }`
- no arguments + `planShareCodeSubmit()`
  - → returns `{ action: 'error', reason: 'empty' }`
- `GO_LESSON_PATH`
  - → equals `'/course/wouldrather/lesson/a'`
- each reason + `shareCodeErrorStringKey`
  - → `'empty'` → `'home_landing_code_required'`
  - → `'not_found'` → `'home_landing_code_not_found'`
  - → `'lookup_failed'` → `'home_landing_lookup_error'`
  - → an unknown reason → `'home_landing_lookup_error'`

### Task 2 - Presentational landing component

Create `src/components/homescreen/HomeLanding.jsx` and `src/components/homescreen/HomeLanding.test.jsx`.

- default lang (`en`) + render
  - → `[data-testid="share-code-headline"]` text is `Practice English with your friends for free.`
  - → `[data-testid="share-code-subheadline"]` text is `Enter your friend's share code`
  - → `[data-testid="share-code-go"]` text is `Go`
  - → `[data-testid="no-code"]` text is `I don't have a share code`
- `lang="es"` + render
  - → headline text is `Practica inglés con tus amigos gratis.`
  - → Go button text is `Ir`
- "abc" typed into `[data-testid="share-code-input"]`
  - → the input's `value` is `abc`
  - → `onInputChange` is called (when provided)
- "abc" in the input + the form's submit event fired
  - → `onSubmitCode` is called exactly once with `'abc'`
- the Go button + inspect its `type`
  - → `type` is `submit` (so a click or Enter submits the form)
- `error="boom"` + render
  - → `[data-testid="share-code-error"]` exists, `textContent` is `boom`, and `getAttribute('role')` is `alert`
- `error={null}` + render
  - → `[data-testid="share-code-error"]` is absent
- `loading` true + render
  - → `[data-testid="share-code-go"]` has the `disabled` attribute
- `loading` false + render
  - → Go button is not disabled
- `[data-testid="no-code"]` clicked
  - → `onNoCode` is called exactly once
  - → `onSubmitCode` is not called

### Task 3 - Container wiring and lookup extraction

Modify `src/modules/api/api.js`; create `src/components/homescreen/HomeLandingContainer.jsx` and `src/components/homescreen/HomeLandingContainer.test.jsx`.

- `src/modules/api/api.js` imported in a test
  - → `typeof fetchUserByShareCode === 'function'`
- the `useUserByShareCode` source slice (from `indexOf('export function useUserByShareCode')` to the next top-level `export`), read raw
  - → contains `fetchUserByShareCode(shareCode)`
  - → contains `['user', 'profile', 'shareCode', shareCode]`
  - → contains `enabled: !!shareCode`
- the `fetchUserByShareCode` source slice
  - → calls `queryPublicProfiles()` and falls back to `queryLegacy()` inside a `catch`
- `fetchUserByShareCode` resolves a profile + non-empty code submitted
  - → `navigate` is called once with `/<normalized code>`
  - → no error element is rendered
- `fetchUserByShareCode` resolves `null` + code submitted
  - → `navigate` is not called
  - → `[data-testid="share-code-error"]` shows the English `home_landing_code_not_found` copy
- empty input + form submitted
  - → `fetchUserByShareCode` is not called
  - → `[data-testid="share-code-error"]` shows the English `home_landing_code_required` copy
- `fetchUserByShareCode` rejects + code submitted
  - → `navigate` is not called
  - → `[data-testid="share-code-error"]` shows the English `home_landing_lookup_error` copy
- an error is showing + input is edited
  - → the error element is removed
- an error is showing + a later submit resolves a profile
  - → the error element is removed and `navigate` is called
- `appStore.setState({ guestNativeLanguage: 'es' })` + render
  - → `[data-testid="share-code-headline"]` is the Spanish copy
- `[data-testid="no-code"]` clicked
  - → `navigate` is called once with `/course/wouldrather/lesson/a`

### Task 4 - Home route branch

Modify `src/routes/HomeRoute.jsx`; create `src/routes/HomeRoute.test.jsx`.

- `useAuthStatus` returns `{ isLoading: true }` + render
  - → neither `HomeLandingContainer` nor `HomeScreen` is rendered
- `useAuthStatus` returns `{ data: false, isLoading: false }` + render
  - → `HomeLandingContainer` is rendered
  - → `HomeScreen` is not rendered
- `useAuthStatus` returns `{ data: true, isLoading: false }` + render
  - → `HomeScreen` is rendered
  - → `HomeLandingContainer` is not rendered
- `isLoading` true + render
  - → `finishPreloader` is not called
- `isLoading` false + render
  - → `finishPreloader` is called once

### Task 5 - Landing strings

Modify `src/data/strings.js` and `src/data/strings.test.js`.

- `home_landing_headline`, `home_landing_subheadline`, `home_landing_code_placeholder`, `home_landing_go`, `home_landing_no_code`, `home_landing_code_required`, `home_landing_code_not_found`, `home_landing_lookup_error` + `get(key, lang)`
  - → each returns the exact copy in the table above for `en`, `es`, `pt`, `fr`, `hi`, and `bn`
- the new keys + the existing "returns a Devanagari (Hindi) string for every key" and "returns a Bengali string for every key" tests
  - → both pass (hi/bn values are non-empty and in script)
- every new key's `en` value
  - → contains no `{placeholder}` token

## Technical Context

- No new dependencies. Stack already present: React `19.2.6`, React DOM `19.2.6`, `react-router-dom` `7.15.1`, `@tanstack/react-query` `5.100.14`, Zustand `5.0.13`, Vitest `4.1.6`. Tests run under jsdom (`vitest.config.js`), so no browser APIs beyond `createRoot`/`act` are needed.
- Existing public-profile lookup: `useUserByShareCode` (`src/modules/api/api.js:291`) already implements the `public_profiles` → `user_profiles` fallback; this story only extracts its query body into `fetchUserByShareCode` and delegates.
- Existing normalization precedent: `App.jsx:29-31` and `getShareCodeFromSearch` (`src/modules/user/friend-lesson-detection.js:17-27`) both `trim().toLowerCase()`.
- Route/course resolution: `AppLayout.jsx:20` fetches `/src/config/${courseId}.json`, so `/course/wouldrather/lesson/a` loads `src/config/wouldrather.json`; Vite copies every `src/config/*.json` into `dist/src/config/` (`vite.config.js:21-26`).
- Anonymous-visitor behavior on `/` is governed by `useGuestModalGuard` (`src/hooks/use-guest-modal-guard.js:42-72`) and is intentionally unchanged.
- `HomeScreen` reads its language the same way the new container will: `guestNativeLanguage || userData?.native_language || 'en'` (`HomeScreen.jsx:17-19`).

## Notes

- Product decisions that should be confirmed before implementation:
  1. The landing is shown to anonymous visitors only; logged-in users keep `HomeScreen`. If the intent is to replace the homepage for everyone, the course/Continue/notification entry points need a new home.
  2. The no-code destination is `/course/wouldrather/lesson/a` (the Would You Rather ask lesson).
  3. The exact English copy — headline `Practice English with your friends for free.`, subheadline `Enter your friend's share code`, `Go`, `I don't have a share code`, and the not-found/required/lookup error sentences — plus the es/pt/fr/hi/bn translations in the table, which were authored for this story and need a copy review.
  4. The lookup happens before navigation (inline error), rather than navigating to `/:shareCode` and letting `PublicProfile` show its own not-found state.
- `useGuestModalGuard` still opens the guest language/login modal for an anonymous visitor on `/`. The landing therefore appears after the visitor confirms a language and chooses "Continue as Guest". Changing this is out of scope; if low-friction entry is wanted, treat `/` like a friend lesson in the guard in a separate story.
- A parallel branch `039-extend-friend-lesson-chain` (not an ancestor of this branch; base `cea8993`) generalizes the friend-challenge lessons from the `a`/`b` pair to a shareCta chain and renames single-letter lesson ids. If that branch lands first, `GO_LESSON_PATH` must be re-verified against the renamed Would You Rather ask lesson.
- Known limitation (unchanged): text-mode users publish no clips (`docs/product.md:53`), so a profile entered here may have no answer lesson yet; the landing only resolves the profile, which is the requested behavior.
- Source-guard rules apply to any wiring assertion (`AGENTS.md`): slice to the target block, assert every property, and prove the guard can fail by temporarily injecting the forbidden value.
