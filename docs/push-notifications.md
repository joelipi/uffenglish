# Web push notifications

How a friend's answer reaches the asker's device as a real push, and how to
provision, verify and rotate it. Story: `stories/063-web-push-notifications`.

## Why there is a server component

Web Push is the open standard (RFC 8030 delivery, 8291 encryption, 8292 VAPID).
The **browser vendors deliver for free** — FCM (Chrome/Edge), Mozilla autopush
(Firefox), APNs (Safari/iOS) — so no OneSignal/Firebase account is needed and
nothing is broadcast. But a push must be encrypted to the recipient's
subscription keys and signed with this app's VAPID private key, and it must be
*sent* when `record_friend_response()` writes the notification row — a moment
when the recipient's app is normally **closed**. A browser cannot push to another
device, so one small server component exists: a Cloudflare Pages Function.

```
friend exports answer
  → record_friend_response()                       (005, SECURITY DEFINER)
      → upsert user_notifications row
          → trigger trg_user_notifications_push     (008)
              → net.http_post (pg_net)
                  → POST /api/push/send            (functions/api/push/send.js)
                      → x-push-webhook-secret check
                      → read push_subscriptions     (service-role key)
                      → encrypt + VAPID-sign per device
                          → FCM / autopush / APNs  (free)
                              → 404/410 deletes that subscription
```

Everything is fail-open: no Vault entries, no VAPID key, no subscription or a
dead endpoint each degrade to "in-app notification only". The trigger can never
break the notification write.

## Provisioned state

| Piece | Where | Value |
|---|---|---|
| `pg_net` | Supabase extension | `0.20.4` |
| `push_webhook_url` | Supabase Vault | `https://ultrafastfluency.com/api/push/send` |
| `push_webhook_secret` | Supabase Vault **and** the `PUSH_WEBHOOK_SECRET` Pages secret | 32 random bytes, base64url |
| `VAPID_PUBLIC_KEY` | `wrangler.toml` `[vars]` **and** `DEFAULT_VAPID_PUBLIC_KEY` in `src/modules/notifications/push-config.js` | committed (public) |
| `VAPID_PRIVATE_KEY` | Pages secret (production) | write-only |
| `VAPID_SUBJECT` | `wrangler.toml` `[vars]` + code default | `mailto:welcome@ultrafastfluency.com` |
| `SUPABASE_SERVICE_ROLE_KEY` | Pages secret (production) | write-only; also un-breaks `/api/welcome-email` |

Secrets are **per Pages environment**: only `production` was written. A `staging`
deploy fails open (no send).

## Provisioning from scratch

```bash
# 1. VAPID pair (public half → wrangler.toml [vars] + push-config.js;
#    private half → the Pages secret below). Rotate both together.
npx web-push generate-vapid-keys

# 2. Pages secrets (production)
npx wrangler pages secret put VAPID_PRIVATE_KEY      --project-name uffenglish
npx wrangler pages secret put PUSH_WEBHOOK_SECRET    --project-name uffenglish
npx wrangler pages secret put SUPABASE_SERVICE_ROLE_KEY --project-name uffenglish
npx wrangler pages secret list --project-name uffenglish   # names only

# 3. Supabase (Management API; never put the values on argv)
curl -s -X POST -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"create extension if not exists pg_net;"}' \
  "https://api.supabase.com/v1/projects/jbrbmbmupjfangqvaevx/database/query"

# 4. Vault entries (see the SQL at the bottom of this file)
```

```sql
-- 4. Vault: the trigger reads these; absent ⇒ the trigger is a silent no-op.
select vault.create_secret('https://ultrafastfluency.com/api/push/send',
                           'push_webhook_url', 'Web push sender endpoint');
select vault.create_secret('<the same value as PUSH_WEBHOOK_SECRET>',
                           'push_webhook_secret', 'Shared secret for the webhook');
```

## Verifying end to end

1. Open the installed app on a device, `/home` → menu → **Enable** notifications
   (or tap the post-install prompt). `Notification.permission` becomes `granted`
   and a row appears in `push_subscriptions` for that user.
2. Trigger a notification for that user: insert a `user_notifications` row (or
   have a friend export an answer), e.g.
   `insert into public.user_notifications (recipient_id, actor_id, type, payload)
    values ('<recipient uuid>', '<other uuid>', 'friend_response',
            '{"actorName":"Ada","actorShareCode":"ab12"}'::jsonb);`
3. The device shows the push; the sender's response is logged in
   `select * from net._http_response order by created_at desc limit 5;`
   (`status_code` 200, `content` `{"sent":1,...}`).
4. Pruning: a subscription whose push service returns `404`/`410` is deleted by
   the sender and counted in `pruned`.

## Rotating

- **Webhook secret** — write a new value to Vault **and** the
  `PUSH_WEBHOOK_SECRET` Pages secret. Both sides must change together; a mismatch
  makes every webhook 401 (visible as `401` in `net._http_response`).
- **VAPID pair** — update `wrangler.toml` `[vars]`, `DEFAULT_VAPID_PUBLIC_KEY`
  in `push-config.js`, and the `VAPID_PRIVATE_KEY` secret together. Existing
  subscriptions then fail signature validation and are pruned on the next
  `404`/`410`, so each device re-subscribes through the opt-in.
- The VAPID **private** key is write-only in Cloudflare. Keep a copy in a
  password manager if it needs to be retrievable; otherwise rotate.

## Opting out

There is no in-app unsubscribe control yet. A learner turns notifications off the
same way they would for any site (browser → site settings → Notifications →
Block), which also makes the browser drop the subscription; the sender then prunes
the dead row on the next `404`/`410`. The `push_subscriptions` delete policy
already allows an in-app control when one is added.

## Delivery limits and what actually throttles us

Platform caps do **not** protect a user from our own bug — they protect the
platform. For reference:

| Platform | Per-device limit | Notes |
|---|---|---|
| Android / Chrome (FCM) | 240/min and 5,000/hour; **collapsible** messages: burst of 20, refill 1 per 3 min | 4,096-byte payload; Google warns routine use near the ceiling "may be marked as abusive" |
| iOS / iPadOS (APNs) | no published cap for visible notifications | `userVisibleOnly` abuse **revokes the subscription** |
| Windows (WNS) | monthly quota by tier (`429`), plus `406` throttle | 5,000-byte payload; ≤1 routine update per 30 min guideline |

Two mechanisms in this feature do the real work, so keep them:

1. **Trigger cooldown.** `trg_user_notifications_push` only fires when the
   *previous* notification for that `(recipient, actor, type)` is at least
   **5 minutes** old (`new.created_at > old.created_at + interval '5 minutes'`).
   Without it, looping `record_friend_response()` emits one push per call. It is
   per row, so a different friend's answer pushes immediately. Tune the interval
   in `supabase/migrations/008_add_push_subscriptions.sql`.
2. **Collapse key.** The notification row's `id` is normalized to a ≤32-character
   key (`notificationCollapseKey`) and sent as the Web Push `Topic` header *and*
   the Notification `tag`. The topic makes the message collapsible on FCM (which
   is what opts into the 20-burst / 1-per-3-minutes throttle instead of the
   5,000/hour ceiling); the tag makes Android/Windows/macOS replace the previous
   notification rather than stack it.

If you raise the cooldown or drop the collapse key, the failure mode is a
notification storm on a victim's devices — there is no platform backstop.

## Limits and behaviour worth knowing

- Push is **per device**: a user with a phone and a laptop gets both. The sender
  reads at most `MAX_SUBSCRIPTIONS_PER_SEND` (20) per notification.
- Only `friend_response` is pushed (`PUSH_NOTIFICATION_TYPES`); an unknown type
  is skipped rather than guessed.
- Copy is composed in the **recipient's** stored language, with the guest modal's
  `OTHER` sentinel (and anything unknown) normalized to English.
- The tap target is the actor's public profile `/<shareCode>`, falling back to
  `/home` when the payload's share code does not look like one.
- iOS/iPadOS 16.4+ only delivers to a Home Screen web app, and the permission
  request must follow a user tap (`webkit.org/blog/13878`) — that is why the
  opt-in is a button and never fires on its own.
- The service worker gets its push listeners from `public/push-sw.js` via
  `workbox.importScripts` (see `vite.config.js`), so the generated precache and
  navigation deny list from story 062 stay generated config.
