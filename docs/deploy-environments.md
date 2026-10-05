# Deploy environments: staging (`s.`) vs production (`ultrafastfluency.com`)

How to serve two different Cloudflare Pages deployments from one Pages project:
`s.ultrafastfluency.com` for **staging** and `ultrafastfluency.com` (apex) for
**production**. `go.ultrafastfluency.com` is intentionally left alone.

Cloudflare reference: [Add a custom domain to a branch](https://developers.cloudflare.com/pages/how-to/custom-branch-aliases/).

## The mechanism

A Cloudflare Pages project deploys:
- the **production branch** (set in the project, here `main`) to the root alias
  `uffenglish.pages.dev`, which all "normal" custom domains serve; and
- every **other branch** to a stable preview alias
  `<branch>.uffenglish.pages.dev` (branch name lowercased, non-alphanumerics → `-`).

So one project can host both environments. To make a custom domain point at a
*branch* instead of production, you add the custom domain normally and then edit
the DNS record Pages created so its target is the branch alias, e.g.
`uffenglish.pages.dev` → `staging.uffenglish.pages.dev`.

**Hard requirement:** it only works with a **proxied** Cloudflare DNS record (the
domain must be a zone on your Cloudflare account). An unproxied record, or an
external DNS provider, silently falls back to the production branch.

`deploy.yml` already deploys every branch
(`pages deploy dist --project-name=uffenglish --branch=${{ github.ref_name }}`),
so no CI change is needed — pushing a `staging` branch produces
`staging.uffenglish.pages.dev`.

## Target layout

| URL | Serves | Notes |
|---|---|---|
| `ultrafastfluency.com` (apex) | production (`main`) | currently returns **HTTP 522** — see below |
| `s.ultrafastfluency.com` | staging (`staging` branch) | currently still points at production; repoint via DNS |
| `go.ultrafastfluency.com` | production | leave alone |
| `uffenglish.pages.dev` | production | Pages default |
| `staging.uffenglish.pages.dev` | `staging` branch | created automatically once the branch deploys |

## Step 1 — make the apex production (fix the 522)

The apex currently returns HTTP 522 (Cloudflare reached the edge but the origin
did not answer), which usually means the DNS record is missing, unproxied, or
pointing somewhere other than Pages.

1. Workers & Pages → **uffenglish** → **Custom domains**: ensure
   `ultrafastfluency.com` is present (add it if not; activate the domain).
2. DNS → `ultrafastfluency.com` zone: the apex record Pages created must be a
   **proxied** record targeting `uffenglish.pages.dev` (apex uses CNAME
   flattening).
3. Re-check `https://ultrafastfluency.com/`.

## Step 2 — create the staging branch

There must be at least one successful deployment on the branch before DNS can be
repointed. The repo commits to `main`, so the simplest way to seed it:

```bash
git push origin main:staging
```

Confirm `https://staging.uffenglish.pages.dev/` loads the app.

## Step 3 — attach `s.` to the staging branch

1. Workers & Pages → **uffenglish** → **Custom domains** → **Setup a custom
   domain** → `s.ultrafastfluency.com` → **Activate domain**.
2. DNS → `ultrafastfluency.com` zone: find the `s` CNAME Pages just created and
   change its target from `uffenglish.pages.dev` to
   `staging.uffenglish.pages.dev`. Keep it **proxied**.
3. `https://s.ultrafastfluency.com/` now serves the latest `staging` build.

## Step 4 — a workflow that actually gates production

Branch alias alone just mirrors a branch; to make `s.` a real pre-production
check, `staging` must be able to differ from `main`. Two options:

- **Branch flow (recommended if you want a gate):** feature branch → merge into
  `staging` → verify on `s.` → merge `staging` into `main` → production. This
  asks the team to stop committing straight to `main`.
- **Mirror flow (no workflow change):** keep committing to `main`; when you want
  a smoke test, `git push origin main:staging` and check `s.`. Staging then
  equals production, so it is a verification surface, not a holdback.

## Environment variables

Pages has separate **Production** and **Preview** variables. Preview (staging)
builds should carry the same `VITE_SUPABASE_*` and `VITE_PUBLIC_POSTHOG_*`
values as production; if they are unset the app falls back to the publishable
defaults in code, so staging still works but reports into the same Supabase/
PostHog project as production.

## AI proxy allow-list

Browser calls to the DeepSeek proxy are CORS-gated by `ALLOWED_ORIGINS` in
`workers/deepseek-proxy/index.js`. Staging (`s.`) is now in that list. The worker
is **not** deployed by `deploy.yml` — deploy it after changing the list:

```bash
cd workers/deepseek-proxy && npx wrangler deploy
```

(`ultrafastfluency.com`, `go.`, `t.`, `uffenglish.pages.dev`, and localhost were
already allowed.)

## Caveats

- Custom-domain-to-branch is a documented workaround, not a first-class
  dashboard setting; the DNS target edit can be reset if you re-add the domain.
- There are community reports of preview/custom-domain caches serving the wrong
  deployment; if the wrong build appears, purge the zone cache.
- The `s.` → staging switch only takes effect once the `staging` branch has a
  deployment; before that `s.` would 404.
