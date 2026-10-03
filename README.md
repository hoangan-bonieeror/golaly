# TRIPLY

> **Plan together. Discover together. Travel together.**
> A social travel planning platform that turns real travelers' trips into reusable, collaborative travel plans.

TRIPLY is a full-stack MVP. You can discover public trips, remix one into your own plan in a single tap, invite friends as Editors or Viewers, edit the itinerary together with live updates, and share finished trips as posts.

**Discover → Save → Fork/Remix → Plan → Invite → Collaborate → Share**

| Desktop: itinerary + map | Mobile: itinerary |
|---|---|
| ![Trip planning on desktop](docs/screenshots/d-trip-plan.png) | ![Itinerary on mobile](docs/screenshots/m-trip-plan.png) |

| Home feed | Members & roles | Explore |
|---|---|---|
| ![Home](docs/screenshots/d-home.png) | ![Members](docs/screenshots/d-members.png) | ![Explore](docs/screenshots/d-explore.png) |

---

## Stack

| Layer | Tech |
|---|---|
| Web | Next.js 16 (App Router), React 19, Tailwind CSS 4, TanStack Query, Socket.IO client |
| API | NestJS 11 (modular), Prisma 7 (`prisma-client` generator + `pg` driver adapter), Socket.IO, argon2id, JWT in HTTP-only cookies |
| Database | PostgreSQL 16 + PostGIS |
| Place catalog | `pipelines/`: Python 3.12, DuckDB, pyosmium, Apache Airflow 3: imports open place data (Overture Maps, OpenStreetMap) per country/province |
| Shared | `packages/shared`: domain types, the **permission matrix**, **Zod schemas** used by both API and forms, and the API response contract |
| Tests | Jest (unit + integration against a real Postgres test DB), Playwright (Definition-of-Done journey) |
| Ops | Docker Compose, Dockerfiles, GitHub Actions CI |

```
triply/
├── apps/
│   ├── api/                  NestJS REST API + WebSocket gateway
│   │   ├── prisma/           schema.prisma · migrations/ · seed.ts (dev demo data)
│   │   ├── src/common/       auth guard, CSRF, error filter, presenters (DB → view models)
│   │   ├── src/modules/      auth · users · trips · itinerary · members · search · social
│   │   │                     notifications · media · realtime · mail · audit
│   │   └── test/             integration tests (auth, trips, collaboration, social, realtime, media)
│   └── web/                  Next.js app (proxies /api/v1 and /media to the API)
│       ├── src/app/          (auth)/… and (app)/… routes
│       ├── src/components/   ui · layout · trip · itinerary · map · social
│       ├── src/lib/          api client + query hooks · realtime · session · toast
│       └── e2e/              definition-of-done.cjs (Playwright)
├── packages/shared/          types · permissions · schemas · api-types · fixtures/ (cases shared with Python)
├── pipelines/                place catalog: triply_catalog (Python) · dags/ (Airflow) · tests/
├── docs/                     ARCHITECTURE.md · screenshots
├── docker-compose.yml        PostGIS (dev) + optional full stack + optional Airflow
└── .github/workflows/ci.yml  typecheck → tests → build → e2e · pipelines: ruff → pytest
```

---

## Run it locally

You need **Node.js 20.9+** and **PostgreSQL 16**. Use Docker Desktop for Postgres, or install it natively.

### 1. Install & configure

```bash
npm install            # also builds packages/shared and generates the Prisma client
npm run setup          # creates apps/api/.env (with a random JWT secret) and apps/web/.env.local
```

### 2. Start PostgreSQL

**Option A, Docker (easiest):**
```bash
docker compose up -d db      # PostgreSQL + PostGIS; creates the `triply` and `triply_test` databases
```

**Option B, native Postgres** (Windows installer from postgresql.org with the **PostGIS** add-on from Stack Builder, or Homebrew/apt `postgis`). Then create a user and both databases, for example with `psql -U postgres`:
```sql
CREATE ROLE triply WITH LOGIN PASSWORD 'triply' CREATEDB;
CREATE DATABASE triply OWNER triply;
CREATE DATABASE triply_test OWNER triply;
-- PostGIS can only be enabled by a superuser; enabling it in template1 covers every database created later
-- (including the ones the test suites recreate).
\c template1
CREATE EXTENSION IF NOT EXISTS postgis;
\c triply
CREATE EXTENSION IF NOT EXISTS postgis;
\c triply_test
CREATE EXTENSION IF NOT EXISTS postgis;
```
If you use different credentials, edit `DATABASE_URL` / `TEST_DATABASE_URL` in `apps/api/.env`.

> **Upgrading an existing checkout?** The database image is now `postgis/postgis:16-3.4-alpine`. `docker compose up -d db` recreates the container on the new image and keeps your data volume; then run `npm run db:deploy`.

> **Port 5432 already taken** (e.g. a native Postgres is running)? Put `TRIPLY_DB_PORT=5433` in a `.env` file next to `docker-compose.yml` and use `localhost:5433` in your `DATABASE_URL` / `TEST_DATABASE_URL`.

### 3. Create tables, load demo data, run

```bash
npm run db:deploy      # creates the tables from prisma/migrations (no prompts)
npm run db:seed        # DEV ONLY: demo users, trips, posts
npm run dev            # API → http://localhost:4000   Web → http://localhost:3000
```

Open **http://localhost:3000** and log in with a demo account (password `demo1234`):

| User | Email | Role in "Japan — 7 Days" |
|---|---|---|
| An | an@triply.dev | **Owner** |
| Minh | minh@triply.dev | Editor |
| Linh | linh@triply.dev | Viewer |
| Nam | nam@triply.dev | Viewer |
| Sarah | sarah@triply.dev | Not a member (public trips only); has a pending invite |

In development, a **flask button** (top bar on mobile, bottom-right on desktop) does a real login as any demo user, so you can switch between Owner, Editor, Viewer and an outsider quickly. It's hidden in production builds.

**Live collaboration:** open a normal window as An and a private window as Minh, both on the Japan trip. Edit as Minh and An's view updates instantly. The trip header shows a **Live** badge.

Emails (invites, password resets) are written to `apps/api/storage/outbox/` in development, never to logs.

### Optional: Google sign-in

The "Continue with Google" button only appears when Google credentials are configured.

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → **Create credentials → OAuth client ID** → type **Web application**.
2. Authorised redirect URI: `http://localhost:3000/api/v1/auth/google/callback` (in production: `https://<your-web-domain>/api/v1/auth/google/callback`).
3. Put the values in `apps/api/.env` and restart the API:
   ```bash
   GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=xxxx
   ```

Google accounts are matched by Google's account id, then by **verified** email (so an existing email/password user gets Google linked to the same account). Google-only users can add a password later in **Settings**.

### Map tiles

Trip maps use [MapLibre GL](https://maplibre.org) with the free [OpenFreeMap](https://openfreemap.org) style, so they need internet access. Set `NEXT_PUBLIC_MAP_STYLE_URL` in `apps/web/.env.local` to use another style (MapTiler, Stadia, your own), or `off` to always use the offline SVG map. If tiles fail to load (offline, no WebGL), the app falls back to the SVG map automatically.

### Useful commands

| Command | What it does |
|---|---|
| `npm run dev` | shared (watch) + API (watch) + web (hot reload) |
| `npm test` | API unit + integration tests (uses `TEST_DATABASE_URL`, rebuilt each run) |
| `npm run test:unit` | Unit tests only (no database needed) |
| `npm run e2e` | Playwright Definition-of-Done journey against a running stack |
| `npm run typecheck` | TypeScript, strict, all packages |
| `npm run lint` | ESLint (typescript-eslint, React Hooks, Next.js rules) |
| `npm run build` / `npm start` | Production build / serve |
| `npm run db:deploy` | Apply committed migrations (first-time setup, CI, production) |
| `npm run db:migrate` | After you change `schema.prisma`: create + apply a new migration (`prisma migrate dev`, needs CREATEDB for its shadow database) |
| `npm run db:reset` | Drop, re-migrate and re-seed the dev DB |

---

## What's implemented (MVP P0 + P1)

| Area | Details |
|---|---|
| **Auth** | Register with **email confirmation**, login with **per-account lockout** (5 wrong passwords → 15 min), logout that ends the session **immediately** (every request re-checks the session), refresh-token rotation with **theft detection** (a replayed old token revokes the session; a same-moment multi-tab refresh is tolerated), forgot/reset password (single-use, 30-min tokens; logs out everywhere), onboarding, **Google sign-in** (authorization-code flow with PKCE + state, ID token verified; linking to an unconfirmed account removes its password and sessions), set/change password. |
| **Users** | Profile with traveler type, interests, trips / countries / followers / following stats, "Follows you" badge and follower lists, avatar upload, bio, home base, public trips & posts, account deletion (confirmed with password, or username for Google-only accounts; soft delete + anonymise). |
| **Trips** | CRUD, destinations (multi-stop route), dates that keep days in sync and **never silently delete plans**, cover upload, budget, visibility `PRIVATE` (default) / `LINK_ONLY` / `PUBLIC`, allow comments, allow fork, soft delete. |
| **Itinerary** | Days (add, rename, delete with renumbering), items of 7 types, place search, times (chronological auto-ordering; untimed notes keep their slot), notes, duplicate, reorder within or across days (drag & drop or a keyboard-accessible menu), "Edited by …" trail. Concurrent edits to one trip are serialised with a row lock, so two people reordering at once can't undo each other. |
| **Collaboration** | Owner / Editor / Viewer enforced **server-side on every request**. Invite by email (bound to that address, single-use, and only claimable once the address is confirmed) or link (reusable until expiry/revoke). Tokens are 256-bit, stored as SHA-256 hashes, expire in 7 days and are revocable. Owners change roles and remove members; members can leave. Audit log for every permission change. |
| **Realtime** | Socket.IO rooms per trip (handshake checks the live session; joining re-checks permission). Item, day and member events refresh collaborators' screens; removed members are kicked, outsiders are evicted when a trip goes private, revoked sessions are disconnected. Notifications are pushed live — only after their transaction commits. The client refreshes its session and reconnects on its own. |
| **Fork / Remix** | Copies title, description, dates, destinations, days, items and places. Does **not** copy members, invites, comments, media or counters. New owner = forker; copy starts Private; "Based on … by @…" attribution survives even if the source is deleted. |
| **Social** | Feed (For You / Following), cursor pagination on every list that can grow (trips, saved, comments, notifications), posts linked to trips (public post of a private trip is refused), drafts, photos, likes and saves that are idempotent under double-clicks, comments (author can moderate), follows, share, reports (5 reasons, one per user per target). |
| **Discovery** | Search across trips, places, people and destinations: **accent-insensitive and typo-tolerant** (`hoi an` → Hội An, `tokio` → Tokyo) using `pg_trgm` trigram indexes, every word must match, best matches first (behind a `SearchProvider` interface, so it can move to OpenSearch/Algolia later), destination pages, explore, recent searches. Interactive **MapLibre** trip maps with numbered pins and the day's route. |
| **Explore places** | Browse places **around a destination or "Near me"** (browser location) within 2–25 km, by kind (10 groups such as Food, Coffee & drinks, Sights, Nature, Nightlife, and 50+ sub-categories with live counts), sorted by recommended / nearest / top rated, as a list and a map; filters live in the URL so results can be shared. Every place has its own page (hours, phone, website, names in other languages, directions, nearby places, public trips that include it, data credits). **Add to trip** from anywhere: pick one of the trips you can edit (nearby trips first), a day and an optional time, or create a new trip on the spot. |
| **Privacy** | Private trips never appear in Explore, search, feeds or public profiles. Non-members of public trips don't see the member list or invites. Posts about a trip that goes private leave feeds and hide that trip everywhere (spec §34); remixes stop linking to it. Reports can't be used to probe for private content. |
| **Media** | JPEG/PNG/WebP validated by content, size and dimensions; re-encoded to WebP (**strips EXIF/GPS**) in three sizes (640 / 1280 / 2400px) served with `srcset`, plus a dominant-colour placeholder while loading. Uploads are capped at 40 MP, 30/min and 200/day per user. The storage driver interface keeps local disk now and S3/R2 later. |
| **Notifications** | All 9 spec types, unread badge, mark one or all as read, deep links, coalescing of rapid item edits. |
| **Security** | argon2id; HTTP-only SameSite=Lax cookies; CSRF header check; typed JWTs (an OAuth state token can't pass as an access token); CORS locked to the web origin; Helmet on the API and anti-clickjacking headers on the web app; per-IP rate limits that can't be dodged by forging `X-Forwarded-For` behind the edge proxy; validated env (refuses insecure cookies in production); friendly error filter (no stack traces or SQL leak); no passwords, tokens or bodies in logs. |
| **Accessibility** | WCAG AA colour contrast, focus-trapped dialogs that return focus, ARIA tabs and menus with arrow-key support, labelled and described form errors, skip link, one `<title>` per page, logical headings, 44px touch targets. An axe-core gate in the E2E run fails the build on any serious/critical issue (desktop and mobile). |

| **Place catalog** | Admin-driven import of places for a whole country, a province or one destination from **open data** (Overture Maps + OpenStreetMap), Python + Airflow. Records from every source are kept, matched across sources (names in any language, within 50 m) and merged field by field with recorded provenance; existing place ids and itineraries never change; re-runs are idempotent; closures need 3 missed runs and a safety brake stops mass closures. PostGIS boundaries for Vietnam's provinces; names per language for locale-aware display. See **[pipelines/README.md](pipelines/README.md)**. |

Not in this MVP (spec P2): AI planning, route optimisation, bookings, expense splitting, offline mode, live tracking, moderation dashboard.

API reference, data model and design decisions are in **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

---

## Testing

- **Unit** (`src/**/*.spec.ts`): the permission matrix and `TripAccessService`, itinerary ordering logic, crypto, dates and the shared Zod schemas.
- **Integration** (`test/*.int.ts`): boots the real Nest app against `triply_test`, rebuilt from the committed migrations and seeded. Covers auth (cookies, rotation, CSRF, reset, deletion), trip and itinerary services, invitations (link, email-bound, expiry, revoke), roles, fork rules, realtime events over a real socket, social, privacy, reports and media uploads. `hardening.int.ts` covers the security/concurrency fixes: immediate logout, lockout, email confirmation, Google takeover of a squatted account, refresh-token theft detection, concurrent comment deletes / likes / reorders, socket handshake and eviction, pagination and input validation.
- **E2E** (`apps/web/e2e/definition-of-done.cjs`): runs the spec §51 journey in three separate browser sessions: register → create trip → 3 items → invite → accept → promote to Editor → editor edits → owner sees it live → make public → another user discovers, saves and forks → fork is independent → original unchanged → attribution kept → explores food around Tokyo, opens a place and adds it to Day 2 of the trip, plus a privacy check, an **axe-core accessibility gate** (11 screens incl. Explore places, a destination and a place page, at desktop and mobile widths; also fails on sideways scrolling) and cleanup of the trips it created.

Also `npm run lint` (ESLint 9 with typescript-eslint, React Hooks and Next rules) runs in CI.

- **Pipeline** (`pipelines/tests`, pytest): normalisation (checked against the same cases as the TypeScript `normalizeSearch`), provider adapters, and end-to-end runs on synthetic Overture/OSM fixtures against a real PostGIS database: idempotent re-runs, itineraries untouched, locked fields, closures and the safety brake. The Airflow DAGs were executed with `dag.test()` on Airflow 3.1.

Current status: **118/118** API tests (`places.int.ts` covers the taxonomy, browsing by area/radius/kind/text, paging, input validation, closed/merged/hidden places, privacy of trips shown on a place, and who may add to which trip), **44** pipeline tests (+ a DAG parse test that runs where Airflow is installed), lint clean, and **all Definition-of-Done steps + the accessibility gate** pass.

---

## Deploying

The repo has a Dockerfile for each app and a `full` Compose profile:

```bash
export JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")
docker compose --profile full up --build      # → http://localhost:3000
```

Services: `db` (bound to 127.0.0.1 only) → `migrate` (runs `prisma migrate deploy` once) → `api` → `web` → `edge` (nginx, the only published port). The edge overwrites `X-Forwarded-For` with the real client address, so per-IP rate limits can't be bypassed, and it serves Socket.IO on the same origin, so the API port is never exposed. Images are small and run as the unprivileged `node` user (Next.js `standalone` output, production-only dependencies).

For a real deployment (for example Render, Railway or Fly for the API, Vercel for the web app, and a managed Postgres):

1. **API**: set `DATABASE_URL`, `JWT_SECRET` (48+ random bytes), `WEB_ORIGIN=https://your-web-domain`, `COOKIE_SECURE=true` (the API refuses to start in production without it), `NODE_ENV=production` and `TRUST_PROXY` (the subnet or hop count of the proxies in front — never `true`). Run `npm run db:deploy` on release, then `node apps/api/dist/main.js`.
2. **Web**: set `API_ORIGIN=https://your-api-domain` **at build time** (Next rewrites are compiled in) and `NEXT_PUBLIC_REALTIME_URL=https://your-api-domain`.
3. Serve both under the same parent domain (for example `app.example.com` and `api.example.com`) so cookies and WebSockets work, or put both behind one reverse proxy like `deploy/nginx.conf`.
4. **Client IPs:** Next.js forwards `X-Forwarded-For` untouched, so the first hop must overwrite it with the real address (Vercel does; with nginx use `proxy_set_header X-Forwarded-For $remote_addr`). In plain `npm run dev` there's no edge, so anyone hitting your laptop could forge it — per-account login lockout still applies.
5. Swap the local media driver for S3/R2, and the dev-outbox mail driver for SMTP/Resend/SES (both are small interfaces in `apps/api/src/modules/`).
6. Never run `db:seed` in production. It refuses when `NODE_ENV=production`.

> The Compose file and nginx config were validated (`docker compose config`, `nginx -t`, and the edge was exercised against the running stack), but the images themselves couldn't be built where this was developed (no Docker Hub access). Run `docker compose --profile full up --build` once on your machine.

---

## Presenting this in a portfolio

- **Lead with the loop:** a 30-second recording of *Sarah remixes An's public trip → edits her copy → An's original is untouched* explains the product immediately.
- **Show authorization as a feature:** put `packages/shared/src/permissions.ts` and `TripAccessService` next to Owner, Editor and Viewer screenshots. Every write is re-checked server-side with roles from the database.
- **Show one schema, two runtimes:** the same Zod schemas validate the forms and the API.
- **Show the data platform:** `pipelines/` is a small, real ETL: Overture GeoParquet read straight from S3 with DuckDB, OSM streamed with pyosmium, PostGIS, idempotent upserts by content hash, cross-source entity matching, field-level survivorship with provenance, and an Airflow DAG with one mapped task per province.
- **Show Explore as a product loop:** *"near me" → coffee → open a café → Add to trip → Day 2* in 15 seconds, then the same place appearing on the trip map. The category facets and PostGIS radius query sit behind it.
- **Point to the tests:** 118 API tests plus a Playwright script that proves the spec's Definition of Done and gates accessibility.
- **Tell the hardening story:** an honest self-review found a rate-limit bypass, Google account pre-hijacking and two race conditions; each fix landed with a test that reproduces the problem (`apps/api/test/hardening.int.ts`). Interviewers love this.
- **Suggested headline:** *"TRIPLY: collaborative trip planning with GitHub-style fork/remix for itineraries. Next.js 16 · NestJS · Prisma · PostgreSQL · Socket.IO."*
