# TRIPLY architecture

## Request flow

```
Browser ──► Next.js (apps/web, :3000)
              │  /api/v1/*  and  /media/*  are rewritten (proxied) to the API
              ▼
           NestJS (apps/api, :4000)
              │  ThrottlerGuard → AuthGuard (JWT cookie + CSRF header) → ZodPipe → Controller
              │  → Service → TripAccessService.require(action) → Prisma → PostgreSQL
              │  → RealtimeService.emit(trip:<id>) / NotificationsService
              ▼
Browser ◄── Socket.IO (direct to :4000, same cookie) ── "trip.event" → TanStack Query refetch
```

- The browser only talks to its own origin for REST, so auth cookies are first-party and REST calls need no CORS.
- Realtime events only tell clients **what changed**. Clients refetch from REST, which stays the single source of truth. Concurrent edits can't diverge.

## Authentication

| Token | Where | Lifetime | Stored server-side |
|---|---|---|---|
| Access JWT (`sub`, `sid`, `typ: "access"`) | `triply_at` cookie, HttpOnly, SameSite=Lax, path `/` | 15 min | Its session (`sid`) is checked on every request |
| Refresh token (256-bit random) | `triply_rt` cookie, HttpOnly, path `/api/v1/auth` | 30 days | SHA-256 hash in `sessions` |

- **Session check:** the guard (and the Socket.IO handshake) verifies the JWT **and** that its session row is live — not revoked, not expired, user not deleted. One primary-key lookup; it makes logout, password change/reset and account deletion take effect on the next request. Revoked sessions' sockets are disconnected (`session:<id>` rooms).
- **Rotation:** each refresh issues a new refresh token; the swap is conditional on the old hash, so two concurrent refreshes can't both win. The previous hash is kept (`prev_token_hash`): replaying it within 30 s is a benign multi-tab race (`{ ok, raced: true }`, cookies untouched, the client retries); replaying it later means it was copied, so the whole session is revoked and audited (`session.reuse_detected`).
- **Lockout:** every 5 consecutive wrong passwords lock that account for 15 minutes (429), independent of IP. A successful login or a password reset clears it.
- **Email confirmation:** registration sends a 48-hour single-use link (`POST /auth/verify-email`, resend with `POST /auth/verify-email/resend`). Until confirmed, the account can't claim email-bound invitations (and gets no in-app notification for them). Accounts that existed before this was introduced were marked confirmed by the migration.
- **Typed tokens:** every JWT carries `typ`; the guard only accepts `access` with UUID `sub`/`sid`, so e.g. the OAuth state cookie (same secret) can never act as an access token.
- **CSRF:** every non-GET request must send `X-Requested-With: triply`. Browsers can't add that header cross-site without a CORS preflight, and only `WEB_ORIGIN` passes the preflight. This sits on top of SameSite=Lax.
- **Login:** unknown email and wrong password take the same time and return the same message.
- **Forgot password** always returns `200`, so it can't be used to discover which emails have accounts.
- **Google sign-in** (`GET /auth/google/start` → Google → `GET /auth/google/callback`): authorization-code flow with PKCE (S256) and a random `state`. Both live in a short-lived signed cookie (`triply_oauth`, 10 min, path `/api/v1/auth/google`), so no server-side state is needed. The ID token is verified with `google-auth-library` (audience = our client id). User resolution: linked `oauth_accounts` row → existing user with the same **verified** email (linked) → new user without a password (sent to onboarding; email counts as confirmed). If the existing account had never confirmed its email, linking is treated as the real owner taking it over: its password is removed and all its sessions are revoked (prevents pre-registration hijacking). Errors redirect to `/login?error=google_*`.
- **Change password:** `POST /auth/password` requires the current password when one exists (Google-only users can set one) and revokes every other session.

## Authorization (spec §28)

`packages/shared/src/permissions.ts` defines `can(action, { trip, members, userId })`:

| Action | Owner | Editor | Viewer | Non-member (Public / Link-only) |
|---|:-:|:-:|:-:|:-:|
| trip.view / itinerary.view | ✓ | ✓ | ✓ | ✓ |
| itinerary.add / edit / delete / reorder | ✓ | ✓ | | |
| trip.edit_details / change_visibility / delete | ✓ | | | |
| members.invite / change_role / remove | ✓ | | | |
| trip.fork | (own trip: no) | ✓ (if Public + allowFork) | ✓ (if Public + allowFork) | ✓ (if Public + allowFork, logged in) |

`TripAccessService` (API) loads the trip and its members **from the database** on every request and calls `can()`. It never uses a role, owner id or permission sent by the client. The web app gets a `permissions[]` list with each trip, but only to decide what to render.

Friendly failure messages: `"This trip is private."`, `"Only the trip owner can do that."` and `"You no longer have permission to edit this trip."`

## Data model

```
users ─1:1─ user_profiles            sessions (token_hash, prev_token_hash), password_reset_tokens & email_verification_tokens (hashed), oauth_accounts
  │  (email_verified_at, failed_login_count, locked_until)
  │  └─ follows (follower, following)
  ├──< trips (owner_id) ──< trip_destinations >── destinations ──< places
  │       ├──< trip_members (trip_id,user_id unique, role)
  │       ├──< trip_invitations (token_hash unique, expires_at, revoked_at, accepted_at)
  │       ├──< trip_days (trip_id, day_number unique) ──< itinerary_items ──> places?
  │       └── forked_from_id (+ denormalised title/owner for attribution)
  ├──< posts ──< post_media ──> media?    post_likes, post_comments, saved_posts
  ├──< saved_trips, saved_places
  ├──< notifications (recipient, actor, type, refs, read_at)
  ├──< reports (reporter, target, target_id unique)
  ├──< media (storage_key, medium_key, thumb_key, dominant_color, mime, size, width, height)
  └──< audit_logs (actor, action, entity, meta)
```

- All primary keys are UUIDs, so nothing sequential is ever exposed.
- Soft deletes apply to users, trips, posts and comments.
- Indexes and unique constraints follow spec §26: `users.email/username`, `trips.owner_id`, `(visibility, deleted_at)`, `trip_members(trip_id,user_id)`, `follows`, `post_likes`, `saved_posts`, `places(lat,lng)`, and so on.

### Place catalog (PostGIS)

```
geo_areas (COUNTRY/REGION…, boundary MultiPolygon, slug vn / vn-da-nang) ──< geo_area_names (lang)
   ▲ area_id                                     ▲ area_id
places (id kept forever; status ACTIVE/CLOSED/HIDDEN; location geography; category_id → categories;
        field_sources, locked_fields, quality_score, merged_into_id) ──< place_names (lang, kind)
   ▲ place_id (nullable until published)
place_sources (provider, external_id unique; raw, normalized, content_hash; missing_runs; last/changed_run_id)
categories (key, labelVi/labelEn, item_type) ──< category_maps (provider, external_category)
sync_runs (trigger, params, status running/succeeded/needs_review/partial/failed, stats)
```

`places.destination_id` is now optional: imported places belong to an administrative area and get the nearest curated
destination (within 15 km) only when there is one. Lists and search show only `status = ACTIVE` and not merged;
opening a merged place follows `merged_into_id`. The importer is a separate Python service (`pipelines/`), which only
talks to the database; it never calls the API.

Migrations live in `apps/api/prisma/migrations`. `npm test` rebuilds the test DB straight from those SQL files, so the tests always exercise exactly what production will run.

## REST API (`/api/v1`)

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/register` `/auth/login` `/auth/logout` `/auth/refresh` `/auth/forgot-password` `/auth/reset-password` `/auth/password` `/auth/verify-email` `/auth/verify-email/resend` · `GET /auth/providers` `/auth/google/start?next` `/auth/google/callback` |
| Users | `GET/PATCH/DELETE /users/me` · `GET /users/:handle` `/users/:handle/trips` `/users/:handle/posts` `/users/:handle/followers` `/users/:handle/following` · `POST/DELETE /users/:handle/follow` |
| Trips | `POST/GET /trips` (`?filter=all\|mine\|shared\|past`) · `GET /trips/saved` · `GET/PATCH/DELETE /trips/:id` · `POST /trips/:id/fork` · `POST/DELETE /trips/:id/save` |
| Days | `GET/POST /trips/:id/days` · `PATCH/DELETE /trips/:id/days/:dayId` |
| Items | `POST /days/:dayId/items` · `PATCH/DELETE /items/:id` · `POST /items/:id/reorder` `{dayId,index}` · `POST /items/:id/duplicate` |
| Members | `GET /trips/:id/members` · `POST /trips/:id/invitations` · `DELETE /trips/:id/invitations/:invId` · `PATCH/DELETE /trips/:id/members/:userId` |
| Invitations | `GET /invitations/:token` · `POST /invitations/:token/accept\|reject` · `GET /invitations/id/:id` · `POST /invitations/id/:id/accept\|reject` |
| Discovery | `GET /explore` · `GET /search?q&type` · `GET /destinations` · `GET /destinations/:slug` |
| Places | `GET /places/categories` · `GET /places/browse?destination\|near=lat,lng&radius&group&category&q&sort&cursor` · `GET /places/search?q&tripId` · `GET /places/saved` · `GET /places/:id` (detail: hours, contact, other-language names, nearby, public trips using it, data credits) · `GET /places/:id/trip-targets` (trips the viewer can edit, with days) · `POST/DELETE /places/:id/save` |
| Social | `GET /feed?mode&cursor` · `POST /posts` · `GET /posts/saved` · `GET/PATCH/DELETE /posts/:id` · `POST/DELETE /posts/:id/like` · `POST/DELETE /posts/:id/save` · `GET/POST /posts/:id/comments` · `DELETE /comments/:id` · `POST /reports` |
| Notifications | `GET /notifications?cursor` · `GET /notifications/unread-count` · `PATCH /notifications/:id/read` · `PATCH /notifications/read-all` |
| Media | `POST /media` (multipart `file`) · `DELETE /media/:id` · files served at `/media/<key>` |
| Health | `GET /health` |

Errors always look like `{ statusCode, message, fields? }`, and `message` is always safe to show users. Status codes: 401, 403, 404, 409, 413, 415, 422, 429, 500.

List endpoints that can grow without bound (`GET /trips`, `/trips/saved`, `/posts/saved`, `/posts/:id/comments`, `/notifications`, `/feed`) take `?cursor=<last id>&limit=` and return `{ items, nextCursor }` (the feed returns `{ posts, nextCursor }`). An invalid cursor is a 422. `GET /places/browse` is the exception: its results can be ordered by distance, so its cursor is an offset (`"24"`), and it also returns `center`, `radiusKm`, `total` and per-group `facets`.

**Explore → Places.** The area is a destination's centre (default 10 km) or a point from the browser's geolocation (default 5 km; rounded to ~10 m before it is sent, and only `geolocation=(self)` is allowed by `Permissions-Policy`). Filtering uses PostGIS (`ST_DWithin` on `places.location`, GIST-indexed) plus the taxonomy (group = the category's parent). "Recommended" around a point blends rating (unrated ≈ 3.8), data quality and closeness; "Nearest" and "Top rated" are plain sorts. Adding a place to a trip reuses `POST /days/:dayId/items`, so the role check, row lock, ordering, realtime event and notification are the same as in the itinerary editor; `trip-targets` only decides what to offer. The taxonomy ships as a data migration (`20261006000000_taxonomy`), so the filters work before the catalog pipeline has ever run.

### WebSocket (`/socket.io`)

The client emits `trip.join` / `trip.leave` with `{ tripId }`; joining is acknowledged with `{ ok }`. The server emits:

- `trip.event` `{ tripId, actorId, event, entityId? }`, where `event` is one of `trip.item.created|updated|deleted|reordered`, `trip.day.created`, `trip.updated` or `trip.member.joined|role_changed|removed`.
- `notification.new` (sent to the `user:<id>` room).

## Extension points

| Interface | Today | Later |
|---|---|---|
| `SearchProvider` (`modules/search`) | Postgres `pg_trgm` over an accent-free `search_text` column | OpenSearch / Algolia / Meilisearch |
| `StorageDriver` (`modules/media`) | Local disk + static `/media` | S3/R2 + signed URLs |
| `MailService` (`modules/mail`) | Dev outbox files | SMTP / Resend / SES |
| `TripMap` (`web/components/map`) | MapLibre tiles (OpenFreeMap) with SVG fallback | Routing API for real travel paths |
| AI (spec §49) | — | Suggests structured operations; the user confirms; the API validates and applies them through the same services and permission checks |

## Place catalog pipeline

`pipelines/` (Python) fills the catalog; the API only reads it. Airflow DAG `catalog_sync`:
`start → plan → extract_load × (provider × province) → finalize → finish`.

- **Extract**: Overture GeoParquet via DuckDB (bbox pushdown, `confidence ≥ 0.6`), OSM `.pbf` via pyosmium (tags →
  candidate categories, `name:xx` → names, ways → centroid).
- **Load** (`place_sources`): `COPY` into a temp table, upsert on `(provider, external_id)`; `changed_run_id` is set
  only when the content hash or category changed, so later steps touch only what changed.
- **Publish**: attach to an existing place (any name variant equal after normalisation, ≤ 50 m, no record from the
  same provider yet) or create one; then recompute fields by `FIELD_PRIORITY`, respecting `locked_fields`.
- **Missing records**: after a complete run, unseen records in scope get `missing_runs + 1`; at 3 the place closes
  unless another source still has it. If more than 10 % of a scope would close, nothing is applied (`needs_review`).
- **Text**: `normalize_search` in Python mirrors `normalizeSearch` in TypeScript; both test suites read
  `packages/shared/fixtures/normalize-cases.json`.

## Known trade-offs

- **Catalog matching is deliberately conservative** (same normalised name within 50 m). Different spellings stay as
  two places until a later phase adds fuzzy matching with an admin review queue; a wrong merge is worse than a duplicate.

- **Search** uses `pg_trgm`. Each searchable row keeps a denormalised, lower-cased, accent-free `search_text` (title, description, destinations, …) with a GIN trigram index; it's rewritten whenever the source fields change and back-filled at boot. A query matches when **every word** is a substring of `search_text` or has `word_similarity ≥ 0.4`; exact phrase matches rank first. Good up to hundreds of thousands of rows; past that, or for relevance tuning/facets, swap in a search engine behind `SearchProvider`.
- **Map routes** are straight lines between stops in visit order, not real road/transit paths.
- **Structural edits are serialised per trip.** Adding, moving, duplicating or deleting items and days takes `SELECT … FOR UPDATE` on the trip row inside the transaction, and reorder re-reads the item's current day under that lock and only changes the moved item's day — so concurrent reorders can't resurrect a stale list. Ordering is written in one `UPDATE … FROM unnest()` statement.
- **Counters are change-driven.** Likes, saves and comment deletes move their counters by the number of rows actually changed in the same transaction, so double-clicks and races neither error nor drift.
- **Side effects after commit.** Realtime notification pushes are queued with `afterCommit()` (AsyncLocalStorage inside `PrismaService.transaction()`), so clients never refetch before a row exists or hear about one that was rolled back.
- **Client IP for rate limits** comes from `X-Forwarded-For` as far as `TRUST_PROXY` allows. Next.js passes that header through unchanged, so production needs an edge that overwrites it (Vercel does; `deploy/nginx.conf` for Docker). Without an edge (local `npm run dev`) it can be forged; per-account lockout still protects passwords.
- **Private trip pages answer 403, not 404**, so a signed-out invitee sees "This trip is private — log in". A trip id is a random UUID, so this reveals nothing useful.
- **Concurrent field edits are last-write-wins.** Realtime refetch makes conflicts visible right away; there's no collaborative text editing (as the spec says).
- **Realtime runs on one instance.** Socket.IO rooms live in memory; scaling the API horizontally needs the Redis adapter.
