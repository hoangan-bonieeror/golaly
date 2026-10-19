# CI/CD

All automation lives in GitHub Actions (`.github/workflows/`).

```
PR / push ─┬─ Lint + typecheck ───────────┐
           ├─ API tests (PostGIS 16) + dbt┤
           ├─ Build + API Docker image ───┼─ all green & branch = main ─▶ 1. Neon: prisma migrate deploy
           └─ Pipelines (ruff + pytest) ──┘                              2. Render: deploy this commit, wait for "live", /health
                                                                         3. Vercel: build + deploy web (production), smoke /welcome
```

| Workflow | When | What |
|---|---|---|
| `ci.yml` (CI/CD) | every PR, every push to `main`, manual | 4 check jobs in parallel; on `main` the 3 deploy jobs run in order |
| `e2e.yml` (E2E) | manual only | full-stack Playwright Definition-of-Done + axe (~10 min) |
| `analytics.yml` (Analytics) | nightly 02:17 UTC, manual | `dbt build` of the analytics marts on Neon (environment `production`, secret `NEON_DATABASE_URL`) |
| `backup.yml` (Backup) | nightly 03:41 UTC, manual | `pg_dump` of Neon, encrypted with `BACKUP_PASSPHRASE`, kept 14 days as an artifact — see [Restore a backup](#restore-a-backup) |
| `dependabot.yml` | monthly / on advisories | one grouped PR a month for the GitHub Actions (releases ≥ 7 days old); npm and uv get **security** PRs only |

**Supply chain.** Every third-party action is pinned to a commit SHA (the version is in a comment; Dependabot updates
both), the Vercel CLI that holds the deploy token is pinned to an exact version, and the lint job runs
`npm audit --omit=dev` (critical fails the build; the rest goes to the job summary).

Pull requests never touch production. Vercel's Git integration still builds a **preview** for every PR branch;
`apps/web/vercel.json` turns off Vercel's own deploys of `main`, so production only changes after CI is green.

Deploys share the `deploy-production` concurrency group and are never cancelled half way. If one step fails,
the later ones don't run (a failed migration → the old API and web stay live).

## One-time setup

### 1. GitHub → Settings → Environments → New environment `production`

- **Deployment branches and tags → Selected branches → `main`.** Required: the deploy jobs' `if:` lives in the workflow file,
  which a pushed branch could edit — this setting is what keeps production secrets away from every branch but `main`.
- Optional: *Required reviewers* = yourself, if you want to click **Approve** before each deploy.

Also: Settings → Code security → turn on **Dependabot alerts** and **Dependabot security updates**.

**Environment secrets**

| Secret | Where to get it |
|---|---|
| `NEON_DATABASE_URL` | Neon → project *Golaly* → branch *production* → Connect → **turn pooling OFF** (host without `-pooler`), keep `?sslmode=require` |
| `RENDER_DEPLOY_HOOK_URL` | Render → *triply-api* → Settings → Deploy Hook (copy the whole URL) |
| `BACKUP_PASSPHRASE` | `openssl rand -base64 48` — **keep a copy in your password manager**; without it the backups can't be opened |
| `RENDER_API_KEY` | Render → Account settings → API keys (lets CI wait for the deploy to go live; optional) |
| `VERCEL_TOKEN` | vercel.com/account/tokens |
| `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | run `npx vercel link` in `apps/web` once, then read `.vercel/project.json` (`orgId`, `projectId`) — don't commit `.vercel/` |

**Environment variables** (not secret)

| Variable | Example |
|---|---|
| `RENDER_SERVICE_ID` | `srv-…` (in the Render dashboard URL of *triply-api*) |
| `API_URL` | `https://triply-api.onrender.com` — **required**: the web build's `API_ORIGIN` and `NEXT_PUBLIC_REALTIME_URL` |
| `MEDIA_ORIGIN` | the R2 bucket's public URL (optional; without it `/media` goes through the API, which redirects) |
| `WEB_URL` | `https://triply.vercel.app` (optional; defaults to the deployment URL) |

> Why the web build takes these from GitHub and not from Vercel: `vercel pull` can't read env vars marked
> **Sensitive** (it gets empty strings), and the `/api/v1` rewrite is compiled in at build time — an empty
> `API_ORIGIN` deployed a site where every API call was a 404. `next.config.ts` now refuses to build on Vercel
> without `API_ORIGIN`, and the smoke test calls `/api/v1/auth/providers` through the rewrite.

### 2. Render (*triply-api*)

- Settings → Build & Deploy → **Auto-Deploy: Off** (`render.yaml`: `autoDeployTrigger: off`). CI triggers the deploy through the hook,
  pinned to the tested commit (`&ref=<sha>`), and only after the migrations ran.
- Set `WEB_ORIGIN` to the Vercel production URL once it exists.
- Set `EDGE_SECRET` — the same random value (32+ chars, `openssl rand -hex 32`) as on Vercel. It lets the API trust the visitor address the web proxy forwards; without it every visitor shares the rate limit of Vercel's servers.

### 3. Vercel

- New project → import `hoangan-bonieeror/triply` → **Root Directory: `apps/web`**, framework Next.js
  (install/build at the repo root via npm workspaces is detected automatically).
- Project → Settings → Environment Variables (Production *and* Preview):
  - `API_ORIGIN` = `https://triply-api.onrender.com` — used at **build time** for the `/api/v1` and `/media` rewrites
  - `NEXT_PUBLIC_REALTIME_URL` = `https://triply-api.onrender.com`
  - `EDGE_SECRET` = the same value as on Render (read at **runtime** by `src/proxy.ts`, so Sensitive is fine). After the next deploy, open `/api/v1/admin/diagnostics/request` signed in as an admin: `viaEdge: true` and your own IP in `clientIp` mean it works.
- Previews call the production API: fine for a demo; don't share preview links with test data you care about.

### 4. Branch protection (recommended)

Settings → Branches → rule for `main` → *Require status checks to pass*: `Lint + typecheck`,
`API tests (unit + integration)`, `Build (shared, API, web) + API image`, `Pipelines (ruff + pytest)`.

## Everyday use

- Work on a branch → open a PR → CI runs, Vercel posts a preview link → merge → production deploys itself.
- Migrations: just commit them. CI proves they apply to an empty PostGIS database (`prisma migrate deploy`), CD applies them to Neon
  before the new API starts. **No more running `npm run db:deploy` against Neon by hand.**
- Re-deploy without a new commit: Actions → CI/CD → Run workflow → branch `main`, *Deploy* ticked.
- Run E2E: Actions → E2E → Run workflow.

## Rollback

- Web: Vercel → Deployments → previous deployment → *Promote to Production* (instant).
- API: Render → Deploys → previous deploy → *Rollback*.
- Database: Prisma migrations only go forward. Write a new migration that undoes the change, or restore the Neon branch to a point in time
  (Neon → Branches → *production* → Restore) — that loses writes made since then.

## Restore a backup

1. Actions → Backup → the run → download the artifact (a zip holding `triply-<time>.dump.gpg`).
2. Decrypt: `gpg --decrypt triply-<time>.dump.gpg > triply.dump` (asks for `BACKUP_PASSPHRASE`).
3. Restore into a **new** Neon branch (or a local database) first, check it, then point the app at it:
   `pg_restore --no-owner --no-privileges -d "<connection string>" triply.dump`
   (PostGIS must be available; `pg_restore` 18 reads the dump.)

## Not included (yet)

- Schema drift check (`prisma migrate diff` between `schema.prisma` and the migrations).
- Neon branch per PR (we test migrations on a throwaway PostGIS container instead).
- Deploying the Airflow catalog pipeline (it runs on your machine).
