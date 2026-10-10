# Homepage marketing sections + app-matched styling

## Context

The public homepage (`/` → `src/routes/PublicHomeRoute.jsx` → `src/components/homescreen/HomeLandingContainer.jsx` → `src/components/homescreen/HomeLanding.jsx`, from story 045) is a single share-code box on a dark background. Its only job is the friend-challenge entry: type a friend's share code (looked up by `fetchUserByShareCode`, then navigate to `/<code>`), or press "I don't have a share code" to jump into the Would You Rather ask lesson at `/course/wouldrather/lesson/a`.

Two problems with the current render:

1. **It does not read like the app.** The page uses the app's dark navy base but its secondary action is a plain cyan underlined text link and the body is a flat card with no app chrome; the buttons do not match the app's button language (the gradient pill primary used by `HomeScreen`'s Continue / menu Sign-In, `HomeScreen.jsx:55-122`).
2. **It explains nothing.** A visitor who does not already understand the product (or who lands here from a shared link) is shown a code box and no reason to fill it in.

The request: make the page match the app's conventions (backgrounds, button colours, fonts) and, **below the top share-code box**, add two short marketing sections in a Bootstrap-style landing layout — a "How it works" bulleted list that explains the product and answers objections (built from the default social share message, `share_message` in `src/data/strings.js:2215`, which is already translated into all six UI languages), and an "About the teacher" section for Joel Walsh (TESOL master's, 20 years' teaching) with his photo from the app's assets. Keep it short — the goal is to drive the visitor into the share-code box.

## Out of Scope

- The share-code lookup/error/navigation behaviour: `HomeLandingContainer.jsx`, `share-code-entry-logic.js`, `api.js`, the existing `HomeLanding` props, and every existing `data-testid` are unchanged. Only presentation is added.
- Localizing or restyling the logged-in dashboard (`HomeScreen` at `/home`), the `/courses` page, the public profile (`/:shareCode`), or the old static `public/landing.html`.
- Renaming the teacher elsewhere: `PraiseBubble.jsx` / `answer-pipeline.js` / `IncomingVideoWidget.jsx` keep "Joe Walsh"; this story only adds "Joel Walsh" on the homepage. (The two names differing is pre-existing and not resolved here.)
- Changing `share_message` (read as source material only).
- New sections on any route other than `/`.
- New dependencies (everything needed is in `package.json`).
- Native (`*.native.jsx`) variants.

## Implementation approach

### Decisions

- **All work is in the presentational `HomeLanding.jsx`.** `HomeLandingContainer.jsx` already passes `lang`; no new props are required. The new sections are static copy + a static image, so there is no new `*-logic.js` module and no data access.
- **Design tokens are copied from the app** (not invented): page `#0b1a2a`, card `#1a3a5a`, card border `#2a4a6a`, brand gradient `linear-gradient(135deg, #3a8fd5 0%, #00c0d8 100%)`, secondary text `#adb5bd`, accent `#00c0d8`, font stack `'Inter', 'Plus Jakarta Sans', sans-serif` — all as used by `HomeScreen.jsx:55-122` and `CourseListings.jsx:10-31`. The primary button reuses the exact `HomeScreen` Continue button tokens (`width:100%; padding:14px; background:<gradient>; color:#fff; border:none; borderRadius:8px; fontSize:16px; fontWeight:600`). The primary CTA (Go) keeps that gradient; the secondary CTA ("I don't have a share code") becomes a real app-style outlined **button** (transparent background, `1px solid #00c0d8`, `#00c0d8` text, same padding/radius/font-weight) instead of an underlined text link.
- **The page must scroll internally.** `#root` is `.video-frame`, which is `overflow: hidden` (`app.css:347-355`), and `html, body { overflow: hidden }` (`index.html:56-58`). The current container is `minHeight: 100dvh` and only fits because the content is short; with sections added, it must become `height: 100dvh; overflowY: 'auto'` exactly like `HomeScreen.jsx:68-76`, so the sections and footer are reachable. The content is top-aligned (the hero is no longer vertically centred) in a `maxWidth: 480px` column (`margin: 0 auto`) so it still reads as the app's phone frame on desktop.
- **No `.water-surface` class is added.** Story 050 deliberately keeps the water shimmer off non-lesson page shells; the homepage's opaque `#0b1a2a` container covers `#root`'s blue. Adding a `.water-surface` element (or removing the opaque background) would resurface the sheen and break `tests/water-shimmer-scope.spec.js`, which clips `#root` at `y + 300` on `/` and asserts zero marker pixels.
- **New copy is localized into the six existing UI languages** (en/es/pt/fr/hi/bn), consistent with the rest of the homepage and the `strings.js` contract enforced by `src/data/strings.test.js` (every key needs non-empty `hi`/`bn`). Native-speaker review of the non-English drafts is a follow-up, exactly as noted for story 056.
- **The teacher's name is a proper noun and is a JS module constant**, not a `strings.js` key: the `hi`/`bn` script guard (`/[\u0900-\u097F]/`, `/[\u0980-\u09FF]/`) would fail on a Latin-only name entry. Precedent: `PraiseBubble.jsx:4` hardcodes `botName = "Joe Walsh"`.
- **The photo is `src/assets/img/teacherprofile.webp`** — the teacher avatar already used by `PraiseBubble.jsx:2` (the only picture of Joel in the assets; `cropped-teacher.png` is a corrupted PNG whose signature is invalid and cannot be decoded, and `teacherprofile.jpeg` is a lower-resolution raster of the same portrait).

### Layout (`HomeLanding.jsx`)

```
<div style={containerStyle}>                 // height:100dvh; overflowY:auto; bg #0b1a2a; font stack
  <div style={topBarStyle}>                   // unchanged: brand gradient, logo, account link
  <div style={contentStyle}>                  // width:100%; maxWidth:480px; margin:0 auto; padding:24px 16px;
                                              //   display:flex; flexDirection:column; gap:20px
    <div style={cardStyle}>                   // hero share-code box — existing testids/behaviour unchanged
      <h1 data-testid="share-code-headline">
      <p  data-testid="share-code-subheadline">
      <form> input / error / Go(Type submit) </form>
      <button type="button" data-testid="no-code">            // NEW: outlined app-style button
    </div>

    <section data-testid="how-it-works" style={cardStyle}>
      <h2 data-testid="how-it-works-heading">{Strings.get('home_landing_how_heading', lang)}</h2>
      <ul data-testid="how-it-works-list" style={{ listStyle:'none', padding:0, margin:0, display:'flex', flexDirection:'column', gap:'12px' }}>
        <li data-testid="how-it-works-item-1"> <i className="bi bi-check-circle-fill" aria-hidden="true" style={{ color:'#00c0d8', fontSize:'20px', flexShrink:0 }} /> <span>{Strings.get('home_landing_how_1', lang)}</span> </li>
        ... items 2–5 ...
      </ul>
    </section>

    <section data-testid="about-teacher" style={cardStyle}>
      <h2 data-testid="about-teacher-heading">{Strings.get('home_landing_about_heading', lang)}</h2>
      <img data-testid="about-teacher-photo" src={teacherPhoto} alt={TEACHER_NAME}
           style={{ width:'96px', height:'96px', borderRadius:'50%', objectFit:'cover', border:'3px solid #00c0d8', display:'block', marginBottom:'12px' }} />
      <p data-testid="about-teacher-name" style={{ fontSize:'20px', fontWeight:700, margin:'0 0 8px' }}>{TEACHER_NAME}</p>
      <p data-testid="about-teacher-credentials" style={{ color:'#e9ecef', fontSize:'15px', lineHeight:1.5, margin:0 }}>{Strings.get('home_landing_about_credentials', lang)}</p>
    </section>
  </div>

  <LegalFooter lang={lang} />                 // unchanged component; now sits at the end of the scroll column
</div>
```

- `cardStyle` is the existing hero card style (`#1a3a5a`, `border:1px solid #2a4a6a`, `borderRadius:12px`, `padding:24px`) reused by both new sections, so sections read as app cards.
- `teacherPhoto` is `import teacherPhoto from '../../assets/img/teacherprofile.webp';`; `const TEACHER_NAME = 'Joel Walsh';` is a module-level constant.
- `no-code` becomes `<button type="button" ...>` with `width:'100%'`, `padding:'14px'`, `background:'transparent'`, `borderWidth:'1px'`, `borderStyle:'solid'`, `borderColor:'#00c0d8'`, `color:'#00c0d8'`, `borderRadius:'8px'`, `fontSize:'16px'`, `fontWeight:600`, `cursor:'pointer'`, and is wrapped in a `<div style={{ marginTop:'12px' }}>` (replacing the current centred wrapper). Longhand `border*` properties are used so a test can read `style.borderColor` (jsdom drops the colour from the `.border` shorthand).
- The two new `<section>`s and the hero card are spaced by the column `gap:20px`; `LegalFooter` keeps its own top border.

### New strings (`src/data/strings.js`)

Add a new `// --- Public homepage (homepage landing sections) ---` block immediately after the existing `home_landing_lookup_error` entry (around line 2297). Every key gets all six languages with exactly these values:

| key | en | es | pt | fr | hi | bn |
| --- | --- | --- | --- | --- | --- | --- |
| `home_landing_how_heading` | `How it works` | `Cómo funciona` | `Como funciona` | `Comment ça marche` | `यह कैसे काम करता है` | `এটি কীভাবে কাজ করে` |
| `home_landing_how_1` | `It's 100% free — no card and no subscription, ever.` | `Es 100% gratis: sin tarjeta y sin suscripción, para siempre.` | `É 100% grátis: sem cartão e sem assinatura, para sempre.` | `C'est 100 % gratuit : sans carte bancaire et sans abonnement, pour toujours.` | `यह 100% मुफ़्त है — कभी भी कोई कार्ड या सब्सक्रिप्शन नहीं।` | `এটি ১০০% বিনামূল্যে — কখনোই কার্ড বা সাবস্ক্রিপশন লাগবে না।` |
| `home_landing_how_2` | `Any English level works, from beginner to advanced. It teaches you what to say.` | `Sirve cualquier nivel de inglés, de principiante a avanzado. Te enseña qué decir.` | `Serve qualquer nível de inglês, de iniciante a avançado. Ele ensina o que dizer.` | `Tous les niveaux d'anglais conviennent, du débutant à l'avancé. Ça t'apprend quoi dire.` | `अंग्रेज़ी का कोई भी स्तर ठीक है, शुरुआती से उन्नत तक। यह आपको बताता है कि क्या कहना है।` | `ইংরেজির যেকোনো স্তর ঠিক আছে, শিক্ষানবিশ থেকে উন্নত পর্যন্ত। এটি আপনাকে বলে দেয় কী বলতে হবে।` |
| `home_landing_how_3` | `You don't need to be online at the same time as your friend.` | `No necesitas estar en línea al mismo tiempo que tu amigo.` | `Você não precisa estar online ao mesmo tempo que seu amigo.` | `Vous n'avez pas besoin d'être en ligne en même temps que votre ami.` | `आपको अपने दोस्त के साथ एक ही समय पर ऑनलाइन होने की ज़रूरत नहीं है।` | `আপনাকে আপনার বন্ধুর সাথে একই সময়ে অনলাইনে থাকতে হবে না।` |
| `home_landing_how_4` | `Answer out loud and get instant feedback on your speaking.` | `Responde en voz alta y recibe comentarios al instante sobre tu forma de hablar.` | `Responda em voz alta e receba feedback instantâneo sobre a sua fala.` | `Répondez à voix haute et recevez un retour immédiat sur votre expression orale.` | `ज़ोर से जवाब दें और अपनी बोली पर तुरंत प्रतिक्रिया पाएँ।` | `জোরে উত্তর দিন এবং আপনার বলার উপর সঙ্গে সঙ্গে মতামত পান।` |
| `home_landing_how_5` | `Your friend's videos expire after 48 hours, so start now.` | `Los videos de tu amigo caducan después de 48 horas, así que empieza ahora.` | `Os vídeos do seu amigo expiram após 48 horas, então comece agora.` | `Les vidéos de votre ami expirent après 48 heures, alors commencez maintenant.` | `आपके दोस्त के वीडियो 48 घंटे बाद समाप्त हो जाते हैं, इसलिए अभी शुरू करें।` | `আপনার বন্ধুর ভিডিওগুলো ৪৮ ঘণ্টা পরে মেয়াদোত্তীর্ণ হয়ে যায়, তাই এখনই শুরু করুন।` |
| `home_landing_about_heading` | `About the teacher` | `Sobre el profesor` | `Sobre o professor` | `À propos du professeur` | `शिक्षक के बारे में` | `শিক্ষক সম্পর্কে` |
| `home_landing_about_credentials` | `I have a master's degree in teaching English to speakers of other languages (TESOL) and 20 years of experience teaching English.` | `Tengo una maestría en enseñanza de inglés a hablantes de otros idiomas (TESOL) y 20 años de experiencia enseñando inglés.` | `Tenho um mestrado em ensino de inglês para falantes de outras línguas (TESOL) e 20 anos de experiência ensinando inglês.` | `J'ai un master en enseignement de l'anglais aux locuteurs d'autres langues (TESOL) et 20 ans d'expérience dans l'enseignement de l'anglais.` | `मेरे पास अन्य भाषाओं के बोलने वालों को अंग्रेज़ी पढ़ाने में मास्टर डिग्री (TESOL) और अंग्रेज़ी पढ़ाने का 20 साल का अनुभव है।` | `আমার অন্য ভাষার বক্তাদের ইংরেজি শেখানোর ক্ষেত্রে মাস্টার্স ডিগ্রি (TESOL) এবং ইংরেজি শেখানোর ২০ বছরের অভিজ্ঞতা রয়েছে।` |

No value contains a `{`/`}` placeholder. The "How it works" bullets are derived from `share_message` (`strings.js:2216`): free; any level, it teaches you what to say; no need to be online at the same time; plus the app's speak-and-get-feedback loop and the 48-hour urgency.

### Test plan

- **Runtime (jsdom, `createRoot` + `act`, `MemoryRouter`)** in `src/components/homescreen/HomeLanding.test.jsx`: new sections, copy, structure, button roles/styles, scroll container, localization.
- **Strings exact-copy** in a new `src/data/strings-landing-sections.test.js` (mirrors `src/data/strings-friend-practice.test.js`) using `get`/`getBilingual`.
- **Static source guard** in a new `src/components/homescreen/homepage-landing-wiring.test.js` (mirrors `src/routes/home-navigation-wiring.test.js`): the photo import, the gradient token, the scroll contract, the absence of `water-surface`, and the preserved testids. Every slice is scoped to a specific block, asserts on raw source, and is proven able to fail (AGENTS.md).

## Tasks

### Task 1 — App-styled cover, buttons and a scrollable page

Modify `src/components/homescreen/HomeLanding.jsx` and `src/components/homescreen/HomeLanding.test.jsx`; create `src/components/homescreen/homepage-landing-wiring.test.js`.

- `HomeLanding` rendered with default props + inspect the rendered landing root (`container.firstChild`, the component's outer `<div>`)
  - → `style.height` is `100dvh`
  - → `style.overflowY` is `auto`
  - → `style.backgroundColor` is `rgb(11, 26, 42)`
  - → `style.fontFamily` contains `Inter`
- `HomeLanding` rendered + inspect `share-code-go`
  - → its `tagName` is `BUTTON`, `type` is `submit`
  - → `style.fontWeight` is `600`, `style.borderRadius` is `8px`, `style.width` is `100%`
  - → `style.background` contains `linear-gradient`
- `HomeLanding` rendered + inspect `no-code`
  - → its `tagName` is `BUTTON`
  - → its `type` attribute is `button`
  - → `style.borderColor` is `rgb(0, 192, 216)`, `style.borderWidth` is `1px`, `style.borderStyle` is `solid`, `style.fontWeight` is `600`, `style.width` is `100%`
  - → its `style.textDecoration` does not contain `underline`
- `no-code` clicked + `onSubmitCode` provided
  - → `onNoCode` is called exactly once and `onSubmitCode` is not called (existing behaviour preserved)
- `homepage-landing-wiring.test.js` reads `HomeLanding.jsx` raw
  - → the source contains the exact token `linear-gradient(135deg, #3a8fd5 0%, #00c0d8 100%)`
  - → the source contains `data-testid="share-code-input"`, `data-testid="share-code-go"`, `data-testid="share-code-error"`, `data-testid="no-code"`, and `data-testid="landing-account-link"`
  - → the source does not contain `water-surface`

### Task 2 — "How it works" section

Modify `src/components/homescreen/HomeLanding.jsx` and `src/components/homescreen/HomeLanding.test.jsx`.

- `HomeLanding` rendered (default `lang='en'`) + inspect `how-it-works`
  - → `how-it-works-heading` text is `How it works`
  - → `how-it-works-heading` `tagName` is `H2`
  - → `how-it-works-list` `tagName` is `UL`
  - → `how-it-works-list` has exactly 5 direct `LI` children
  - → item 1 text is `It's 100% free — no card and no subscription, ever.`
  - → item 2 text is `Any English level works, from beginner to advanced. It teaches you what to say.`
  - → item 3 text is `You don't need to be online at the same time as your friend.`
  - → item 4 text is `Answer out loud and get instant feedback on your speaking.`
  - → item 5 text is `Your friend's videos expire after 48 hours, so start now.`
  - → each `LI` contains a `<span>` with the copy and is not itself a heading element
- `HomeLanding` rendered with `lang='es'`
  - → `how-it-works-heading` text is `Cómo funciona`
  - → item 1 text is `Es 100% gratis: sin tarjeta y sin suscripción, para siempre.`

### Task 3 — "About the teacher" section with photo

Modify `src/components/homescreen/HomeLanding.jsx`; create the photo import guard in `src/components/homescreen/homepage-landing-wiring.test.js`; extend `src/components/homescreen/HomeLanding.test.jsx`.

- `HomeLanding` rendered (default `lang='en'`) + inspect `about-teacher`
  - → `about-teacher-heading` text is `About the teacher` and `tagName` is `H2`
  - → `about-teacher-name` text is `Joel Walsh`
  - → `about-teacher-credentials` text is `I have a master's degree in teaching English to speakers of other languages (TESOL) and 20 years of experience teaching English.`
  - → `about-teacher-photo` is an `IMG`, its `alt` is `Joel Walsh`, and its `src` contains `teacherprofile` (the Vite asset URL for the imported `teacherprofile.webp`)
  - → `about-teacher-photo` inline `borderRadius` is `50%` and `width` is `96px`
- `HomeLanding` rendered with `lang='es'`
  - → `about-teacher-heading` text is `Sobre el profesor`
  - → `about-teacher-credentials` text is the Spanish copy from the table
- `homepage-landing-wiring.test.js` reads `HomeLanding.jsx` raw
  - → the source contains the import `from '../../assets/img/teacherprofile.webp'`
  - → the source contains the exact token `Joel Walsh`
  - → the source does not contain the exact token `Joe Walsh`

### Task 4 — Landing-section strings

Modify `src/data/strings.js`; create `src/data/strings-landing-sections.test.js`.

- each of the eight new keys in the table (`home_landing_how_heading`, `home_landing_how_1`…`_5`, `home_landing_about_heading`, `home_landing_about_credentials`) + `getBilingual(key, 'en').english`
  - → equals the exact English value from the table
- each new key + `getBilingual(key, lang).localized` for `es`, `pt`, `fr`, `hi`, `bn`
  - → is not `null` and has length greater than 0
- `get('home_landing_how_heading', 'es')`
  - → returns `Cómo funciona` (not the English fallback and not the key)
- `get('home_landing_how_1', 'bn')` and `get('home_landing_how_2', 'hi')`
  - → match the Bengali / Devanagari scripts respectively (non-empty)
- every new key in every one of `en`, `es`, `pt`, `fr`, `hi`, `bn` + `get`
  - → contains no `{` or `}` character
- `strings` (raw table) `['home_landing_about_credentials']`
  - → has non-empty `hi` and `bn` values, so the existing "returns a Devanagari/Bengali string for every key" tests in `src/data/strings.test.js` stay green without editing that file

### Task 5 — Guard and regression coverage

Create `src/components/homescreen/homepage-landing-wiring.test.js`; run the existing suites.

- `homepage-landing-wiring.test.js` reads `HomeLanding.jsx` raw + slices the no-code button open tag
  - → with `at = indexOf('data-testid="no-code"')` and `from = lastIndexOf('<button', at)`, `from` is greater than `-1` and `slice(from, at)` contains `type="button"`
- `homepage-landing-wiring.test.js` reads `HomeLanding.jsx` raw + slices the Go button open tag
  - → with `at = indexOf('data-testid="share-code-go"')` and `from = lastIndexOf('<button', at)`, `from` is greater than `-1` and `slice(from, at)` contains `type="submit"`
- `src/components/homescreen/HomeLandingContainer.test.jsx` (unchanged)
  - → still passes, proving the container contract (navigation/error/lookup) is untouched
- `tests/water-shimmer-scope.spec.js` (unchanged, real Chrome) + `npx playwright test` locally
  - → still passes: the homepage shell remains opaque and the shimmer stays scoped

## Technical Context

No new runtime or dev dependencies. Versions from `package.json`: React `^19.2.0`, React DOM `^19.2.0`, `react-router-dom` `^7.15.1`, `bootstrap-icons` `^1.11.3`, Zustand `^5.0.13`, Vitest `^4.1.6`, jsdom `^29.1.1`, Vite `^8.0.10`, `@playwright/test` `^1.60.0`.

- **App design tokens** live inline in components (there is no shared style module): `HomeScreen.jsx:55-122` (`containerStyle`, `topBarStyle`, `cardStyle`/`courseCardStyle`, `continueBtnStyle`, `brandGradient`) and `CourseListings.jsx:10-31`. HomeLanding must reproduce those exact values; it already uses `#0b1a2a`/`#1a3a5a`/`#2a4a6a`/the gradient/font stack.
- **Scrolling:** `#root` is `<div id="root" class="video-frame water-surface ...">` (`index.html:194`) and `.video-frame { overflow: hidden }` (`app.css:347-355`); `html, body { overflow: hidden }` (`index.html:56-58`). Only an internal `height:100dvh; overflowY:auto` container scrolls (the dashboard's pattern, `HomeScreen.jsx:68-76`). The current `minHeight:100dvh` centered layout cannot scroll.
- **jsdom style values:** hex colours are normalised to `rgb(...)` (e.g. `#0b1a2a` → `rgb(11, 26, 42)`, `#00c0d8` → `rgb(0, 192, 216)`), and a `background: linear-gradient(...)` reads back from `element.style.background`/`backgroundImage`. The `.border` shorthand drops its colour in jsdom, so the component declares `borderWidth`/`borderStyle`/`borderColor` longhands and tests read `style.borderColor`.
- **Bootstrap utility classes are a hand-written subset** (`app.css`): `.d-flex`, `.align-items-center`, `.text-center`, `.mb-3` exist; `.list-unstyled` and `.lead` do **not**. The new sections therefore use inline styles (matching the existing landing), not Bootstrap classes.
- **Icons:** `bootstrap-icons/font/bootstrap-icons.css` is imported in `main.jsx:3`, so `<i className="bi bi-check-circle-fill">` renders (the pattern already used by `HomeScreen.jsx` and the old `public/landing.html`).
- **Strings contract:** `src/data/strings.test.js` asserts every key has non-empty `hi`/`bn` in the right script (lines 16-32) and auto-derives placeholder keys from `en` (lines 12-14); `getBilingual` reports `.localized === null` for a missing language (used by `strings-friend-practice.test.js`). These run in the default `vitest` suite, so the eight new keys must carry all six languages.
- **`AGENTS.md` guards that apply:** the new files under `src/**` must not mention the operator recorder page (`src/modules/video/recorder-page.test.js`); source guards must be scoped to a named block, assert on raw source, and be able to fail. `src/components/intro-caller-name.test.js` only inspects `IncomingVideoWidget.jsx`/`video-loader.web.js`, so `Joel Walsh` in `HomeLanding.jsx` does not trip it (and `Joe Walsh` is not a substring of `Joel Walsh`).
- **CI:** `.github/workflows/deploy.yml` runs `npm test -- --run`; `.github/workflows/playwright.yml` runs `tests/`. Verify locally (`npx vitest run`, `npx playwright test`) before pushing; do not dispatch workflows.

## Notes

- **Explicit assumptions** (each is a decision the user may want to revise):
  - The teacher's name is written **"Joel Walsh"** as the request said; the rest of the app still says "Joe Walsh" and is intentionally not changed here.
  - The photo is `src/assets/img/teacherprofile.webp` — the teacher avatar used by `PraiseBubble.jsx`. `cropped-teacher.png` is a 410 KB PNG with a corrupted signature (`89 50 4E 47 0D 0A 1A 0D 0A`, ffmpeg cannot decode it) and is unusable; `teacherprofile.jpeg`/`.webp` are the same 150–192 px portrait. A 96 px circular avatar is the intended use; if a higher-resolution photo is wanted, supply one and swap the import.
  - The new sections are localized into all six UI languages (repo convention). The non-English values are drafted here and should be reviewed by a native speaker later, as with story 056's keys.
  - Design direction: the page keeps the dark navy base and reuses the app's gradient primary button, app cards and font, and turns the secondary action into an app-style outlined button. It deliberately does **not** add the lesson `water-surface` gradient (see Implementation approach) and does **not** add a second CTA/signup block, to keep the page short.
  - The "How it works" list is a single 5-item bulleted card (no numbered steps) built from `share_message`; no new images/screenshots are added.
- **Known limitation (unchanged):** on desktop `#root` is a 9:16 phone frame (`app.css:357-368`), so the landing renders in a narrow column regardless of viewport width.
- **Conversion copy is English-authored:** the request says the message "explains how it works and addresses objections"; the five bullets cover free/no-card, any level, no simultaneous scheduling, instant speaking feedback, and the 48-hour window (the `share_message` objection points).
