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
  client is connected. It calls `net.http_post` directly rather than
  `supabase_functions.http_request` — that schema does not exist on this project
  (only Dashboard-created webhooks make it), so the migration stays
  self-contained. It **reads its URL and secret from Supabase Vault**
  (`vault.decrypted_secrets`, names `push_webhook_url` / `push_webhook_secret`)
  and **returns early when unset** (and when `pg_net` is absent) — so merging the
  migration puts nothing on the wire on its own and can never hammer a
  half-configured endpoint. Vault, not a Postgres GUC: a custom `app.*` setting is
  readable by any role that can execute `current_setting()`, while
  `vault.decrypted_secrets` is restricted to the owning role (the trigger
  function is SECURITY DEFINER and nobody else is granted EXECUTE).
- **The webhook fires on INSERT *and* on the re-answer UPDATE — but not on
  mark-as-read.** The dedupe index makes a re-answer an `ON CONFLICT DO UPDATE`
  that refreshes `created_at` and clears `read_at`, so an insert-only trigger
  would silently drop every re-answer; but a plain `AFTER INSERT OR UPDATE` also
  fires when the recipient marks a row read, which would push an *old*
  notification. The trigger therefore carries
  `when (tg_op = 'INSERT' or new.created_at is distinct from old.created_at)`.
- **The Function authenticates with a shared secret, not a user JWT.** The caller
  is Postgres via `pg_net`, which has no user session. `functions/api/push/send.js`
  requires `x-push-webhook-secret` to equal the `PUSH_WEBHOOK_SECRET` secret and
  returns `401` otherwise (constant-time compare), mirroring the
  `x-operator-key` pattern in `functions/api/pipeline/*`.
- **Subscriptions live in their own table with owner-only RLS.**
  `push_subscriptions` (migration 008) holds one row per device endpoint, unique
  per `(user_id, endpoint)` so a shared device can host two signed-in users. The
  app may `select`/`insert`/`delete` only its own rows and is granted **no UPDATE
  at all**: a re-subscribe deletes and re-inserts the owner's row (which also
  covers the browser rotating the keys for the same endpoint), keeping the
  privileged surface to exactly "own your devices". The sender reads across users
  with the service-role key — the same split as `welcome-email.js`.
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
- a request with the secret but no `record.recipient_id` / a malformed body
  - → `200 { sent: 0, reason: 'no-recipient' }` / `{ sent: 0, reason: 'bad-json' }` (nothing to do, never a 500)
- a recipient with no device subscriptions, or an unpushable notification type
  - → `200 { sent: 0, pruned: 0, failed: 0, reason: 'no-subscriptions' }` / `'unsupported-type'`, and no outbound push request
- a valid notification for a recipient with two subscriptions, both healthy
  - → one push per subscription, `200 { sent: 2, pruned: 0 }`
- a subscription whose send returns 404/410
  - → that row is deleted and counted in `pruned`
- a subscription whose send throws (network error)
  - → recorded as failed, the other subscriptions still send, response stays `200`
- the VAPID private key env is missing
  - → `200 { sent: 0, reason }` — fail-open, never a 500
- a missing `PUSH_WEBHOOK_SECRET` (our misconfiguration, not the caller's)
  - → `500` so it is visible in logs (the only non-200 besides a `401`)
- (guard) the Function source
  - → uses the `SUPABASE_SERVICE_ROLE_KEY` and never the anon key
  - → compares the webhook secret with `timingSafeEqual` and never logs the secret, `p256dh` or `auth`
  - → prunes by the subscription id the lookup returned (`push_subscriptions?id=eq.…`)

### Task 3 - Database webhook trigger

- the trigger migration SQL (static guard)
  - → creates an `AFTER INSERT OR UPDATE` trigger on `public.user_notifications`
  - → carries `when (tg_op = 'INSERT' or new.created_at is distinct from old.created_at)` so the recipient marking a row **read** never pushes an old notification
  - → calls `net.http_post` with **named** arguments (`url :=`/`body :=`/`headers :=`/`timeout_milliseconds :=`) — the positional signature is `(url, body, params, headers, timeout)`, so a positional call would put headers into `params`
  - → reads the URL and secret from `vault.decrypted_secrets` (not `current_setting`/`supabase_functions`, neither of which is available/appropriate here — see Decisions)
  - → does nothing when the Vault entries are unset or `pg_net` is absent (`to_regprocedure` guard)
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
  - → registers `pushsubscriptionchange` and posts `push-subscription-changed` to open windows; the worker never calls `subscribe` and carries no VAPID key (it has no session), so the app re-registers the endpoint on launch (`syncExistingSubscription`)

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
  - → `[vars]` carries the non-secret `VAPID_PUBLIC_KEY` and `VAPID_SUBJECT` (per the repo rule that non-secret Pages vars must be in `[vars]`); neither the private key nor the webhook secret appears in the repo
  - → the `[vars]` public key equals the committed `DEFAULT_VAPID_PUBLIC_KEY` (a drift guard, since a mismatch means every send fails)
- the runbook at `docs/push-notifications.md`
  - → documents generating the VAPID pair, the three Pages secrets (`VAPID_PRIVATE_KEY`, `PUSH_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`), enabling `pg_net`, the two Vault entries, the `net._http_response` verification and how to rotate
- fail-open
  - → with no VAPID public key the notification UI is absent and no subscription is attempted
  - → the app builds and every existing test passes with push entirely unconfigured

## Bootstrap

```bash
npm install @block65/webcrypto-web-push@2.0.0
npx web-push generate-vapid-keys   # prints the VAPID public/private pair
```

Provisioning is done and documented in `docs/push-notifications.md` (pg_net, two
Vault secrets, three Pages secrets, `wrangler.toml` `[vars]`).

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

- **This feature is inert until configured.** Merging the migrations alone
  changes no behaviour: the trigger skips when Vault holds no webhook URL (or
  `pg_net` is absent), and the client hides the opt-in when no VAPID key is set.
- **Provisioned for this story (done, out-of-band — no secret is in the repo):**
  - `pg_net` 0.20.4 installed (`create extension if not exists pg_net`).
  - Vault holds `push_webhook_url` = `https://ultrafastfluency.com/api/push/send`
    and `push_webhook_secret` (32 random bytes, base64url).
  - Cloudflare Pages (production) secrets: `VAPID_PRIVATE_KEY`,
    `PUSH_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`.
  - `SUPABASE_SERVICE_ROLE_KEY` was previously unset in production, which also
    meant the existing `/api/welcome-email` always returned
    `{sent:false, reason:'store-not-configured'}`; setting it fixes that too.
  - The VAPID keypair's **public** half is committed as the default in
    `src/modules/notifications/push-config.js`; the private half exists only as
    the Pages secret.
- **Secret hygiene:** the first `push_webhook_secret` value was echoed by a tool
  error message while being written to Vault, so it was **rotated** — a fresh
  value was written to both Cloudflare and Vault, and the exposed one was never
  stored anywhere. Rotating again is a two-step: new value into Vault
  (`vault.update_secret`/`create_secret`) and the same value into the
  `PUSH_WEBHOOK_SECRET` Pages secret.
- **Rotating VAPID:** replacing the pair means updating both the committed public
  key and the `VAPID_PRIVATE_KEY` secret *together*; every existing subscription
  then fails (the push service rejects the mismatched signature) and is pruned on
  the next `404`/`410`, so clients re-subscribe via the opt-in.
- **Staging is not configured.** Pages secrets were written to the *production*
  environment only; a `staging` deploy would fail-open (no
  `PUSH_WEBHOOK_SECRET`/`VAPID_PRIVATE_KEY`) and simply not send.
- **Per-device, not per-user:** a user may have many subscriptions (phone,
  laptop); all are pushed up to `MAX_SUBSCRIPTIONS_PER_SEND`, and pruning happens
  on `404`/`410` or when the owner deletes the row.
- **Language:** the sender composes copy in the recipient's stored
  `native_language`, normalizing the guest modal's `OTHER` sentinel (and anything
  unknown) to English, per the AGENTS.md guest-language rule.
- **Hardening from review:** the sender refuses to fetch any endpoint that is not
  `https:` (`isAllowedPushEndpoint`). An endpoint is attacker-controlled input —
  any authenticated user may register an arbitrary URL on their own row — so
  without it a row could turn the Function into an outbound request to an
  internal/`http:` URL (the impact was already self-directed: the lookup is
  scoped by recipient and the request carries only VAPID headers, never the
  service-role key). The trigger also skips when the shared secret is missing, not
  just when the URL is, so a half-configured deploy never spends a round trip to
  earn a `401`.
- **Known follow-up (not fixed here): push amplifies a pre-existing spam vector.**
  `record_friend_response()` (005) has no rate limit, and the dedupe upsert
  refreshes `created_at`, so the trigger re-fires on every re-answer: a caller who
  loops the RPC can emit one OS-level push per call to the victim's devices.
  `MAX_SUBSCRIPTIONS_PER_SEND` and `PUSH_TTL_SECONDS` bound the fan-out, not the
  frequency. A trigger-side debounce (e.g. skip when
  `old.created_at > now() - interval '5 minutes'`) or a per-recipient throttle in
  the sender is the fix; it is deliberately left as its own change because it
  alters product behaviour (a legitimate rapid re-answer would go quiet).
- **The Function test runs in the `node` environment, not jsdom.** The Web Push
  library does a cross-realm `instanceof ArrayBuffer` check on what
  `crypto.subtle` returns; under jsdom that value belongs to jsdom's realm, so the
  check fails and every send reports `Unsupported value, got \`object\``. That is
  a test-environment artifact — workerd and browsers have a single realm — and
  the file carries a `// @vitest-environment node` docblock explaining it.
