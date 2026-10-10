# Deploy environments: production (`ultrafastfluency.com`) vs staging (`s.`)

How the single Cloudflare Pages project `uffenglish` serves several custom
domains from two deployments: `ultrafastfluency.com` (and `www.`) for
**production** and `s.ultrafastfluency.com` for **staging**.
`go.ultrafastfluency.com` is a production alias and is left in place.

Cloudflare reference: [Add a custom domain to a branch](https://developers.cloudflare.com/pages/how-to/custom-branch-aliases/).

## Current layout

| URL | Serves | Notes |
|---|---|---|
| `ultrafastfluency.com` (apex) | production (`main`) | proxied CNAME → `uffenglish.pages.dev` |
| `www.ultrafastfluency.com` | production (`main`) | proxied CNAME → apex |
| `go.ultrafastfluency.com` | production (`main`) | production alias, kept |
| `s.ultrafastfluency.com` | staging (`staging` branch) | proxied CNAME → `staging.uffenglish.pages.dev` |
| `uffenglish.pages.dev` | production (`main`) | Pages default alias |
| `staging.uffenglish.pages.dev` | `staging` branch | created by `deploy-staging.yml` |

All four custom domains are registered on the Pages project
(Workers & Pages → **uffenglish** → **Custom domains**) and show
`status: active`.

## The mechanism

A Cloudflare Pages project deploys:

- the **production branch** (here `main`) to the root alias
  `uffenglish.pages.dev`, which all "normal" custom domains serve; and
- every **other branch** to a stable preview alias
  `<branch>.uffenglish.pages.dev` (branch name lowercased, non-alphanumerics → `-`).

To make a custom domain serve a *branch* instead of production, add the custom
domain normally and then set its DNS record's target to the branch alias, e.g.
`uffenglish.pages.dev` → `staging.uffenglish.pages.dev`.

**Hard requirement:** it only works with a **proxied** Cloudflare DNS record (the
domain must be a zone on the same account). An unproxied record, or an external
DNS provider, silently falls back to the production branch.

## Why the apex used to 522

`ultrafastfluency.com` was registered as a Pages custom domain but its DNS was a
stale **A record pointing at the original IONOS origin** (`34.139.137.66`), not
Pages. Cloudflare reached the edge but the origin did not answer, so the apex
returned **HTTP 522** and the only working hostnames were `s.` and `go.`. The
fix is to delete that A record and create a proxied CNAME to
`uffenglish.pages.dev` (apex records are CNAME-flattened automatically). The MX
and SPF (`TXT`) records at the apex are unrelated and must be left alone.

## Procedure

The Pages **custom-domain** API needs the `Pages Write` scope; the DNS edit needs
the zone `DNS Write` scope. A single token with both is ideal. The `CF_TOKEN`
used on this machine has `Pages Write` but only **zone DNS Read**, so the DNS
record had to be written with a purpose-made token (see "Token scopes" below).

1. **Add the custom domains** to the Pages project (idempotent; an already-present
   domain returns it unchanged):

   ```bash
   ACC=1cbff202eaecae074585be8e7ac45b2e
   for d in ultrafastfluency.com www.ultrafastfluency.com; do
     curl -s -X POST \
       -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
       -H "Content-Type: application/json" \
       -d "{\"name\":\"$d\"}" \
       "https://api.cloudflare.com/client/v4/accounts/$ACC/pages/projects/uffenglish/domains"
   done
   ```

   Adding a domain via the API does **not** create the DNS record for you (the
   dashboard does), so step 2 is still required.

2. **Point DNS at Pages** (zone `ultrafastfluency.com`,
   `Z=b5d762c9813089eb4d82598693762aaa`). Delete any conflicting A/AAAA/CNAME at
   the apex and create:

   ```bash
   curl -s -X POST \
     -H "Authorization: Bearer $DNS_WRITE_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"type":"CNAME","name":"ultrafastfluency.com","content":"uffenglish.pages.dev","proxied":true,"ttl":1}' \
     "https://api.cloudflare.com/client/v4/zones/$Z/dns_records"
   ```

   `www` already CNAMEs to the apex, so it follows automatically.

3. **Verify** `https://ultrafastfluency.com/` and `https://www.ultrafastfluency.com/`
   return `200`, and the Pages custom domains report `status: active`.

## Staging

`.github/workflows/deploy-staging.yml` deploys every push to the `staging`
branch as `staging.uffenglish.pages.dev`. Production is unaffected. Two ways to
run it:

- **Branch flow (a real gate):** feature branch → merge into `staging` → verify
  on `s.` → merge `staging` into `main` → production. This asks the team to stop
  committing straight to `main`.
- **Mirror flow (no workflow change):** keep committing to `main`; when you want
  a smoke test, `git push origin main:staging` and check `s.`. Staging then equals
  production, so it is a verification surface, not a holdback.

Seed/refresh the branch alias at any time:

```bash
git push origin main:staging     # mirror flow; the workflow redeploys staging
```

Once the first `staging` deployment has succeeded, edit the `s.` DNS record's
target to `staging.uffenglish.pages.dev` (keep it proxied). Pointing `s.` at the
branch alias before that first deployment exists would 404.

## Token scopes

- **Pages Write** — add/remove custom domains on the project.
- **Zone DNS Write** — create/replace the DNS records. `CF_TOKEN` lacks this (it
  has zone **DNS Read** only), but it does have **Account API Tokens Write**, so
  a short-lived token can be minted for the edit and then revoked. An
  account-owned token scopes zone permissions through the account resource
  (`com.cloudflare.api.account.<ACC>` = every zone in the account):

  ```bash
  ACC=1cbff202eaecae074585be8e7ac45b2e
  curl -s -X POST -H "Authorization: Bearer $CF_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"uff-dns-tmp","policies":[{"effect":"allow",
         "resources":{"com.cloudflare.api.account.'"$ACC"'":"*"},
         "permission_groups":[
           {"id":"4755a26eedb94da69e1066d98aa820be"},
           {"id":"c8fed203ed3043cba015a93ad1616f1f"}]}]}' \
    "https://api.cloudflare.com/client/v4/accounts/$ACC/tokens"
  ```

  (`4755a26eedb94da69e1066d98aa820be` = **DNS Write**,
  `c8fed203ed3043cba015a93ad1616f1f` = **Zone Read**.) The response's `value` is
  returned once — the only time it is shown. Delete the token afterwards
  (`DELETE /accounts/$ACC/tokens/<id>`); the one minted for the apex fix was
  revoked immediately after use.

## AI proxy allow-list

Browser calls to the DeepSeek proxy are CORS-gated by `ALLOWED_ORIGINS` in
`workers/deepseek-proxy/index.js`. `s.`, `t.`, the apex and `go.` are all listed.
The worker is **not** deployed by `deploy.yml`/`deploy-staging.yml` — deploy it
after changing the list:

```bash
cd workers/deepseek-proxy
CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… npx wrangler deploy
```

The deployed worker had drifted from the repo (extra localhost/tunnel/beacon
origins), so the source now carries the union of both lists to keep a repo deploy
from dropping them.

## Caveats

- Custom-domain-to-branch is a documented workaround, not a first-class dashboard
  setting; the DNS target edit can be reset if you re-add the domain.
- There are community reports of preview/custom-domain caches serving the wrong
  deployment; if the wrong build appears, purge the zone cache.
