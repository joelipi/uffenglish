# Inviting friend-practice area on the public profile + a public course-listings page

## Context

The public profile (`/:shareCode` → `PublicProfile.jsx` → `FriendLessonLinksSection.jsx`) is the page a learner shares with friends so they can practice English by answering the learner's recorded questions. Today its friend-challenge area is a flat set of course groups: a small muted 16px course name over a stack of 32px underlined links. It reads like a debug list, not an invitation, and when the 48-hour R2 clip window has passed the section simply disappears — a visitor (and the profile owner) gets no explanation and no next step.

This story makes the area inviting and gives expired visitors a way back in:

1. The links area gains a headline **"Practice English with Me Free"** and a subheading **"click on a lesson link to start."**, the course name becomes a **large heading**, and the lesson links become a **bulleted list of clearly underlined links** (each keeping its existing "Available for {time}" countdown).
2. When there are **no active links** (nothing recorded yet, or every entry has aged past 48h), the course area is replaced by a message explaining the 48h expiry and a **large "Practice English Free" link**.
3. That link opens a new **public `/courses` page**. It leads with the heading **"Choose a conversation to have with your friends and practice English with them free."** and a two-step numbered list (complete the first mini lesson in under five minutes; share your special link so friends can reply and continue the conversation), then lists every available friend course, each targeting the course's **first lesson** with no share code, so anyone can start a fresh challenge.

A "friend course" is defined by config data, not by a hardcoded list: any `src/config/*.json` that contains at least one lesson with `recapOverlay: "shareCta"`. The `test.json` fixture is explicitly excluded so it can keep being used to test without ever surfacing to users. Today this yields **`friend`, `friendchain`, `wouldrather`, `wouldyourather`** (verified against the real configs).

## Out of Scope

- Any change to how friend links are recorded (the `friend_links` jsonb map, `resolveFriendLessonLink`, the 48h window, or the export path). Only the render of the existing data changes.
- Linking the `/courses` page from the homepage `no-code` button or the home dashboard; it is reached from the profile's expired-state link only (plus its own URL).
- Per-lesson "jump to lesson N" links on the listings page. Every course card targets the **first** lesson only (the first `shareCta` lesson, i.e. `a`). Lessons after the first embed `{friendCode}` video references that require a `?shareCode=`, so they are not startable standalone from a listing.
- Changing `test.json`/`friend.json` content, their internal `courseId: "20260921"`, or any config JSON.
- Renaming the test fixture away from `test.json`; the exclusion is by that filename.
- Native (React Native) implementations.

## Implementation approach

### 1. Friend-course rules (`src/modules/courses/friend-courses-logic.js`, pure)

No DOM, no store, no data access — same shape as the other `*-logic.js` modules.

```js
export const EXCLUDED_FRIEND_COURSE_IDS = ['test']; // test.json fixture — never user-visible

export function isFriendLesson(lesson) {
    return !!lesson && lesson.recapOverlay === 'shareCta';
}

export function isFriendCourse(config) {
    return !!config && Array.isArray(config.lessons) && config.lessons.some(isFriendLesson);
}

export function firstFriendLessonId(config) {
    if (!config || !Array.isArray(config.lessons)) return null;
    const lesson = config.lessons.find(isFriendLesson);
    return lesson && typeof lesson.lessonId === 'string' && lesson.lessonId ? lesson.lessonId : null;
}

export function buildCourseStartHref(courseId, lessonId) {
    return `/course/${courseId}/lesson/${lessonId}`;
}

// entries: [{ courseId, config }] where courseId is the config FILE basename.
// Returns [{ courseId, courseName, lessonCount, firstLessonId }], sorted by courseId.
export function listFriendCourses(entries) {
    if (!Array.isArray(entries)) return [];
    return entries
        .filter((e) => e && typeof e.courseId === 'string' && e.courseId !== '')
        .filter((e) => !EXCLUDED_FRIEND_COURSE_IDS.includes(e.courseId))
        .filter((e) => isFriendCourse(e.config))
        .map((e) => ({
            courseId: e.courseId,
            courseName: (typeof e.config.courseName === 'string' && e.config.courseName) ? e.config.courseName : e.courseId,
            lessonCount: e.config.lessons.length,
            firstLessonId: firstFriendLessonId(e.config),
        }))
        .filter((c) => !!c.firstLessonId)
        .sort((a, b) => (a.courseId < b.courseId ? -1 : a.courseId > b.courseId ? 1 : 0));
}
```

**Route courseId rule:** the `courseId` used in URLs is the **config file's basename** (what `AppLayout.jsx` fetches: `/src/config/${courseId}.json`), NOT `config.courseId`. This matters because `friend.json`/`test.json` carry an internal `courseId: "20260921"` that is not a file. The listings loader supplies the basename (see §2).

### 2. Config loader (`src/modules/courses/friend-course-configs.js`)

Vite bundles each `src/config/*.json` as its own lazy chunk; the listings page loads them all in memory and filters. (Verified in this repo: `import.meta.glob` works under Vite 8 and vitest 4, and `await load()` returns `{ default: <config> }`.)

```js
// Lazy (non-eager) so config JSON is not pulled into the main bundle; each
// config gets its own chunk and is fetched only when the listings page opens.
const configModules = import.meta.glob('../../config/*.json');

export function configCourseId(path) {
    return path.replace(/^.*\//, '').replace(/\.json$/, '');
}

// Injectable for tests. A module whose loader rejects is skipped, never fatal.
export async function loadConfigEntries(modules = configModules) {
    const entries = await Promise.all(
        Object.entries(modules).map(async ([path, load]) => {
            try {
                const mod = await load();
                return { courseId: configCourseId(path), config: mod?.default ?? mod };
            } catch (error) {
                console.error('[friend-courses] Failed to load config', path, error);
                return null;
            }
        })
    );
    return entries.filter(Boolean);
}
```

### 3. Listings page

- `src/components/courses/CourseListings.jsx` — presentational. Props: `{ lang = 'en', courses, isLoading = false, isError = false, onBack }`.
  - Header: a back button (`data-testid="friend-courses-back"`, `onClick={onBack}`) and an `<h1 data-testid="friend-courses-heading">` with `Strings.get('friend_courses_heading', lang)` ("Choose a conversation to have with your friends and practice English with them free.").
  - Directly under the heading, a **normal-text numbered list** — `<ol data-testid="friend-courses-steps">` with two `<li>`: `Strings.get('friend_courses_step_1', lang)` then `Strings.get('friend_courses_step_2', lang)`. Rendered as ordinary body text (16px, light colour), **not** a heading/subheading, in every state (loading/error/empty/ready).
  - `isLoading` → `<div data-testid="friend-courses-loading">` spinner (reuse `.spinner-border`).
  - `isError` → `<div data-testid="friend-courses-error">` with `Strings.get('home_courses_load_error', lang)`.
  - `courses` empty → `<div data-testid="friend-courses-empty">` with `Strings.get('friend_courses_empty', lang)`.
  - Otherwise a vertical list of course cards. Each card: `<a data-testid="friend-course-card" href={buildCourseStartHref(course.courseId, course.firstLessonId)}>` containing the course name (`<h2>`, large) and `Strings.get('friend_courses_lesson_count', lang, { count: course.lessonCount })`.
  - **Plain `<a href>` (not `<Link>`)** so the presentational component is Router-free and unit-testable with `createRoot` (repo convention). Card style mirrors `HomeScreen`'s `courseCardStyle` (`#1a3a5a`, 12px radius, `1px solid #2a4a6a`).
- `src/components/courses/CourseListingsContainer.jsx` — data. Uses `useNativeLanguage()`, `useNavigate()`, and:
  ```js
  const { data: courses, isLoading, isError } = useQuery({
      queryKey: ['friend-courses'],
      queryFn: async () => listFriendCourses(await loadConfigEntries()),
      staleTime: Infinity,
  });
  return <CourseListings lang={lang} courses={courses} isLoading={isLoading} isError={isError} onBack={() => navigate('/')} />;
  ```
- `src/routes/CoursesRoute.jsx` — route shell mirroring `PublicProfileRoute`/`HomeRoute`: `usePreloader().finishPreloader()` in a mount effect (with the repo's `// eslint-disable-line react-hooks/exhaustive-deps`), then `<CourseListingsContainer />`.
- `src/routes/routes.jsx` — add `import CoursesRoute from './CoursesRoute.jsx';` and, **before** `{ path: '/:shareCode', ... }`:
  `{ path: '/courses', element: <CoursesRoute /> },`
- `src/modules/user/guest-modal-logic.js` — add `'/courses'` to `PUBLIC_ROUTES` and extend the comment (public course listings must be readable by anonymous visitors). Append it after `'/confirm-email'`: `['/', '/privacy', '/terms', '/confirm-email', '/courses']`.

### 4. Profile link area (`src/components/profile/FriendLessonLinksSection.jsx`)

Keep the ticking clock (`setInterval(…, 1000)` while active) and `groupActiveFriendLinks`.

**Active state** (one or more groups):

```
<div data-testid="friend-lesson-links"  (flex column, gap 24px, marginBottom 24px)>
  <div>
    <h2 data-testid="friend-lesson-links-heading">   Practice English with Me Free      (28px / 700 / #ffffff)
    <p  data-testid="friend-lesson-links-subheading"> click on a lesson link to start.   (15px / #adb5bd)
  </div>
  per group (data-testid="friend-lesson-link-group", card style #1a3a5a / 12px / 20px / 1px #2a4a6a):
    <h3 data-testid="friend-lesson-link-group-heading">   group.courseName              (26px / 800 / #ffffff)
    <ul data-testid="friend-lesson-link-list" style="list-style: disc; padding-left: 1.5rem;">
      per entry:
        <li>
          <a data-testid="friend-lesson-link" href={toFriendLessonHref(buildFriendLessonLink(...))}
             style="font-size: 24px; font-weight: 700; color: #ffffff; text-decoration: underline;">{label}</a>
          <p data-testid="friend-lesson-link-countdown" style="font-size: 14px; color: #adb5bd; margin: 4px 0 0;">Available for {time}</p>
        </li>
</div>
```

`label` is unchanged: `entry.lessonTitle` when non-empty, else `Strings.get('profile_friend_lesson_link', lang)`. The `href` builder is unchanged.

**Empty / expired state** (zero active groups — covers an empty `friendLinks`, `undefined`, and all-expired): replace the whole section with

```
<div data-testid="friend-lessons-expired"  (card style, textAlign center)>
  <p data-testid="friend-lessons-expired-message"> {profile_friend_lessons_expired}   (16px / #adb5bd / line-height 1.5)
  <a data-testid="friend-lessons-practice-free" href="/courses"
     style="font-size: 28px; font-weight: 800; color: #ffffff; text-decoration: underline;">Practice English Free</a>
</div>
```

Plain `<a href="/courses">` (full page navigation) keeps the unit test Router-free, consistent with the section's external anchors.

Do not render `friend-lesson-links` / heading / subheading in the expired state (the user asked for the course area to be hidden).

### 5. Strings (`src/data/strings.js`)

Add next to the existing `profile_friend_*` block (~line 1198). Every key gets `en`, `es`, `pt`, `fr`, `hi`, `bn` with exactly these values (nine keys):

| key | en | es | pt | fr | hi | bn |
| --- | --- | --- | --- | --- | --- | --- |
| `profile_friend_practice_heading` | `Practice English with Me Free` | `Practica inglés conmigo gratis` | `Pratique inglês comigo grátis` | `Pratiquez l'anglais avec moi gratuitement` | `मेरे साथ मुफ़्त अंग्रेज़ी का अभ्यास करें` | `আমার সাথে বিনামূল্যে ইংরেজি চর্চা করুন` |
| `profile_friend_practice_subheading` | `click on a lesson link to start.` | `haz clic en un enlace de lección para empezar.` | `clique em um link de lição para começar.` | `cliquez sur un lien de leçon pour commencer.` | `शुरू करने के लिए किसी पाठ लिंक पर क्लिक करें।` | `শুরু করতে একটি পাঠের লিঙ্কে ক্লিক করুন।` |
| `profile_friend_lessons_expired` | `All this user's lessons have expired after 48 hours, start a new lesson and send them the link to get them back into practicing English.` | `Todas las lecciones de este usuario han caducado después de 48 horas; empieza una nueva lección y envíale el enlace para que vuelva a practicar inglés.` | `Todas as lições deste usuário expiraram após 48 horas; comece uma nova lição e envie o link para que ele volte a praticar inglês.` | `Toutes les leçons de cet utilisateur ont expiré après 48 heures ; commencez une nouvelle leçon et envoyez-lui le lien pour qu'il se remette à pratiquer l'anglais.` | `इस उपयोगकर्ता के सभी पाठ 48 घंटे बाद समाप्त हो गए हैं; एक नया पाठ शुरू करें और उन्हें लिंक भेजें ताकि वे फिर से अंग्रेज़ी का अभ्यास कर सकें।` | `এই ব্যবহারকারীর সমস্ত পাঠ ৪৮ ঘণ্টা পরে মেয়াদোত্তীর্ণ হয়ে গেছে; একটি নতুন পাঠ শুরু করুন এবং তাকে লিঙ্ক পাঠান যাতে সে আবার ইংরেজি চর্চা করতে পারে।` |
| `profile_friend_practice_free` | `Practice English Free` | `Practica inglés gratis` | `Pratique inglês grátis` | `Pratiquez l'anglais gratuitement` | `मुफ़्त अंग्रेज़ी का अभ्यास करें` | `বিনামূল্যে ইংরেজি চর্চা করুন` |
| `friend_courses_heading` | `Choose a conversation to have with your friends and practice English with them free.` | `Elige una conversación para tener con tus amigos y practica inglés con ellos gratis.` | `Escolha uma conversa para ter com seus amigos e pratique inglês com eles grátis.` | `Choisissez une conversation à avoir avec vos amis et pratiquez l'anglais avec eux gratuitement.` | `अपने दोस्तों के साथ करने के लिए एक बातचीत चुनें और उनके साथ मुफ़्त अंग्रेज़ी का अभ्यास करें।` | `আপনার বন্ধুদের সাথে করার জন্য একটি কথোপকথন বেছে নিন এবং তাদের সাথে বিনামূল্যে ইংরেজি চর্চা করুন।` |
| `friend_courses_step_1` | `Complete the first mini lesson in under five minutes.` | `Completa la primera mini lección en menos de cinco minutos.` | `Complete a primeira mini lição em menos de cinco minutos.` | `Terminez la première mini-leçon en moins de cinq minutes.` | `पहला मिनी पाठ पाँच मिनट से कम समय में पूरा करें।` | `পাঁচ মিনিটের কম সময়ে প্রথম মিনি পাঠ সম্পন্ন করুন।` |
| `friend_courses_step_2` | `Share your special link with friends, family, and colleagues so that they can reply to you and continue the conversation.` | `Comparte tu enlace especial con amigos, familiares y colegas para que puedan responderte y continuar la conversación.` | `Compartilhe seu link especial com amigos, familiares e colegas para que eles possam responder a você e continuar a conversa.` | `Partagez votre lien spécial avec vos amis, votre famille et vos collègues pour qu'ils puissent vous répondre et poursuivre la conversation.` | `अपना विशेष लिंक दोस्तों, परिवार और सहकर्मियों के साथ साझा करें ताकि वे आपको जवाब दे सकें और बातचीत जारी रख सकें।` | `আপনার বিশেষ লিঙ্ক বন্ধু, পরিবার ও সহকর্মীদের সাথে শেয়ার করুন যাতে তারা আপনাকে উত্তর দিতে পারে এবং কথোপকথন চালিয়ে যেতে পারে।` |
| `friend_courses_empty` | `No friend courses are available right now. Please check back soon.` | `No hay cursos con amigos disponibles en este momento. Vuelve pronto.` | `Nenhum curso com amigos está disponível no momento. Volte em breve.` | `Aucun cours avec des amis n'est disponible pour le moment. Revenez bientôt.` | `अभी कोई मित्र पाठ्यक्रम उपलब्ध नहीं है। कृपया जल्द ही दोबारा देखें।` | `এখন কোনো বন্ধু কোর্স উপলব্ধ নেই। শীঘ্রই আবার দেখুন।` |
| `friend_courses_lesson_count` | `{count} lessons` | `{count} lecciones` | `{count} lições` | `{count} leçons` | `{count} पाठ` | `{count}টি পাঠ` |

`{count}` interpolation uses the existing `Strings.get(key, lang, { count })` placeholder mechanism (see `profile_friend_link_available`).

## Tasks

### Task 1 — Friend-course domain logic (`src/modules/courses/friend-courses-logic.js`)

- `isFriendLesson` + lesson with `recapOverlay: 'shareCta'`
  - → returns `true`
- `isFriendLesson` + lesson with a different / missing `recapOverlay`, or `null`/`undefined`
  - → returns `false`
- `isFriendCourse` + config whose `lessons` include a `shareCta` lesson
  - → returns `true`
- `isFriendCourse` + config with lessons but no `shareCta`, config without a `lessons` array, or `null`
  - → returns `false`
- `firstFriendLessonId` + config whose first `shareCta` lesson is not the first lesson
  - → returns that `shareCta` lesson's `lessonId`
- `firstFriendLessonId` + config with no `shareCta` lesson, or a `shareCta` lesson with a blank `lessonId`
  - → returns `null`
- `buildCourseStartHref('wouldrather', 'a')`
  - → returns `/course/wouldrather/lesson/a`
- `listFriendCourses` + entries built from the **real** `src/config/*.json` (friend, friendchain, wouldrather, wouldyourather, model, t, gt2, test-api, test)
  - → courseIds are exactly `['friend', 'friendchain', 'wouldrather', 'wouldyourather']` in that order
  - → `test` is absent (excluded fixture), and `model`/`t`/`gt2`/`test-api` are absent (no `shareCta`)
  - → the `friendchain` entry is `{ courseId: 'friendchain', courseName: 'Friend Challenge', lessonCount: 8, firstLessonId: 'a' }`
- `listFriendCourses` + a config whose only `shareCta` lesson has no `lessonId`
  - → that entry is dropped (no `firstLessonId` to link to)
- `listFriendCourses` + entries with a non-string/blank `courseId`, or `null` items
  - → dropped without throwing
- `listFriendCourses` + non-array input (`null`, `undefined`, `{}`)
  - → returns `[]`
- `listFriendCourses` + two differently-ordered inputs of the same entries
  - → both return the same courseId order (deterministic sort)

### Task 2 — Config loader (`src/modules/courses/friend-course-configs.js`)

- `configCourseId('./config/friendchain.json')` / `configCourseId('../../config/wouldyourather.json')`
  - → `'friendchain'` / `'wouldyourather'`
- `loadConfigEntries()` (default Vite glob)
  - → resolves to entries whose courseIds include all nine configs (`friend, friendchain, gt2, model, t, test-api, test, wouldrather, wouldyourather`)
  - → the `friendchain` entry's `config.lessons` has length 8 (JSON is parsed, not raw text)
- `loadConfigEntries({ './a.json': async () => ({ default: { lessons: [] } }), './b.json': async () => { throw new Error('boom'); } })`
  - → resolves to only the `a` entry (`{ courseId: 'a', config: { lessons: [] } }`); the failing loader is skipped and the call does not reject
- `listFriendCourses(await loadConfigEntries())` (integration)
  - → courseIds are exactly `['friend', 'friendchain', 'wouldrather', 'wouldyourather']`

### Task 3 — Listings page + public route

- `CourseListings` rendered with `courses = [{ courseId: 'friendchain', courseName: 'Friend Chain', lessonCount: 8, firstLessonId: 'a' }, { courseId: 'wouldyourather', courseName: 'Prefs', lessonCount: 2, firstLessonId: 'a' }]`
  - → `friend-courses-heading` shows `Choose a conversation to have with your friends and practice English with them free.`
  - → `friend-courses-steps` is an `OL` with exactly two `LI` children, in order: `Complete the first mini lesson in under five minutes.` then `Share your special link with friends, family, and colleagues so that they can reply to you and continue the conversation.`
  - → the step text is ordinary body text (each `LI` is not a heading element)
  - → renders exactly two `friend-course-card` anchors in the given order
  - → card 0 href is `/course/friendchain/lesson/a`, card 1 href is `/course/wouldyourather/lesson/a`
  - → each card shows its course name and a lesson count
- `CourseListings` with `isLoading`
  - → `friend-courses-loading` is present and there are zero `friend-course-card`
  - → `friend-courses-heading` and `friend-courses-steps` are still present
- `CourseListings` with `isError`
  - → `friend-courses-error` is present (text from `home_courses_load_error`) and zero cards
  - → `friend-courses-heading` and `friend-courses-steps` are still present
- `CourseListings` with `courses = []`
  - → `friend-courses-empty` is present (text from `friend_courses_empty`) and zero cards
  - → `friend-courses-heading` and `friend-courses-steps` are still present
- `src/routes/routes.jsx` source inspected
  - → contains `{ path: '/courses', element: <CoursesRoute /> }`
  - → the `/courses` route index is less than the `/shareCode` route index (declared before the catch-all)
- `src/modules/user/guest-modal-logic.js` source inspected
  - → `PUBLIC_ROUTES` equals `['/', '/privacy', '/terms', '/confirm-email', '/courses']`
  - → `isPublicHomeRoute('/courses')`, `isPublicHomeRoute('/courses/')`, `isPublicHomeRoute('/Courses')` all return `true`
- `src/components/courses/CourseListingsContainer.jsx` source inspected
  - → contains `queryKey: ['friend-courses']`, `listFriendCourses(`, `loadConfigEntries(`, and `<CourseListings`
- `src/routes/CoursesRoute.jsx` source inspected
  - → contains `finishPreloader()` inside a mount `useEffect`

### Task 4 — Public profile friend-links area (`FriendLessonLinksSection.jsx`)

- active `friendLinks` (an entry inside 48h) + render
  - → `friend-lesson-links-heading` text is `Practice English with Me Free`
  - → `friend-lesson-links-subheading` text is `click on a lesson link to start.`
  - → one `friend-lesson-link-group-heading` per course whose text is the course name
  - → each course heading has an inline `fontSize` >= 24px
  - → a `UL` (`friend-lesson-link-list`) contains one `friend-lesson-link` anchor per entry, each anchor inside an `LI`
  - → each anchor `href` is `https://ultrafastfluency.com/course/<courseId>/lesson/<lessonId>?shareCode=<code>` (unchanged) and its inline `textDecoration` includes `underline`
  - → each entry renders its own `friend-lesson-link-countdown` matching `Available for …`
  - → the anchor label is the recorded lesson's English title, falling back to `profile_friend_lesson_link` when the title is empty
- `friendLinks` whose only entry is older than 48h + render
  - → `friend-lessons-expired` is present with `friend-lessons-expired-message`
  - → `friend-lesson-links`, `friend-lesson-link-group`, and `friend-lesson-link` are all absent
- `friendLinks = {}` (and `undefined`) + render
  - → the same `friend-lessons-expired` state is rendered
- `friend-lessons-practice-free` + render
  - → its `href` is `/courses`, its text is `Practice English Free`, and its inline `fontSize` >= 24px

### Task 5 — Strings (`src/data/strings.js`)

- each of the nine new keys imported from `strings.js`
  - → has a non-empty `en` value equal to the table above
  - → has non-empty `es`, `pt`, `fr`, `hi`, `bn` values
- `Strings.get('friend_courses_lesson_count', 'en', { count: 5 })`
  - → returns `5 lessons` (placeholder interpolation works)
- `Strings.get('profile_friend_practice_subheading', 'es')`
  - → returns the Spanish string, not the key and not the English fallback

### Task 6 — Update existing tests touched by the new behavior

- `src/components/profile/FriendLessonLinksSection.test.jsx`
  - → the two "renders nothing" cases become `friend-lessons-expired` assertions (no `friend-lesson-links`)
  - → the active-state assertions are updated for the header/subheading, the `UL`/`LI` structure, and the large course heading
- `tests/friend-lesson-link.spec.js`
  - → `removes the link once the 48h window has passed` asserts the expired message + `/courses` link instead of an empty profile
  - → `renders no section when there are no links` asserts the expired state
  - → the active-entry test still asserts the underlined link + countdown, and now also the header/subheading
- `src/modules/user/guest-modal-logic.test.js`
  - → the pinned `PUBLIC_ROUTES` expectation includes `'/courses'`
  - → `/courses`, `/courses/`, and `/Courses` are asserted `true`
- `tests/friend-courses.spec.js` (new)
  - → loading `http://localhost:5173/courses` shows the `friend-courses-heading`
  - → a card linking to `/course/wouldrather/lesson/a` and one to `/course/friendchain/lesson/a` are visible
  - → no card links to `test`, `model`, `t`, `gt2`, or `test-api`
  - → the guest login modal (`#guestLoginModal`) is not open on `/courses` (public route)

## Technical Context

No new runtime or dev dependencies are introduced. Relevant existing versions (from `package.json`): React `19.2.0`, react-router-dom `7.15.1`, @tanstack/react-query `5.100.14`, vite `8.0.10`, vitest `4.1.6`, @playwright/test `1.60.0`.

- `import.meta.glob('../../config/*.json')` is supported by the repo's Vite 8 build and by vitest 4 (verified locally: it enumerates all nine `src/config/*.json` files, and a lazy `await load()` returns `{ default: <config> }`). The `copy-config` Vite plugin still copies the JSONs to `dist/src/config/` for `AppLayout`'s runtime `fetch`; the glob chunks do not conflict with that.
- `AppLayout.jsx` fetches configs by **route param filename** (`/src/config/${courseId}.json`) and stores that same route `courseId`, so building listing URLs from the config file's basename is correct — including for `friend.json`/`test.json`, whose internal `courseId` is `"20260921"` (not a file name).
- The public route pattern is established in `README`/`AGENTS.md`: a new non-modal top-level route must be added to `PUBLIC_ROUTES` in `src/modules/user/guest-modal-logic.js` and declared before the single-segment `/:shareCode` catch-all in `routes.jsx`; both are source-guarded by tests.
- `src/modules/video/recorder-page.test.js` scans every file under `src/**` for a reference to the operator recorder page; the new files must not contain that token (they do not).

## Notes

- **Translations:** the nine new keys get en/es/pt/fr/hi/bn values matching the app's existing tone, built from the neighbouring `profile_friend_*` translations. English is authoritative; the non-English strings are drafted by the implementer and should be reviewed by a native speaker in a follow-up, exactly as other keys in `strings.js` are.
- **Courses-page heading wording:** the `/courses` page heading is the product-supplied sentence "Choose a conversation to have with your friends and practice English with them free." — it supersedes the earlier placeholder "Practice English Free" (there is one heading, not two). The numbered step 1 reads "Complete the first mini lesson in under five minutes."; the request said "MIDI lesson" and this is read as "mini lesson" (a sub-five-minute lesson). If "MIDI" was meant literally, change only `friend_courses_step_1`.
- **Why `friend` is listed but `test` is not:** the gate is "has a `shareCta` lesson", per the product decision. `friend.json` satisfies it and is included; `test.json` also satisfies it but is the designated never-user-visible test fixture and is excluded by `EXCLUDED_FRIEND_COURSE_IDS`. `model.json`/`t.json`/`gt2.json`/`test-api.json` have no `shareCta` lessons and are excluded by the gate.
- **Duplicate names:** `friend`, `friendchain`, and `wouldrather` all have `courseName: "Friend Challenge"`. Cards are keyed/ordered by `courseId`, so duplicates are rendered but remain distinct; no disambiguation is added.
- **`/courses` navigation is a full page load** (plain `<a href>`), which is acceptable for a public marketing-style page and keeps the presentational components Router-free for unit tests. The lesson links in the profile section were already external full-page anchors.
- The 48h expiry stays render-time only (nothing is deleted from `friend_links`); `groupActiveFriendLinks` already filters expired entries, so the new empty/expired branch triggers on the same clock the section already ticks.
- The expired message is shown for **any** zero-active-links profile (never-recorded or all-expired), per the product decision that a real profile has always recorded at least one lesson.
