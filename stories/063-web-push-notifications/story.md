# Web push notifications mirroring the in-app inbox

## Context

Story 019/005 gives the app an in-app notification inbox: when a friend exports
their answer video, `record_friend_response()` (SECURITY DEFINER,
`supabase/migrations/005_add_user_notifications.sql`) upserts a
`user_notifications` row for the asker, and the asker's device shows it in the
bell menu (`src/modules/api/api.js:360-400`, `NotificationsBell.web.jsx`). The
row is written **server-side** — clients have no insert grant — at a moment when
the asker's app is almost always **closed**.

The request: when an in-app notification is created, also deliver a **web push**
to the recipient's devices, so the friend's response reaches them like a native
app notification; and, as a follow-up to the install flow from story 062, ask
for notification permission **once the PWA is installed**.

### Why a server-side sender is unavoidable

Web Push is a W3C/RFC standard (RFC 8030 delivery, 8291 encryption, 8292 VAPID).
The **browser vendor's push service delivers for free** — FCM (Chrome/Edge),
Mozilla autopush (Firefox), APNs (Safari/iOS) — so no OneSignal/Firebase account
is needed and nothing is broadcast. But a push message must be encrypted to the
recipient's subscription keys and signed with the app's VAPID private key, and it
must be *sent* at the instant the row is created — while the recipient's app is
closed. A browser cannot send a push to another device, so **some server-side
component is required**. It can be tiny, free, and inside the stack already in
use:

- **Sender:** a Cloudflare Pages Function (`functions/api/push/send.js`) — the
  repo's existing Function pattern (`functions/api/welcome-email.js`) with the
  same fail-open discipline, free tier (100k requests/day), secrets in the Pages
  dashboard.
- **Sender library:** `@block65/webcrypto-web-push` (MIT) — the Web Push protocol
  on Web Crypto, explicitly runtime-agnostic (Node, **Cloudflare Workers**,
  Bun, Deno); the popular `web-push` package needs Node `crypto.createECDH` and
  will not run on workerd.
- **Trigger:** a Supabase **Database Webhook** — a `pg_net` trigger calling
  `supabase_functions.http_request(...)` on `user_notifications` — so the push
  fires from the same transaction that creates the row, with no client
  involvement and no cron.

### iOS/iPadOS constraint (source: `webkit.org/blog/13878`)

Web Push on iOS/iPadOS 16.4+ works **only for a Home Screen web app** (manifest
`display: standalone`, which story 062 already sets, plus a manifest `id`, also
already set), and the permission request **must be in response to direct user
interaction** — a tap on a "subscribe" button. macOS Safari 16.1+ is the same
API. So "ask immediately after install" can only mean: after install, show an
in-app prompt whose **button** triggers `Notification.requestPermission()` →
`pushManager.subscribe()`. It must never be fired automatically (browsers
suppress a non-gesture prompt, and iOS rejects it outright).

## Out of Scope

- Broadcast/marketing push, segmentation, scheduled sends, A/B, digest emails.
- Any third-party push SaaS (OneSignal, Firebase, Pusher) — the standard +
  vendor push endpoints cover this case for free.
- Push on the React Native build, and `Badging API` counts.
- Rich push (images, action buttons, per-notification deep-link payloads beyond a
  single `url`), and notification grouping/collapse tags beyond the dedupe key.
- Delivery guarantees, retries, or a send queue: a push is best-effort and its
  failure must never affect the in-app notification (which remains the source of
  truth).
- Push-triggered background sync or data refresh.
- Changing the in-app inbox behaviour, the dedupe key, or the notification row
  shape.

## Implementation approach

### Decisions

- **The trigger is a Database Webhook, not a client call.** The row is created
  inside `record_friend_response()`, so the push must be triggered by the row
  write (a trigger is the only place that sees it), and it fires even when no
  client is connected. The trigger is created in SQL (`supabase_functions.http_request`)
  but **reads its URL and secret from a Postgres setting**
  (`current_setting('app.push_webhook_url', true)` / `'app.push_webhook_secret'`)
  and **returns early when unset** — so merging this migration puts nothing on the
  wire until the runbook steps in Notes are done, and can never hammer a
  half-configured endpoint.
- **The webhook fires on INSERT *and* UPDATE.** The dedupe index makes a
  re-answer an `ON CONFLICT DO UPDATE` that refreshes `created_at` and clears
  `read_at`, so an `AFTER INSERT OR UPDATE` trigger is what actually mirrors
  "you have a new response" — an insert-only trigger would silently drop every
  re-answer.
- **The Function authenticates with a shared secret, not a user JWT.** The caller
  is Postgres via `pg_net`, which has no user session. `functions/api/push/send.js`
  requires `x-push-webhook-secret` to equal the `PUSH_WEBHOOK_SECRET` secret and
  returns `401` otherwise (constant-time compare), mirroring the
  `x-operator-key` pattern in `functions/api/pipeline/*`.
- **Subscriptions live in their own table with owner-only RLS.**
  `push_subscriptions` (migration 008) holds one row per device endpoint. The app
  may `select`/`insert`/`delete` only its own rows (so a client can register and
  unregister its own device), and the sender reads across users with the
  service-role key — the same split as `welcome-email.js`, which mints email
  tokens with the service-role key.
- **The service worker keeps `generateSW` + `workbox.importScripts`.** Story 062
  shipped a reviewed `generateSW` config (precache patterns, SPA `navigateFallback`
  and its deny list) that must not be re-implemented by hand. `workbox.importScripts:
  ['push-sw.js']` (supported by `workbox-build`'s `GenerateSWOptions`, verified in
  `node_modules/workbox-build/build/types.d.ts:230`) prepends a `public/push-sw.js`
  that adds only `push`, `notificationclick` and `pushsubscriptionchange`
  listeners. `injectManifest` would give a "cleaner" single file but would move
  the precache manifest, the navigation fallback and its deny list into code —
  re-opening everything story 062's reviewers closed.
- **Permission UX: one prompt after install, plus a permanent menu entry.** The
  `appinstalled` event (Chromium/Android/desktop) and the first launch in
  `display-mode: standalone` (iOS, which has no `appinstalled` event) both mark
  "just installed"; the app then shows an in-app prompt whose button is the
  gesture that requests permission and subscribes. The `/home` menu gains a
  "Turn on notifications" entry (reusing story 062's menu pattern) so a
  dismissed prompt is recoverable, and desktop users can opt in without
  installing. Hidden entirely when: `Notification`/`PushManager` are missing,
  the build has no VAPID public key, permission is `denied`, or the device is
  already subscribed.
- **Push copy comes from the page's own language.** The `push` handler reads
  `data.title`/`data.body` from the payload, which the sender composes from the
  **recipient's stored language** so the notification matches the app language
  rather than the actor's. The three strings go through `strings.js` (en/es/pt/fr/hi/bn,
  `hi`/`bn` script-checked by the existing contract).
- **Everything is fail-open.** No VAPID key, no subscription table, a dead
  endpoint, a `410 Gone` — each degrades to "in-app notification only" and never
  surfaces an error to the user or to `record_friend_response()`. `pg_net` is
  asynchronous, so a slow or failed send cannot block the insert.

### Data flow

```
friend exports answer
  → record_friend_response()                       (SECURITY DEFINER, already exists)
      → upsert user_notifications row
          → AFTER INSERT OR UPDATE trigger (008)
              → supabase_functions.http_request(read_setting('app.push_webhook_url'), ...)
                  → POST /api/push/send   {type, table, record:{...}}   x-push-webhook-secret
                      → verify secret
                      → read push_subscriptions for record.recipient_id   (service-role)
                      → for each: webcrypto-web-push send  → FCM/autopush/APNs (free)
                          → 404/410 → delete that subscription
```

## Tasks

### Task 1 - `push_subscriptions` migration (008)

- the migration SQL (static guard, per `notifications-migration.test.js`)
  - → creates `public.push_subscriptions` with `user_id`, `endpoint`, `p256dh`, `auth`, `user_agent`, `created_at`
  - → has a unique constraint on `endpoint` (one row per device, re-subscribe is an upsert)
  - → enables RLS and grants `select`/`insert`/`delete` to `authenticated` only
  - → every policy is owner-scoped (`auth.uid() = user_id`) for select, insert and delete
  - → indexes `user_id` for the sender's lookup
  - → does **not** grant `update` and does **not** grant anything to `anon`

### Task 2 - Sender Function `functions/api/push/send.js`

- a request without the correct `x-push-webhook-secret`
  - → `401` and no outbound push request
- a request with the secret but no `record.recipient_id`
  - → `200 { sent: 0 }` (nothing to do, never a 500)
- a valid notification for a recipient with two subscriptions, both healthy
  - → one push per subscription, `200 { sent: 2, pruned: 0 }`
- a subscription whose send returns 404/410
  - → that row is deleted and counted in `pruned`
- a subscription whose send throws (network error)
  - → recorded as failed, the other subscriptions still send, response stays `200`
- the VAPID private key env is missing
  - → `200 { sent: 0, reason }` — fail-open, never a 500
- (guard) the Function source
  - → uses the service-role key, never the anon key, and never logs the secret or the subscription keys

### Task 3 - Database webhook trigger

- the trigger migration SQL (static guard)
  - → creates an `AFTER INSERT OR UPDATE` trigger on `public.user_notifications`
  - → calls `supabase_functions.http_request`
  - → reads the URL and secret from `current_setting(...)` with `missing_ok`
  - → returns/does nothing when the settings are unset
  - → never raises on the notification path (an exception here would break the friend-response flow)

### Task 4 - Service worker push handlers

- `public/push-sw.js` present and wired via `workbox.importScripts`
  - → `vite.config.js` passes `importScripts: ['push-sw.js']`
  - → the built `dist/sw.js` contains the `importScripts` call
- the handler source (static guard: it is worker JS, so behaviour is asserted by source)
  - → registers a `push` listener, parses `event.data.json()`, and calls `showNotification` with title/body/icon/`data.url`
  - → a malformed/absent payload still shows a notification (never a silent drop)
  - → registers a `notificationclick` listener that focuses an existing client whose URL matches `data.url`, else `openWindow(data.url)`
  - → `notificationclick` closes the notification
  - → registers `pushsubscriptionchange` and re-subscribes + re-registers the new endpoint

### Task 5 - Client: subscribe + post-install permission prompt

- pure logic (`src/modules/notifications/push-logic.js`, no React/DOM/window)
  - → `shouldOfferPushNotifications({ supported, hasPublicKey, permission, isSubscribed })` is false for any unsupported/denied/already-subscribed input, true only when all are satisfied
  - → `hasJustInstalled({ previousStandalone, isStandalone })` is true only on the false→true transition
  - → `buildPushNotificationPayload(...)` (or the sender-side equivalent) maps a `user_notifications` row to `{title, body, url}` and falls back to English for an unknown language
  - → `urlForNotification(row)` → the actor's public profile `/<actorShareCode>` (the inbox link), never an untrusted absolute URL
- web-only subscribe module (`src/modules/notifications/push-subscription-webonly.js`)
  - → `subscribeToPush()` returns `{ ok: false, reason }` (never throws) when: `Notification` undefined, `serviceWorker` undefined, no public key, permission denied, or `pushManager.subscribe` rejects
  - → on success it POSTs the subscription to `/api/push/subscribe` (or inserts into Supabase) once
  - → `urlBase64ToUint8Array` round-trips a VAPID key correctly (unit-tested against a fixed vector)
- the UI
  - → the `/home` menu shows a "Turn on notifications" entry only when `shouldOfferPushNotifications` is true
  - → clicking it requests permission and subscribes, then the entry disappears
  - → after `appinstalled` (or the first standalone launch) the app shows the prompt **once**, and never again in the same install
  - → the prompt is dismissible and its dismissal is remembered
  - → no permission request happens without a user tap (asserted by a source guard that `requestPermission` is only called from a click handler)
- copy
  - → new `strings.js` keys carry en/es/pt/fr/hi/bn with real Devanagari/Bengali

### Task 6 - Provisioning runbook + fail-open wiring

- `wrangler.toml`
  - → `[vars]` carries the non-secret `VAPID_PUBLIC_KEY` (per the repo rule that non-secret Pages vars must be in `[vars]`); the private key and webhook secret stay dashboard secrets
- the runbook (story Notes / `docs/`)
  - → documents generating the VAPID pair, setting `VAPID_PRIVATE_KEY` + `PUSH_WEBHOOK_SECRET`, enabling `pg_net`, and setting the two Postgres settings
- fail-open
  - → with no VAPID public key the notification UI is absent and no subscription is attempted
  - → the app builds and every existing test passes with push entirely unconfigured

## Bootstrap

```bash
npm install @block65/webcrypto-web-push@2.0.0
npx web-push generate-vapid-keys   # prints the VAPID public/private pair
```

## Technical Context

- `@block65/webcrypto-web-push` 2.0.0 — MIT, Web Push (RFC 8291) on Web Crypto;
  the package description states it works with NodeJS, **Cloudflare Workers**,
  Bun and Deno, so it runs in a Pages Function (the Node-only `web-push` does not).
- Supabase Database Webhooks are `pg_net` triggers: `create trigger ... execute
  function supabase_functions.http_request(url, 'POST', headers, body, timeout)`
  (supabase.com/docs/guides/database/webhooks). `pg_net` is asynchronous, so
  failures are logged in the `net` schema and never block the insert.
- iOS/iPadOS 16.4+ Web Push requires a Home Screen web app and a user-gesture
  permission request; no Apple Developer Program membership is needed
  (webkit.org/blog/13878).

## Notes

- **This feature is inert until the runbook is run.** Merging the migrations must
  not change production behaviour on its own: the trigger skips when its Postgres
  settings are unset, and the client hides the notification UI when no VAPID
  public key is configured.
- **Runbook (manual, one-time):**
  1. `npx web-push generate-vapid-keys` → keep the pair.
  2. Cloudflare Pages dashboard → add secrets `VAPID_PRIVATE_KEY` and
     `PUSH_WEBHOOK_SECRET`; add `VAPID_PUBLIC_KEY` to `wrangler.toml` `[vars]`.
  3. Supabase → `create extension if not exists pg_net;` (and confirm the
     `supabase_functions` schema exists).
  4. `alter database postgres set app.push_webhook_url = 'https://ultrafastfluency.com/api/push/send';`
     and `... set app.push_webhook_secret = '<the secret>';`
  5. Verify end-to-end by inserting a `user_notifications` row for a subscribed
     device and checking `select * from net._http_response order by created desc limit 5;`.
- **Per-device, not per-user:** a user may have many subscriptions (phone, laptop).
  All are pushed; deleting a device happens via `410` pruning or the owner's own
  delete.
- **Language:** the sender composes copy in the recipient's `native_language`
  (guest-first `guestNativeLanguage || userData?.native_language || 'en'`), which
  means the Function reads that column; an unknown/`OTHER` sentinel must normalize
  to English (per the AGENTS.md guest-language rule).
