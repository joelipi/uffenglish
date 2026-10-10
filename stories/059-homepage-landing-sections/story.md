# Homepage marketing sections + app-matched styling

## Context

The public homepage (`/` → `src/routes/PublicHomeRoute.jsx` → `src/components/homescreen/HomeLandingContainer.jsx` → `src/components/homescreen/HomeLanding.jsx`, from story 045) is a single share-code box on a dark background. Its only job is the friend-challenge entry: type a friend's share code (looked up by `fetchUserByShareCode`, then navigate to `/<code>`), or press "I don't have a share code" to jump into the Would You Rather ask lesson at `/course/wouldrather/lesson/a`.

Two problems with the current render:

1. **It does not read like the app.** The page uses the app's dark navy base but its secondary action is a plain cyan underlined text link and the body is a flat card with no app chrome; the buttons do not match the app's button language (the gradient pill primary used by `HomeScreen`'s Continue / menu Sign-In, `HomeScreen.jsx:55-122`).
2. **It explains nothing.** A visitor who does not already understand the product (or who lands here from a shared link) is shown a code box and no reason to fill it in.

The request: make the page match the app's conventions (backgrounds, button colours, fonts) and, **below the top share-code box**, add short marketing sections in a Bootstrap-style landing layout — a "How it works" bulleted list that explains the product and answers objections (built from the default social share message, `share_message` in `src/data/strings.js:2215`, which is already translated into all six UI languages), a **carousel of concatenated conversation videos** so visitors can see what the conversations actually look like (posters by default; the video loads only when the visitor presses play), and an "About the teacher" section for the app's teacher, Joe Walsh (TESOL master's, 20 years' teaching), with his photo from the app's assets. The top bar also gains a **language selector** so a visitor can choose the page language the way the app usually presents it. Keep it short — the goal is to drive the visitor into the share-code box.

The same request asks which language the page shows. **Today the homepage does not look at the browser language.** `HomeLandingContainer.jsx:21-23` resolves `guestNativeLanguage || userData?.native_language || 'en'`, and `useGuestModalGuard` returns early for `isPublicHomeRoute(path)` (story 045) *before* it would call `detectBrowserLanguage()` (`use-guest-modal-guard.js:51-54`), so an anonymous first-time visitor to `/` always sees English. `guestNativeLanguage` is only ever set by the guest language picker, by a friend-lesson silent adoption, or by the store bootstrap. This story makes the homepage adopt the visitor's browser language (when it is one of the homepage's supported languages) silently, reusing the friend-lesson mechanism, and adds a selector to change it — so a Spanish-browser visitor reads the landing in Spanish and can switch it.

The showcase videos are **learner conversation recaps**: the concatenated end-of-lesson recaps that the client currently publishes to the temporary `videos/` namespace (`videos/<shareCode>-<courseId>-<lessonId>-complete.mp4`, 48 h TTL, `video-url.js:45-52`). Those are not permanent, so this story copies a small curated set to the permanent `assets/` namespace and references them from a curated list.

## Out of Scope

- The share-code lookup/error/navigation behaviour: `HomeLandingContainer.jsx`'s lookup + error handling, `share-code-entry-logic.js`, `api.js`, and every existing `data-testid` are unchanged. `HomeLanding` keeps its existing props (it gains two optional presentation props: `onLanguageChange`, `showcaseVideos`).
- Localizing or restyling the logged-in dashboard (`HomeScreen` at `/home`), the `/courses` page, the public profile (`/:shareCode`), or the old static `public/landing.html`.
- The teacher's name elsewhere: the app already calls him "Joe Walsh" (`PraiseBubble.jsx:4`, `IncomingVideoWidget.jsx:310`, `answer-pipeline.js:292`), so the homepage uses that same spelling rather than introducing a second name. Renaming him anywhere else is out of scope.
- Changing `share_message` (read as source material only).
- New sections on any route other than `/`.
- Committing video or poster binaries to the repo (`*.mp4`/`*.jpg` are gitignored / R2-only) and changing the R2 lifecycle rules or the UGC 48 h TTL. The showcase videos are **copied** out of the temporary `videos/` prefix to the permanent `assets/` prefix by an operator (Notes); the app only reads them.
- Generating showcase videos from recordings at runtime, or a "record your own" flow — the carousel plays a fixed, curated list.
- Changing the guest language modal, `GUEST_LANGUAGES`, the profile language list, or `resolveGuestModalPlan`.
- Per-slide titles/captions on the carousel videos (only a section heading and an accessible play label are added).
- New dependencies (everything needed is in `package.json`).
- Native (`*.native.jsx`) variants.
- Loading unscoped Bootstrap anywhere else in the SPA, or restyling any route other than `/` with it (the scoped sheet's selectors only match under `.uff-home-bs`).

## Implementation approach

### Decisions

- **All rendered sections live in the presentational `HomeLanding.jsx`** (plus the new `ConversationCarousel.jsx`). `HomeLandingContainer.jsx` keeps owning data + wiring; it gains only the language-change handler and the `buildShowcaseVideos()` call. The new sections are static copy + a static image, so there is no new data access. (The browser-language change is separate and touches `guest-modal-logic.js` + `use-guest-modal-guard.js`.)
- **Palette, not Bootstrap defaults.** `home-landing.css` overrides Bootstrap's theme variables with the main app's colours (`#0b1a2a` page, `#1a3a5a` cards, `#2a4a6a` borders, `#adb5bd` secondary text, `#00c0d8` links/accent, `#ff6b6b` danger, Inter first in the font stack) and defines the primary CTA as the app's gradient pill (`.btn-uff-primary`, `border-radius:8px; font-weight:600`) and the secondary CTA as an outlined button in the accent colour (`.btn-uff-outline`) — the Go/no-code treatments that were inline styles are now classes on the same Bootstrap `.btn` base.
- **The homepage is the only route that uses Bootstrap, and it uses Bootstrap 5.3.8 (bootstrap pinned to the exact `5.3.8`).** `node_modules/bootstrap/dist/css/bootstrap.min.css` (the package is pinned to the exact `5.3.8`) is not imported directly anywhere: `scripts/lib/bootstrap-homepage-css.js` rewrites **every** selector of that file under one root class (`.uff-home-bs`) — the `:root`/`html`/`body` reboots and variable blocks collapse onto the scope element, conditional group at-rules (`@media`/`@supports`) are recursed into, `@charset` and comments are dropped, and `@keyframes` are renamed to `bs-*` together with the `animation`/`animation-name` values and the `--bs-*-animation-name` custom properties that reference them. The pure module is unit-tested (including the invariant that no selector escapes the scope over the *real* Bootstrap CSS); a Vite plugin (`scripts/lib/bootstrap-homepage-plugin.js`, registered in `vite.config.js`) regenerates the committed output `src/generated/homepage-bootstrap.css` on every `buildStart` and writes only when the content changes. A repo-wide source guard asserts that no file under `src/` imports `bootstrap/` directly and that `HomeLanding.jsx` is the only module importing the scoped sheet — this is what makes "Bootstrap ONLY for the homepage" true rather than a convention.
- **The markup is idiomatic Bootstrap** — `navbar`/`container` top bar, `hero` band over `container > row > col-lg-*`, `card` for the share-code box, `list-group` + `bi-check-circle-fill` for the "How it works" points, `card`/`ratio` for the carousel, `container > row > col-lg-*` for the about section, `form-control`/`form-select`/`btn` for the controls — with typical Bootstrap entrance animations via `animate.css` (already a dependency, used by the legacy `public/landing.html`).
- **Design tokens come from the Bootstrap theme variables rather than inline styles.** `src/components/homescreen/home-landing.css` (imported only from the homepage) sets `--bs-body-bg: #0b1a2a`, `--bs-card-bg: #1a3a5a`, `--bs-border-color: #2a4a6a`, `--bs-secondary-color: #adb5bd`, `--bs-link-color: #00c0d8` and a `--uff-gradient` custom property, and defines the primary CTA as the app's gradient pill (`.btn-uff-primary`) plus an outlined secondary (`.btn-uff-outline`). Every rule in that file is scoped to `.uff-home-bs` or uniquely `uff-`-prefixed, so it cannot leak either.
- **The desktop viewport renders as a normal Bootstrap page.** The rest of the app lays out inside the 9:16 phone frame `#root.video-frame` (`app.css:347-368`); for the homepage only, `home-landing.css` adds `#root:has(> .uff-home-bs) { aspect-ratio: auto; width: 100%; max-width: none; height: 100dvh; border-radius: 0; margin: 0; box-shadow: none }`. The selector is CSS-only (no `document`/`classList` DOM manipulation, which the repo forbids) and matches only while the homepage is mounted, so no other route changes. Bootstrap's `container` breakpoints then produce the usual desktop layout (two-column hero, two-column how-it-works/about, expanding navbar).
- **The page must scroll internally.** `#root` is `.video-frame`, which is `overflow: hidden` (`app.css:347-355`), and `html, body { overflow: hidden }` (`index.html:56-58`). With sections added, the shell becomes `height: 100dvh; overflow-y: auto; display: flex; flex-direction: column` on `.uff-home-bs` in `home-landing.css`, so the sections and footer are reachable. On desktop the 9:16 frame is lifted (see above) and Bootstrap's `container` centers a normal page column.
- **No `.water-surface` class is added.** Story 050 deliberately keeps the water shimmer off non-lesson page shells; the homepage's opaque `#0b1a2a` container covers `#root`'s blue. Adding a `.water-surface` element (or removing the opaque background) would resurface the sheen and break `tests/water-shimmer-scope.spec.js`, which clips `#root` at `y + 300` on `/` and asserts zero marker pixels.
- **New copy is localized into the six existing UI languages** (en/es/pt/fr/hi/bn), consistent with the rest of the homepage and the `strings.js` contract enforced by `src/data/strings.test.js` (every key needs non-empty `hi`/`bn`). Native-speaker review of the non-English drafts is a follow-up, exactly as noted for story 056.
- **The teacher's name is a proper noun and is a JS module constant**, not a `strings.js` key: the `hi`/`bn` script guard (`/[\u0900-\u097F]/`, `/[\u0980-\u09FF]/`) would fail on a Latin-only name entry. Precedent: `PraiseBubble.jsx:4` hardcodes `botName = "Joe Walsh"`.
- **The photo is `src/assets/img/teacherprofile.webp`** — the teacher avatar already used by `PraiseBubble.jsx:2` (the only picture of the teacher in the assets; `cropped-teacher.png` is a corrupted PNG whose signature is invalid and cannot be decoded, and `teacherprofile.jpeg` is a lower-resolution raster of the same portrait).
- **The homepage detects the browser language.** On `/` only, an anonymous visitor who has not chosen a language has their browser language adopted silently when it is **one of the homepage's six supported languages** (EN is a no-op because English already renders; any other code, e.g. `DE`/`JA`, is a no-op), reusing the existing friend-lesson mechanism: `detectBrowserLanguage()` → `resolveHomepageLanguageAdoption(...)` → `setGuestLanguageSilent(lang)` (which also mirrors into `userData.native_language`, `store.js:239-244`) and `setGuestDetectedLang(lang)`. A logged-in user or an already-chosen guest language wins, and the early return still does **not** set `guestModalShownThisSession`, so the modal still opens on the next non-auth route (story 045). `silentLangRef` is deliberately **not** set here: the guest modal can still open later, and an explicit pick must beat the homepage's silent adoption.
- **A top-bar language selector** lists the six languages the homepage is translated into (`HOME_LANGUAGES`: EN/ES/PT/FR/HI/BN, native-name labels). Changing it calls `setGuestLanguageSilent(code)` (no modal, same action as the adoption), so the whole page — and any lesson the visitor starts — uses that language. It sits in the Bootstrap top bar (`.navbar` over the brand gradient) next to the account link and uses the app's own dropdown (Bootstrap `.form-select` with `--bs-form-select-bg-img` pointing at the white-arrow SVG, because the whole homepage shell is dark).
- **The conversation carousel shows posters first and loads a video only on play.** `ConversationCarousel` renders a fixed, curated list (`SHOWCASE_VIDEO_SLUGS`) as a one-slide-at-a-time track: each slide is an `<img loading="lazy">` poster (URL from `getPosterUrl`) plus a play button; pressing play mounts a single `<video src={getVideoUrl(slug)} poster={posterUrl} controls autoPlay playsInline>` for that slide, and pressing it on another slide / navigating slides unmounts it. No `<video>` element exists until a play is pressed, so no video bytes are fetched on page load. Bones: prev/next buttons are index-based (a `translateX(-n*100%)` track), so behaviour is deterministic and testable in jsdom (which does not implement `scrollBy`).
- **Showcase videos live permanently under the existing `assets/videos/` prefix** (no new URL builders): each is `assets/videos/<slug>.mp4` with a sibling `assets/videos/<slug>.jpg` poster, exactly like teacher media, so `getVideoUrl`/`getPosterUrl` and the dev `/assets/videos/` R2 proxy work unchanged. `SHOWCASE_VIDEO_SLUGS` (a tiny pure module) is the single place to edit the list.

### Layout (`HomeLanding.jsx` + `home-landing.css`)

```
<div className="uff-home-bs">                                // Bootstrap-loaded, scoped shell (see decisions)
  <nav className="navbar uff-navbar sticky-top" data-testid="landing-topbar">
    <div className="container">
      <Link className="navbar-brand"><img data-testid="home-logo" src={headerLogo} …></Link>
      <div className="d-flex align-items-center gap-2">
        <select data-testid="landing-language-select" className="form-select form-select-sm w-auto" …>
        <Link data-testid="landing-account-link" className="btn btn-sm btn-uff-outline" …>
      </div>
    </div>
  </nav>

  <header className="uff-hero uff-section animate__animated animate__fadeIn">
    <div className="container">
      <div className="row justify-content-center text-center">
        <div className="col-12 col-lg-8 col-xl-7">
          <h1 className="uff-hero-title text-white" data-testid="share-code-headline">…</h1>
          <div className="card border-secondary" data-testid="share-code-card">   // conversion box
            <div className="card-body">
              <h2 data-testid="share-code-subheadline" className="h5 fw-bold">…</h2>
              <form>
                <input data-testid="share-code-input" className="form-control form-control-lg" …>
                {error && <div data-testid="share-code-error" role="alert" className="alert …">…</div>}
                <button data-testid="share-code-go" type="submit" className="btn btn-uff-primary btn-lg w-100">…</button>
              </form>
              <button data-testid="no-code" type="button" className="btn btn-uff-outline w-100">…</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </header>

  <section className="uff-section" data-testid="how-it-works">
    <div className="container"><div className="row g-4 align-items-start">
      <div className="col-12 col-lg-5"><h2 data-testid="how-it-works-heading" className="uff-section-title">…</h2></div>
      <div className="col-12 col-lg-7">
        <ul className="list-group" data-testid="how-it-works-list">
          {HOW_IT_WORKS_KEYS.map((k,i)=><li data-testid={`how-it-works-item-${i+1}`} key={k}
              className="list-group-item d-flex align-items-start gap-3 animate__animated animate__fadeInUp"
              style={{animationDelay:`${i*90}ms`}}><i className="bi bi-check-circle-fill uff-check"/><span>…</span></li>)}
        </ul>
      </div>
    </div></div>
  </section>

  <ConversationCarousel lang={lang} videos={showcaseVideos} />   // its own uff-section--alt <section data-testid="showcase-carousel">

  <section className="uff-section uff-section--alt" data-testid="about-teacher">
    <div className="container"><div className="row g-4 align-items-center">
      <div className="col-12 col-lg-3 text-center text-lg-start">
        <img data-testid="about-teacher-photo" src={teacherPhoto} className="uff-teacher-photo uff-teacher-photo--lg …">
      </div>
      <div className="col-12 col-lg-9">
        <h2 data-testid="about-teacher-heading" className="uff-section-title">…</h2>
        <p data-testid="about-teacher-name" className="h5 fw-semibold">Joe Walsh</p>
        <p data-testid="about-teacher-credentials" className="lead text-secondary">…</p>
      </div>
    </div></div>
  </section>

  <div className="uff-footer py-4 mt-auto"><LegalFooter lang={lang} /></div>
</div>
```

`home-landing.css` (imported only from `HomeLanding.jsx`, alongside the scoped Bootstrap) supplies: the palette variables on `.uff-home-bs`, the `.uff-navbar` (brand gradient), `.uff-hero` band, `.uff-section`/`.uff-section--alt` rhythm, `.uff-hero-title`/`.uff-section-title` display type, `.btn-uff-primary`/`.btn-uff-outline`, the dark `--bs-form-select-bg-img` arrow, `list-group` borders, `.uff-check`, `.uff-carousel-*` (media 16:10, play button, arrows), `.uff-teacher-photo`, `.uff-footer`, and the `#root:has(> .uff-home-bs)` desktop-frame escape.

### Homepage browser-language adoption (`src/modules/user/guest-modal-logic.js` + `src/hooks/use-guest-modal-guard.js`)

Add two pure exports to `guest-modal-logic.js` (no React/DOM/store; it may import the pure `HOME_LANGUAGES` data like `config-normalizer.js` imports strings):

```js
import { HOME_LANGUAGES } from '../../data/languages.js';

export const HOMEPAGE_ROUTE = '/';

// True only for the homepage itself (case/trailing-slash normalized), not the
// other public routes (legal pages, confirm-email, courses).
export function isHomepageRoute(pathname) {
    if (typeof pathname !== 'string' || pathname === '') return false;
    return (pathname.replace(/\/+$/, '') || '/').toLowerCase() === HOMEPAGE_ROUTE;
}

// Whether the homepage should silently adopt the browser language. English is a
// no-op (English already renders); a logged-in user or an already chosen guest
// language wins; an unsupported code (e.g. DE/JA) is a no-op so guestNativeLanguage
// stays within the homepage's six languages. Returns { action: 'adopt', language } | { action: 'noop' }.
export function resolveHomepageLanguageAdoption({ isLoggedIn, guestLang, detectedLang, supportedLangs } = {}) {
    if (isLoggedIn) return { action: 'noop' };
    if (guestLang) return { action: 'noop' };
    if (!detectedLang || detectedLang === ENGLISH_LANG) return { action: 'noop' };
    const supported = Array.isArray(supportedLangs) ? supportedLangs : HOME_LANGUAGES.map((l) => l.value);
    if (!supported.includes(detectedLang)) return { action: 'noop' };
    return { action: 'adopt', language: detectedLang };
}
```

In `useGuestModalGuard`'s "open modal for non-auth guests" effect, extend the existing `isPublicHomeRoute(path)` early-return block (no new `return;` before the homepage one, so the existing source guard's slice is unchanged). Add `isHomepageRoute` and `resolveHomepageLanguageAdoption` to the hook's `guest-modal-logic.js` import line, and import `HOME_LANGUAGES` from `../../data/languages.js`:

```js
if (isPublicHomeRoute(path)) {
    if (isHomepageRoute(path)) {
        const detectedCode = detectBrowserLanguage();
        const plan = resolveHomepageLanguageAdoption({
            isLoggedIn,
            guestLang: state.guestNativeLanguage,
            detectedLang: detectedCode,
            supportedLangs: HOME_LANGUAGES.map((l) => l.value),
        });
        if (plan.action === 'adopt') {
            state.setGuestDetectedLang(detectedCode);
            state.setGuestLanguageSilent(plan.language);
            console.log('[GuestModalGuard] Homepage — adopted browser language silently:', plan.language);
        }
    }
    console.log('[GuestModalGuard] Public homepage — not opening the guest modal.');
    return;
}
```

`HomeLandingContainer` already subscribes to `guestNativeLanguage`, so the adoption re-renders the landing in the visitor's language without any container change; `Strings.get` normalizes the uppercase code (e.g. `'ES'` → `'es'`) and falls back to English for an unsupported language (`DE`, `JA`, …), matching how the guest picker already behaves.

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
| `home_landing_language_label` | `Language` | `Idioma` | `Idioma` | `Langue` | `भाषा` | `ভাষা` |
| `home_landing_showcase_heading` | `See what a conversation looks like` | `Mira cómo es una conversación` | `Veja como é uma conversa` | `Voyez à quoi ressemble une conversation` | `देखें कि बातचीत कैसी दिखती है` | `দেখুন একটি কথোপকথন কেমন দেখতে হয়` |
| `home_landing_showcase_play` | `Play video` | `Reproducir video` | `Reproduzir vídeo` | `Lire la vidéo` | `वीडियो चलाएँ` | `ভিডিও চালান` |

No value contains a `{`/`}` placeholder. The "How it works" bullets are derived from `share_message` (`strings.js:2216`): free; any level, it teaches you what to say; no need to be online at the same time; plus the app's speak-and-get-feedback loop and the 48-hour urgency.

### Test plan

- **Runtime (jsdom, `createRoot` + `act`, `MemoryRouter`)** in `src/components/homescreen/HomeLanding.test.jsx`: new sections, copy, structure, button roles/styles, scroll container, language selector, localization.
- **Runtime carousel** in `src/components/homescreen/ConversationCarousel.test.jsx`: poster-first rendering, play loads exactly one `<video>`, slide navigation and end-disabled arrows, empty list.
- **Pure logic** in `src/modules/video/showcase-videos.test.js` (`buildShowcaseVideos`), `src/modules/user/guest-modal-logic.test.js` (`isHomepageRoute`, `resolveHomepageLanguageAdoption`), and `src/data/languages.test.js` (`HOME_LANGUAGES`).
- **Static source guard** in `src/hooks/use-guest-modal-guard-public-route.test.js` (extended): the homepage branch adopts the browser language before its early `return;` and still does not set `guestModalShownThisSession`.
- **Strings exact-copy** in a new `src/data/strings-landing-sections.test.js` (mirrors `src/data/strings-friend-practice.test.js`) using `get`/`getBilingual`.
- **Bootstrap scoping** in a new `scripts/lib/bootstrap-homepage-css.test.js`: selector scoping, group-at-rule recursion, `@charset` dropping, string/brace parsing safety, keyframe renaming, the real-vendored-CSS invariant that no selector escapes the scope, and the pinned `5.3.8` version.
- **Static source guard** in a new `src/components/homescreen/homepage-landing-wiring.test.js` (mirrors `src/routes/home-navigation-wiring.test.js`): the scoped-Bootstrap import, the palette variables, the desktop frame escape, the selector, the carousel wiring, the absence of `water-surface`, the preserved testids, and the repo-wide checks that Bootstrap is loaded only here. Every slice is scoped to a specific block, asserts on raw source, and is proven able to fail (AGENTS.md).

## Tasks

### Task 1 — App-styled cover, buttons and a scrollable page

Modify `src/components/homescreen/HomeLanding.jsx` and `src/components/homescreen/HomeLanding.test.jsx`; create `src/components/homescreen/homepage-landing-wiring.test.js`.

- `HomeLanding` rendered with default props + inspect the rendered landing root (`container.firstChild`)
  - → its `className` is exactly `uff-home-bs` (the only element carrying the scoped Bootstrap root class)
  - → the top bar is Bootstrap `navbar` + `container` (`landing-topbar` `className` contains `navbar`, its child is a `.container`)
  - → the hero card is a Bootstrap `card` (`share-code-card` `className` contains `card`)
  - → the hero and each section use the Bootstrap grid: the hero `container` contains one `.row`, while `how-it-works` and `about-teacher` each contain exactly two `[class*="col-lg-"]` columns
  - → `share-code-input` carries Bootstrap's `form-control`
- `HomeLanding` rendered + inspect `share-code-go`
  - → its `tagName` is `BUTTON`, `type` is `submit`
  - → its `className` contains `btn-uff-primary` and `btn-lg` (the app's gradient primary on Bootstrap's `.btn`)
- `HomeLanding` rendered + inspect `no-code`
  - → its `tagName` is `BUTTON`
  - → its `type` attribute is `button`
  - → its `className` contains `btn-uff-outline` and `w-100` (the app's outlined secondary)
- `no-code` clicked + `onSubmitCode` provided
  - → `onNoCode` is called exactly once and `onSubmitCode` is not called (existing behaviour preserved)
- `homepage-landing-wiring.test.js` reads `HomeLanding.jsx` raw
  - → the source contains `import '../../generated/homepage-bootstrap.css'` and `import './home-landing.css'`
  - → the source contains `data-testid="share-code-input"`, `data-testid="share-code-go"`, `data-testid="share-code-error"`, `data-testid="no-code"`, and `data-testid="landing-account-link"`
  - → the source does not contain `water-surface`
- `homepage-landing-wiring.test.js` reads `home-landing.css` raw
  - → contains the exact token `linear-gradient(135deg, #3a8fd5 0%, #00c0d8 100%)`
  - → contains `--bs-body-bg: #0b1a2a`, `--bs-card-bg: #1a3a5a`, `--bs-border-color: #2a4a6a`, `--bs-secondary-color: #adb5bd`
  - → the `#root:has(> .uff-home-bs)` block (scoped to the next `}`) contains `aspect-ratio`, `width`, `height`, `border-radius` and `max-width`
- `homepage-landing-wiring.test.js` walks every `.js/.jsx/.css` module under `src/`
  - → no module matches an `import 'bootstrap/...'` statement (unscoped Bootstrap is never loaded)
  - → exactly one module imports the scoped sheet: `components/homescreen/HomeLanding.jsx`
- `homepage-landing-wiring.test.js` reads `src/generated/homepage-bootstrap.css`
  - → it starts with `uff-home-bs,`, contains `uff-home-bs .container` and `uff-home-bs .btn`, and does **not** contain `@charset`, `The Bootstrap Authors`, or a top-level `:root`/`html`/`body` selector

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
  - → `about-teacher-name` text is `Joe Walsh`
  - → `about-teacher-credentials` text is `I have a master's degree in teaching English to speakers of other languages (TESOL) and 20 years of experience teaching English.`
  - → `about-teacher-photo` is an `IMG`, its `alt` is `Joe Walsh`, and its `src` contains `teacherprofile` (the Vite asset URL for the imported `teacherprofile.webp`)
  - → `about-teacher-photo` inline `borderRadius` is `50%` and `width` is `96px`
- `HomeLanding` rendered with `lang='es'`
  - → `about-teacher-heading` text is `Sobre el profesor`
  - → `about-teacher-credentials` text is the Spanish copy from the table
- `homepage-landing-wiring.test.js` reads `HomeLanding.jsx` raw
  - → the source contains the import `from '../../assets/img/teacherprofile.webp'`
  - → the source contains the exact token `Joe Walsh`

### Task 4 — Landing-section strings

Modify `src/data/strings.js`; create `src/data/strings-landing-sections.test.js`.

- each of the eleven new keys in the table (`home_landing_how_heading`, `home_landing_how_1`…`_5`, `home_landing_about_heading`, `home_landing_about_credentials`, `home_landing_language_label`, `home_landing_showcase_heading`, `home_landing_showcase_play`) + `getBilingual(key, 'en').english`
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

### Task 6 — Homepage browser-language adoption

Modify `src/modules/user/guest-modal-logic.js`, `src/modules/user/guest-modal-logic.test.js`, `src/hooks/use-guest-modal-guard.js`, `src/hooks/use-guest-modal-guard-public-route.test.js`, and `src/components/homescreen/HomeLandingContainer.test.jsx`.

- `isHomepageRoute('/')`
  - → returns `true`
- `isHomepageRoute('//')` (the router tolerates the trailing slash; it normalizes to `/`)
  - → returns `true`
- `isHomepageRoute('/privacy')`, `isHomepageRoute('/terms')`, `isHomepageRoute('/confirm-email')`, `isHomepageRoute('/courses')`, `isHomepageRoute('/home')`, `isHomepageRoute('/course/model/lesson/g')`, `isHomepageRoute('/abc123')`
  - → each returns `false`
- `isHomepageRoute('')`, `isHomepageRoute(undefined)`, `isHomepageRoute(null)`
  - → each returns `false`
- `resolveHomepageLanguageAdoption({ isLoggedIn: false, guestLang: null, detectedLang: 'ES' })`
  - → returns `{ action: 'adopt', language: 'ES' }`
- `resolveHomepageLanguageAdoption({ isLoggedIn: false, guestLang: null, detectedLang: 'EN' })`
  - → returns `{ action: 'noop' }`
- `resolveHomepageLanguageAdoption({ isLoggedIn: false, guestLang: null, detectedLang: 'DE' })` (and `'JA'` — not in `HOME_LANGUAGES`)
  - → returns `{ action: 'noop' }`
- `resolveHomepageLanguageAdoption({ isLoggedIn: false, guestLang: null, detectedLang: 'DE', supportedLangs: ['DE'] })`
  - → returns `{ action: 'adopt', language: 'DE' }` (an explicit list is honored)
- `resolveHomepageLanguageAdoption({ isLoggedIn: false, guestLang: null, detectedLang: undefined })` (and `''`/`null`)
  - → returns `{ action: 'noop' }`
- `resolveHomepageLanguageAdoption({ isLoggedIn: true, guestLang: null, detectedLang: 'ES' })`
  - → returns `{ action: 'noop' }`
- `resolveHomepageLanguageAdoption({ isLoggedIn: false, guestLang: 'BN', detectedLang: 'ES' })`
  - → returns `{ action: 'noop' }` (an already-chosen language wins)
- `use-guest-modal-guard-public-route.test.js` slices the existing non-auth block (from `if (!isAuthRoute) {` to the `}, [isLoading, …]);` dep array)
  - → the block contains `isHomepageRoute(path)`, `detectBrowserLanguage()`, and `state.setGuestLanguageSilent(`
  - → `indexOf('isPublicHomeRoute(path)') < indexOf('detectBrowserLanguage()')` and `indexOf('detectBrowserLanguage()') < indexOf('state.setGuestLanguageSilent(')` and `indexOf('state.setGuestLanguageSilent(') < indexOf('return;', indexOf('isPublicHomeRoute(path)'))`
  - → the existing `earlyReturn` slice (from `isPublicHomeRoute(path)` to the first `return;`) still does not contain `setGuestModalShownThisSession`
- `HomeLandingContainer.test.jsx` with `appStore.setState({ guestNativeLanguage: 'ES', userData: null })` + render
  - → `share-code-headline` text is the Spanish copy (the uppercase browser code is normalized by `Strings.get`)
- `HomeLandingContainer.test.jsx` with `appStore.setState({ guestNativeLanguage: null, userData: null })` + render
  - → `share-code-headline` text is the English copy (no adopted language → English)

### Task 7 — Homepage language selector

Modify `src/data/languages.js`, `src/data/languages.test.js`, `src/components/homescreen/HomeLanding.jsx`, `src/components/homescreen/HomeLanding.test.jsx`, `src/components/homescreen/HomeLandingContainer.jsx`, `src/components/homescreen/HomeLandingContainer.test.jsx`, and `src/components/homescreen/homepage-landing-wiring.test.js`.

- `HOME_LANGUAGES` values + map
  - → equals `['EN', 'ES', 'PT', 'FR', 'HI', 'BN']` in order
- every `HOME_LANGUAGES` entry
  - → has a non-empty label, values are unique, and `EN` is present (unlike `GUEST_LANGUAGES`)
- `HomeLanding` rendered with default props + inspect `landing-language-select`
  - → its `tagName` is `SELECT`
  - → it has exactly 6 `OPTION` children whose values are `EN, ES, PT, FR, HI, BN` in order
  - → its `value` is `EN` and its `aria-label` is `Language`
  - → it carries the `form-select` class (the app's dropdown style)
- `HomeLanding` rendered with `lang='es'`
  - → `landing-language-select`.value is `ES`
- `HomeLanding` rendered with `lang='de'` (unsupported)
  - → `landing-language-select`.value is `EN`
- `landing-language-select` changed to `ES` + `onLanguageChange` provided
  - → `onLanguageChange` is called exactly once with `'ES'`
- `HomeLandingContainer` rendered + `landing-language-select` changed to `ES`
  - → `appStore.getState().guestNativeLanguage` is `'ES'`
  - → `share-code-headline` text becomes the Spanish copy (the container re-renders off the store)
- `homepage-landing-wiring.test.js` reads `HomeLanding.jsx` raw
  - → the source imports `HOME_LANGUAGES` from `../../data/languages.js`
  - → the source contains `data-testid="landing-language-select"`
  - → the source contains `onLanguageChange`
- `homepage-landing-wiring.test.js` reads `HomeLandingContainer.jsx` raw
  - → the source contains `setGuestLanguageSilent(` and `onLanguageChange`

### Task 8 — Concatenated-conversation carousel

Create `src/modules/video/showcase-videos.js`, `src/modules/video/showcase-videos.test.js`, `src/components/homescreen/ConversationCarousel.jsx`, `src/components/homescreen/ConversationCarousel.test.jsx`; modify `src/components/homescreen/HomeLanding.jsx`, `src/components/homescreen/HomeLanding.test.jsx`, `src/components/homescreen/HomeLandingContainer.jsx`, `src/components/homescreen/homepage-landing-wiring.test.js`.

- `SHOWCASE_VIDEO_SLUGS`
  - → is a non-empty array of non-empty strings
- `buildShowcaseVideos(['a', 'b'])`
  - → `[ { slug:'a', videoUrl: getVideoUrl('a'), posterUrl: getPosterUrl('a') }, { slug:'b', videoUrl: getVideoUrl('b'), posterUrl: getPosterUrl('b') } ]`
- `buildShowcaseVideos([])`, `buildShowcaseVideos(null)`, `buildShowcaseVideos('a')`
  - → each returns `[]`
- `buildShowcaseVideos(['a', '', null, 42, 'b'])`
  - → returns only the `a` and `b` entries (blank/non-string dropped, no throw)
- `ConversationCarousel` rendered with three videos (`A/B/C`), default `lang='en'`
  - → `showcase-carousel` and `showcase-heading` exist; `showcase-heading` text is `See what a conversation looks like`
  - → exactly 3 `showcase-poster-<slug>` `IMG`s and **zero** `VIDEO` elements
  - → each poster `src` equals that video's `posterUrl` and its `loading` attribute is `lazy`
  - → each slide has a `showcase-play-<slug>` `BUTTON`
  - → `showcase-track` inline `transform` is `translateX(-0%)`
- `showcase-play-B` clicked
  - → exactly one `VIDEO` exists and its `data-testid` is `showcase-video-B`
  - → that video's `src` is `B.videoUrl` and its `poster` is `B.posterUrl`
  - → `showcase-poster-B` is gone
- `showcase-play-A` clicked after `showcase-play-B`
  - → still exactly one `VIDEO`, with `src` `A.videoUrl`
- `showcase-next` clicked (index 0 → 1)
  - → `showcase-track` `transform` is `translateX(-100%)`
  - → zero `VIDEO` elements (a playing clip is unmounted on navigation)
  - → `showcase-prev` is not disabled
- `showcase-prev` clicked at index 0 / `showcase-next` at the last index
  - → the respective arrow is `disabled`
- `ConversationCarousel` rendered with `videos=[]`
  - → `showcase-carousel` is absent
- `ConversationCarousel` rendered with `lang='es'`
  - → `showcase-heading` text is `Mira cómo es una conversación` and the play button `aria-label` is `Reproducir video`
- `HomeLanding` rendered with a three-entry `showcaseVideos` prop
  - → `showcase-carousel` exists with 3 posters and zero `VIDEO`s
- `HomeLanding` rendered with `showcaseVideos={[]}`
  - → no `showcase-carousel` element
- `homepage-landing-wiring.test.js` reads `HomeLandingContainer.jsx` raw
  - → the source contains `buildShowcaseVideos(`
- `homepage-landing-wiring.test.js` reads `src/modules/video/showcase-videos.js` raw
  - → the source imports `getVideoUrl` and `getPosterUrl` from `video-url.js`
- `homepage-landing-wiring.test.js` reads `ConversationCarousel.jsx` raw
  - → the source contains `data-testid="showcase-carousel"`
  - → with `playAt = indexOf('playingSlug === v.slug')` and `videoAt = indexOf('<video')`, both are greater than `-1`, `videoAt` is greater than `playAt`, and `(source.match(/<video/g) || []).length` is `1` (the video element exists only in the play branch — the poster-first contract)
  - → the source does not contain `water-surface`

### Task 9 - Bootstrap 5.3.8, scoped to the homepage

Create `scripts/lib/bootstrap-homepage-css.js`, `scripts/lib/bootstrap-homepage-css.test.js`, `scripts/lib/bootstrap-homepage-plugin.js`, and `src/generated/homepage-bootstrap.css`; modify `package.json` (pin `bootstrap` to the exact `5.3.8`), `vite.config.js` (register the plugin), `src/components/homescreen/HomeLanding.jsx` (import the scoped sheet + the palette), `src/components/homescreen/ConversationCarousel.jsx`, and `src/components/homescreen/homepage-landing-wiring.test.js`.

- `scopeBootstrapCss` + the real Bootstrap 5.3.8 CSS (`readSourceBootstrapCss()`)
  - → every qualified-rule selector carries the scope class (`isFullyScoped` is `true`, asserted as a test)
  - → no top-level `:root`/`html`/`body` selector, `@charset` or banner comment remains
  - → the `.container`, `.row`, `.col-lg-*`, `.card`, `.btn`, `.list-group`, `.form-select`, `.navbar` and `.d-none` rules survive, scoped
  - → every `@keyframes` is renamed to `bs-*`, and both the `animation`/`animation-name` values and the `--bs-spinner-animation-name`-style custom properties referencing them are rewritten
- `scopeSelector(':root' | 'html' | 'body')`
  - → returns the scope class
- `scopeSelector('.btn')`, `scopeSelector('.row > *')`, `scopeSelector('[data-bs-theme=dark]')`, `scopeSelector('::selection')`
  - → each returns the descendant-scoped form
- `@media (prefers-reduced-motion:no-preference){:root{scroll-behavior:smooth}}` + `scopeBootstrapCss`
  - → the prelude is preserved verbatim and the inner rule is scoped
- `renameAnimationNames('.spinner-border{animation:.75s linear infinite spinner-border}', { spinner-border: 'bs-spinner-border' })`
  - → the value is rewritten while the `.spinner-border` selector is untouched
- `parseStatements('a[href^="#"]{content:"{"}[data-x="}"]{color:red}')`
  - → two statements with the correct preludes and brace-safe bodies
- `writeHomepageBootstrapCss()`
  - → writes `src/generated/homepage-bootstrap.css`, reporting `changed: true` on a change and `false` when the content already matches (idempotent, no watcher loop)
- `vite.config.js` source inspected
  - → imports `homepageBootstrapPlugin` from `scripts/lib/bootstrap-homepage-plugin.js` and lists it as the first plugin
- `package.json` source inspected
  - → the `bootstrap` dependency is exactly `5.3.8`

## Technical Context

No new runtime or dev dependencies. Versions from `package.json`: React `^19.2.0`, React DOM `^19.2.0`, `react-router-dom` `^7.15.1`, `bootstrap-icons` `^1.11.3`, Zustand `^5.0.13`, Vitest `^4.1.6`, jsdom `^29.1.1`, Vite `^8.0.10`, `@playwright/test` `^1.60.0`.

- **App design tokens** live inline in components (there is no shared style module): `HomeScreen.jsx:55-122` (`containerStyle`, `topBarStyle`, `cardStyle`/`courseCardStyle`, `continueBtnStyle`, `brandGradient`) and `CourseListings.jsx:10-31`. HomeLanding must reproduce those exact values; it already uses `#0b1a2a`/`#1a3a5a`/`#2a4a6a`/the gradient/font stack.
- **Scrolling:** `#root` is `<div id="root" class="video-frame water-surface ...">` (`index.html:194`) and `.video-frame { overflow: hidden }` (`app.css:347-355`); `html, body { overflow: hidden }` (`index.html:56-58`). Only an internal `height:100dvh; overflowY:auto` container scrolls (the dashboard's pattern, `HomeScreen.jsx:68-76`). The current `minHeight:100dvh` centered layout cannot scroll.
- **jsdom style values:** hex colours are normalised to `rgb(...)` (e.g. `#0b1a2a` → `rgb(11, 26, 42)`, `#00c0d8` → `rgb(0, 192, 216)`), and a `background: linear-gradient(...)` reads back from `element.style.background`/`backgroundImage`. The `.border` shorthand drops its colour in jsdom, so the component declares `borderWidth`/`borderStyle`/`borderColor` longhands and tests read `style.borderColor`.
- **Bootstrap utility classes are a hand-written subset** (`app.css`): `.d-flex`, `.align-items-center`, `.text-center`, `.mb-3`, `.form-select` (incl. `.form-select.bg-dark`, `.form-select-xl`) and `.border-secondary` exist; `.list-unstyled`, `.lead`, and `.form-select-sm` do **not**. The new sections therefore use inline styles (matching the existing landing) and, for the language dropdown, the existing `.form-select.bg-dark` classes with a small inline size override.
- **Showcase video URLs:** `getVideoUrl(slug)` (`video-url.js:12-24`) resolves an `assets/videos/` slug to `/assets/videos/<slug>.mp4` in dev and `https://r2.ultrafastfluency.com/assets/videos/<slug>.mp4` in prod; `getPosterUrl(slug)` (`video-url.js:30-38`) is the same URL with `.mp4`→`.jpg`. `vite.config.js:71-75` proxies `/assets/videos/` to R2, so the carousel posters/videos resolve in dev with no new code. Slugs ending `-response-NN` are UGC and resolve to the temporary `videos/` namespace instead (`video-url.js:4-19`) — the showcase slugs must **not** end that way.
- **The temporary namespace:** the concatenated recap is `videos/<shareCode>-<courseId>-<lessonId>-complete.mp4` under the 48 h `videos/` TTL (`getCompleteVideoKey`, `video-url.js:45-52`; published by `uploadCompleteVideoToR2`). The carousel must read permanent `assets/videos/` objects, not this key.
- **Icons:** `bootstrap-icons/font/bootstrap-icons.css` is imported in `main.jsx:3`, so `<i className="bi bi-check-circle-fill">` renders (the pattern already used by `HomeScreen.jsx` and the old `public/landing.html`).
- **Strings contract:** `src/data/strings.test.js` asserts every key has non-empty `hi`/`bn` in the right script (lines 16-32) and auto-derives placeholder keys from `en` (lines 12-14); `getBilingual` reports `.localized === null` for a missing language (used by `strings-friend-practice.test.js`). These run in the default `vitest` suite, so the eleven new keys must carry all six languages.
- **Language resolution:** the homepage resolves `guestNativeLanguage || userData?.native_language || 'en'` (`HomeLandingContainer.jsx:21-23`); the dashboard/profile equivalent is `useNativeLanguage()` → `resolveConfigLanguage` (`use-native-language.js:18-22`, `config-normalizer.js:19-21`). `detectBrowserLanguage()` returns an uppercase two-letter code and falls back to `'EN'` (`use-guest-modal-guard.js:18-26`). `setGuestLanguageSilent(lang)` adopts without opening the modal and mirrors into `userData.native_language` (`store.js:239-244`); `applyGuestLanguagePreference` (called from `setCourseData`, `store.js:338-347`) keeps `guestNativeLanguage` over a later bootstrap write. `Strings.get` normalizes case and falls back to English for unsupported codes (so a `DE`/`JA` guest language renders English); the homepage adoption is limited to `HOME_LANGUAGES`, so it never writes an unsupported code to the store.
- **`AGENTS.md` guards that apply:** the new files under `src/**` must not mention the operator recorder page (`src/modules/video/recorder-page.test.js`); source guards must be scoped to a named block, assert on raw source, and be able to fail. `src/components/intro-caller-name.test.js` only inspects `IncomingVideoWidget.jsx`/`video-loader.web.js`, so adding `Joe Walsh` to `HomeLanding.jsx` does not trip it.
- **CI:** `.github/workflows/deploy.yml` runs `npm test -- --run`; `.github/workflows/playwright.yml` runs `tests/`. Verify locally (`npx vitest run`, `npx playwright test`) before pushing; do not dispatch workflows.

## Notes

- **Explicit assumptions** (each is a decision the user may want to revise):
  - The teacher's name is **"Joe Walsh"**, matching the app's existing spelling (`PraiseBubble.jsx`, `answer-pipeline.js`). No other surface is renamed.
  - **Language:** the homepage now silently adopts the browser language when it is one of its six (see Implementation approach); an English browser, an unsupported browser language, a logged-in user, or an already-chosen guest language is unchanged. This supersedes story 045's "browser-language auto-detection on `/` is out of scope" note intentionally.
  - The photo is `src/assets/img/teacherprofile.webp` — the teacher avatar used by `PraiseBubble.jsx`. `cropped-teacher.png` is a 410 KB PNG with a corrupted signature (`89 50 4E 47 0D 0A 1A 0D 0A`, ffmpeg cannot decode it) and is unusable; `teacherprofile.jpeg`/`.webp` are the same 150–192 px portrait. A 96 px circular avatar is the intended use; if a higher-resolution photo is wanted, supply one and swap the import.
  - The new sections are localized into all six UI languages (repo convention). The non-English values are drafted here and should be reviewed by a native speaker later, as with story 056's keys.
  - Design direction: the page keeps the dark navy base and reuses the app's gradient primary button, app cards and font, and turns the secondary action into an app-style outlined button. It deliberately does **not** add the lesson `water-surface` gradient (see Implementation approach) and does **not** add a second CTA/signup block, to keep the page short.
  - The "How it works" list is a single 5-item bulleted card (no numbered steps) built from `share_message`; no new images/screenshots are added.
  - **Showcase videos:** `SHOWCASE_VIDEO_SLUGS` is `exrwr-wouldyourather-b-complete`, `pwspi-wouldyourather-b-complete`, `exycy-wouldyourather-b-complete` — the author's own `wouldyourather` lesson-b recaps, already copied from the temporary `videos/` prefix to `assets/videos/<slug>.mp4` + `.jpg` (verified `200`). Edit `SHOWCASE_VIDEO_SLUGS` to change the set; it is the single source.
  - **Language set:** the selector offers only the six languages the homepage is translated into (`HOME_LANGUAGES`), not the guest modal's 18 (`GUEST_LANGUAGES`), because the page copy exists only in those six; a browser in another language (e.g. German) sees English until it picks one of the six. The silent browser adoption uses the same six, so `guestNativeLanguage` never holds a code the page cannot render.
  - **Selector for logged-in users:** the selector writes `guestNativeLanguage` (the guest-first language) for everyone, so a logged-in visitor who uses it switches the app's UI language for the session; the profile language is untouched.
  - **Carousel placement:** the carousel sits between "How it works" and "About the teacher"; only the current slide's `<video>` is ever mounted, and `preload="none"` + `poster` keep the still until playback.
- **R2 video headers:** the showcase `<video>` plays a cross-origin `assets/videos/*` object, so the R2 `ACAO: *` + `CORP: cross-origin` rules (including `206` range responses) must stay configured — the same prerequisite as lesson videos (`docs/cloudflare-video-cors.md`).
- **Known limitation (unchanged):** on desktop `#root` is a 9:16 phone frame (`app.css:357-368`), so the landing renders in a narrow column regardless of viewport width.
- **Conversion copy is English-authored:** the request says the message "explains how it works and addresses objections"; the five bullets cover free/no-card, any level, no simultaneous scheduling, instant speaking feedback, and the 48-hour window (the `share_message` objection points).
