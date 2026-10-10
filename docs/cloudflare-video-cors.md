# Cloudflare COOP/COEP + R2 CORS (video / Whisper / cross-origin media)

The app needs **cross-origin isolation** (`crossOriginIsolated`) for
`SharedArrayBuffer`, which Whisper's WASM threads require. Isolation needs
`Cross-Origin-Opener-Policy: same-origin` **and** a `Cross-Origin-Embedder-Policy`.
Lesson videos and Whisper live on `r2.ultrafastfluency.com`, so that host must
also allow cross-origin reads, including `206` range responses.

If a `<video>` shows `MEDIA_ELEMENT_ERROR: Format error` or
`No 'Access-Control-Allow-Origin'`, or Whisper fails with `TypeError: Load failed`
on `s.ultrafastfluency.com` (but works on localhost), it is this config — not the
app.

## Live config

- Zone `ultrafastfluency.com` = `b5d762c9813089eb4d82598693762aaa`
- Account = `1cbff202eaecae074585be8e7ac45b2e`
- Phase: `http_response_headers_transform` (dashboard: Rules → Transform Rules →
  Modify Response Header). Three rules:

1. **Cross-origin isolation, non-`s.`/non-`r2` hosts**
   `Cross-Origin-Embedder-Policy: credentialless`,
   `Cross-Origin-Opener-Policy: same-origin`.
   Expression: `(not (http.host eq "s.ultrafastfluency.com" or http.host eq "r2.ultrafastfluency.com"))`
2. **`s.` host** — `credentialless` + `COOP same-origin`.
   Expression: `(http.host eq "s.ultrafastfluency.com")`
3. **R2 media paths** — `Access-Control-Allow-Origin: *` +
   `Cross-Origin-Resource-Policy: cross-origin`, matched on
   `/assets/videos/`, `/assets/posters/`, `/whisper/` and UGC `/videos/`.
   Expression: `(http.host eq "r2.ultrafastfluency.com" and (http.request.uri.path contains "/assets/videos/" or http.request.uri.path contains "/assets/posters/" or http.request.uri.path contains "/whisper/" or http.request.uri.path contains "/videos/"))`

All Pages hosts therefore serve `credentialless`, matching `public/_headers`
(copied into `dist/`). `credentialless` keeps the page cross-origin isolated but
lets it load cross-origin resources that do not send
`Cross-Origin-Resource-Policy`: R2 media gets CORP via rule 3, and Supabase
Storage (avatars) allows CORS via `access-control-allow-origin: *`.

Read the rules:

```bash
Z=b5d762c9813089eb4d82598693762aaa
curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/$Z/rulesets/phases/http_response_headers_transform/entrypoint"
```

Writing a rule needs zone **Transform Rules** (Config Rules) *Edit*; `CF_TOKEN`
on this machine is read-only for rulesets, so the edit in the history below was
applied with the account token (`Account API Tokens Write`).

## History: why every Pages host is `credentialless`

Rule 1 originally set `require-corp` for non-`s.` hosts. That overrode the Pages
`public/_headers` (which says `credentialless`) on the apex, so production served
`require-corp` while staging served `credentialless`. Under `require-corp` a
cross-origin `<img>` without a `Cross-Origin-Resource-Policy` is blocked, and
Supabase Storage sends no CORP — so user avatars (posters copied into the
Supabase `avatars` bucket) rendered as broken images:

```
net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep
```

Rule 1 now sets `credentialless`, matching `_headers` and staging. The app also
loads remote avatars as CORS (`crossOrigin="anonymous"`), so it works under
either mode; that contract is pinned by `src/components/avatar-cors.test.js`.

## Verify

```bash
# Every Pages host should report credentialless + same-origin.
curl -sI "https://ultrafastfluency.com/?cb=$RANDOM" | grep -i cross-origin

# R2 range responses must keep ACAO (206-safe), or <video> is blocked.
curl -sI -H "Range: bytes=0-1023" \
  https://r2.ultrafastfluency.com/assets/videos/<slug>.mp4 \
  | grep -iE "access-control-allow-origin|cross-origin-resource-policy"
```

In a real browser (bundled Chromium lacks H.264/AAC), load the app and confirm
`crossOriginIsolated === true` and that videos/Whisper load. Remember a plain
`curl -I` of an R2 video returns `200` even when the `206` path is broken — send
the `Range` header.
