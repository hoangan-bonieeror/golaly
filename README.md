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
| Database | PostgreSQL 16 |
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
├── packages/shared/          types · permissions · schemas · api-types
├── docs/                     ARCHITECTURE.md · screenshots
├── docker-compose.yml        Postgres (dev) + optional full stack
└── .github/workflows/ci.yml  typecheck → tests → build → e2e
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
docker compose up -d db      # creates the `triply` and `triply_test` databases
```

**Option B, native Postgres** (Windows installer from postgresql.org, or Homebrew/apt). Then create a user and both databases, for example with `psql -U postgres`:
```sql
CREATE ROLE triply WITH LOGIN PASSWORD 'triply' CREATEDB;
CREATE DATABASE triply OWNER triply;
CREATE DATABASE triply_test OWNER triply;
```
If you use different credentials, edit `DATABASE_URL` / `TEST_DATABASE_URL` in `apps/api/.env`.

### 3. Create tables, load demo data, run

```bash
npm run db:migrate     # applies prisma/migrations
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

### Useful commands

| Command | What it does |
|---|---|
| `npm run dev` | shared (watch) + API (watch) + web (hot reload) |
| `npm test` | API unit + integration tests (uses `TEST_DATABASE_URL`, rebuilt each run) |
| `npm run test:unit` | Unit tests only (no database needed) |
| `npm run e2e` | Playwright Definition-of-Done journey against a running stack |
| `npm run typecheck` | TypeScript, strict, all packages |
| `npm run build` / `npm start` | Production build / serve |
| `npm run db:migrate` | Create/apply migrations (`prisma migrate dev`) |
| `npm run db:reset` | Drop, re-migrate and re-seed the dev DB |

---

## What's implemented (MVP P0 + most of P1)

| Area | Details |
|---|---|
| **Auth** | Register, login, logout, refresh-token rotation (reuse is rejected), forgot/reset password (single-use, 30-min tokens; logs out other sessions), onboarding. Google OAuth is a P1 stub. |
| **Users** | Profile, avatar upload, bio, home base, followers/following, public trips & posts, account deletion (password-confirmed, soft delete + anonymise). |
| **Trips** | CRUD, destinations (multi-stop route), dates that keep days in sync and **never silently delete plans**, cover upload, budget, visibility `PRIVATE` (default) / `LINK_ONLY` / `PUBLIC`, allow comments, allow fork, soft delete. |
| **Itinerary** | Days (add, rename, delete with renumbering), items of 7 types, place search, times (chronological auto-ordering; untimed notes keep their slot), notes, duplicate, reorder within or across days (drag & drop or menu), "Edited by …" trail. |
| **Collaboration** | Owner / Editor / Viewer enforced **server-side on every request**. Invite by email (bound to that address, single-use) or link (reusable until expiry/revoke). Tokens are 256-bit, stored as SHA-256 hashes, expire in 7 days and are revocable. Owners change roles and remove members; members can leave. Audit log for every permission change. |
| **Realtime** | Socket.IO rooms per trip (joining re-checks permission). Item, day and member events refresh collaborators' screens; removed members are kicked from the room. Notifications are pushed live. |
| **Fork / Remix** | Copies title, description, dates, destinations, days, items and places. Does **not** copy members, invites, comments, media or counters. New owner = forker; copy starts Private; "Based on … by @…" attribution survives even if the source is deleted. |
| **Social** | Feed (For You / Following, cursor pagination), posts linked to trips (public post of a private trip is refused), drafts, photos, likes, comments (author can moderate), saves, follows, share, reports (5 reasons, one per user per target). |
| **Discovery** | Search across trips, places, people and destinations (behind a `SearchProvider` interface, so it can move to OpenSearch/Algolia later), destination pages, explore. |
| **Privacy** | Private trips never appear in Explore, search, feeds or public profiles. Non-members of public trips don't see the member list or invites. Posts drop out of feeds when their trip goes private. |
| **Media** | JPEG/PNG/WebP validated by content, size and dimensions; re-encoded to WebP (**strips EXIF/GPS**); 640px thumbnails. The storage driver interface keeps local disk now and S3/R2 later. |
| **Notifications** | All 9 spec types, unread badge, mark one or all as read, deep links, coalescing of rapid item edits. |
| **Security** | argon2id; HTTP-only SameSite=Lax cookies; CSRF header check; CORS locked to the web origin; Helmet; rate limits (stricter on auth); validated env; friendly error filter (no stack traces or SQL leak); no passwords, tokens or bodies in logs. |

Not in this MVP (spec P2): AI planning, route optimisation, bookings, expense splitting, offline mode, live tracking, moderation dashboard.

API reference, data model and design decisions are in **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

---

## Testing

- **Unit** (`src/**/*.spec.ts`): the permission matrix and `TripAccessService`, itinerary ordering logic, crypto, dates and the shared Zod schemas.
- **Integration** (`test/*.int.ts`): boots the real Nest app against `triply_test`, rebuilt from the committed migrations and seeded. Covers auth (cookies, rotation, CSRF, reset, deletion), trip and itinerary services, invitations (link, email-bound, expiry, revoke), roles, fork rules, realtime events over a real socket, social, privacy, reports and media uploads.
- **E2E** (`apps/web/e2e/definition-of-done.cjs`): runs the spec §51 journey in three separate browser sessions: register → create trip → 3 items → invite → accept → promote to Editor → editor edits → owner sees it live → make public → another user discovers, saves and forks → fork is independent → original unchanged → attribution kept, plus a privacy check.

Current status: **65/65** API tests and **all 16 Definition-of-Done steps** pass.

---

## Deploying

The repo has a Dockerfile for each app and a `full` Compose profile:

```bash
export JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")
docker compose --profile full up --build      # db + api (runs migrations on start) + web
```

For a real deployment (for example Render, Railway or Fly for the API, Vercel for the web app, and a managed Postgres):

1. **API**: set `DATABASE_URL`, `JWT_SECRET` (48+ random bytes), `WEB_ORIGIN=https://your-web-domain`, `COOKIE_SECURE=true` and `NODE_ENV=production`. Run `npm run db:deploy` on release, then `node apps/api/dist/main.js`.
2. **Web**: set `API_ORIGIN=https://your-api-domain` **at build time** (Next rewrites are compiled in) and `NEXT_PUBLIC_REALTIME_URL=https://your-api-domain`.
3. Serve both under the same parent domain (for example `app.example.com` and `api.example.com`) so cookies and WebSockets work, or put both behind one reverse proxy.
4. Swap the local media driver for S3/R2, and the dev-outbox mail driver for SMTP/Resend/SES (both are small interfaces in `apps/api/src/modules/`).
5. Never run `db:seed` in production. It refuses when `NODE_ENV=production`.

> The Docker files follow standard multi-stage patterns but were not run in the environment this was built in. Test `docker compose --profile full up --build` once on your machine.

---

## Presenting this in a portfolio

- **Lead with the loop:** a 30-second recording of *Sarah remixes An's public trip → edits her copy → An's original is untouched* explains the product immediately.
- **Show authorization as a feature:** put `packages/shared/src/permissions.ts` and `TripAccessService` next to Owner, Editor and Viewer screenshots. Every write is re-checked server-side with roles from the database.
- **Show one schema, two runtimes:** the same Zod schemas validate the forms and the API.
- **Point to the tests:** 65 API tests plus a Playwright script that proves the spec's Definition of Done.
- **Suggested headline:** *"TRIPLY: collaborative trip planning with GitHub-style fork/remix for itineraries. Next.js 16 · NestJS · Prisma · PostgreSQL · Socket.IO."*
