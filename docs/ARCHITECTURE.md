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
| Access JWT (`sub`, `sid`) | `triply_at` cookie, HttpOnly, SameSite=Lax, path `/` | 15 min | No (stateless) |
| Refresh token (256-bit random) | `triply_rt` cookie, HttpOnly, path `/api/v1/auth` | 30 days | SHA-256 hash in `sessions` |

- **Rotation:** each refresh issues a new refresh token and invalidates the old one. Logout revokes the session. A password reset revokes all sessions.
- **CSRF:** every non-GET request must send `X-Requested-With: triply`. Browsers can't add that header cross-site without a CORS preflight, and only `WEB_ORIGIN` passes the preflight. This sits on top of SameSite=Lax.
- **Login:** unknown email and wrong password take the same time and return the same message.
- **Forgot password** always returns `200`, so it can't be used to discover which emails have accounts.

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
users ─1:1─ user_profiles            sessions, password_reset_tokens (hashed)
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
  ├──< media (storage_key, thumb_key, mime, size, width, height)
  └──< audit_logs (actor, action, entity, meta)
```

- All primary keys are UUIDs, so nothing sequential is ever exposed.
- Soft deletes apply to users, trips, posts and comments.
- Indexes and unique constraints follow spec §26: `users.email/username`, `trips.owner_id`, `(visibility, deleted_at)`, `trip_members(trip_id,user_id)`, `follows`, `post_likes`, `saved_posts`, `places(lat,lng)`, and so on.

Migrations live in `apps/api/prisma/migrations`. `npm test` rebuilds the test DB straight from those SQL files, so the tests always exercise exactly what production will run.

## REST API (`/api/v1`)

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/register` `/auth/login` `/auth/logout` `/auth/refresh` `/auth/forgot-password` `/auth/reset-password` |
| Users | `GET/PATCH/DELETE /users/me` · `GET /users/:handle` `/users/:handle/trips` `/users/:handle/posts` · `POST/DELETE /users/:handle/follow` |
| Trips | `POST/GET /trips` (`?filter=all\|mine\|shared\|past`) · `GET /trips/saved` · `GET/PATCH/DELETE /trips/:id` · `POST /trips/:id/fork` · `POST/DELETE /trips/:id/save` |
| Days | `GET/POST /trips/:id/days` · `PATCH/DELETE /trips/:id/days/:dayId` |
| Items | `POST /days/:dayId/items` · `PATCH/DELETE /items/:id` · `POST /items/:id/reorder` `{dayId,index}` · `POST /items/:id/duplicate` |
| Members | `GET /trips/:id/members` · `POST /trips/:id/invitations` · `DELETE /trips/:id/invitations/:invId` · `PATCH/DELETE /trips/:id/members/:userId` |
| Invitations | `GET /invitations/:token` · `POST /invitations/:token/accept\|reject` · `GET /invitations/id/:id` · `POST /invitations/id/:id/accept\|reject` |
| Discovery | `GET /explore` · `GET /search?q&type` · `GET /destinations` · `GET /destinations/:slug` · `GET /places/search?q&tripId` · `GET /places/:id` · `GET /places/saved` · `POST/DELETE /places/:id/save` |
| Social | `GET /feed?mode&cursor` · `POST /posts` · `GET /posts/saved` · `GET/PATCH/DELETE /posts/:id` · `POST/DELETE /posts/:id/like` · `POST/DELETE /posts/:id/save` · `GET/POST /posts/:id/comments` · `DELETE /comments/:id` · `POST /reports` |
| Notifications | `GET /notifications?cursor` · `GET /notifications/unread-count` · `PATCH /notifications/:id/read` · `PATCH /notifications/read-all` |
| Media | `POST /media` (multipart `file`) · `DELETE /media/:id` · files served at `/media/<key>` |
| Health | `GET /health` |

Errors always look like `{ statusCode, message, fields? }`, and `message` is always safe to show users. Status codes: 401, 403, 404, 409, 413, 415, 422, 429, 500.

### WebSocket (`/socket.io`)

The client emits `trip.join` / `trip.leave` with `{ tripId }`; joining is acknowledged with `{ ok }`. The server emits:

- `trip.event` `{ tripId, actorId, event, entityId? }`, where `event` is one of `trip.item.created|updated|deleted|reordered`, `trip.day.created`, `trip.updated` or `trip.member.joined|role_changed|removed`.
- `notification.new` (sent to the `user:<id>` room).

## Extension points

| Interface | Today | Later |
|---|---|---|
| `SearchProvider` (`modules/search`) | Postgres case-insensitive match | OpenSearch / Algolia |
| `StorageDriver` (`modules/media`) | Local disk + static `/media` | S3/R2 + signed URLs |
| `MailService` (`modules/mail`) | Dev outbox files | SMTP / Resend / SES |
| `MapCanvas` (`web/components/map`) | Offline SVG projection | MapLibre tiles + routing API |
| AI (spec §49) | — | Suggests structured operations; the user confirms; the API validates and applies them through the same services and permission checks |

## Known trade-offs

- **Search** uses `ILIKE`. That's fine at MVP scale; add `pg_trgm` or a search engine behind `SearchProvider` once data grows.
- **Concurrent edits are last-write-wins per field.** Realtime refetch makes conflicts visible right away; there's no collaborative text editing (as the spec says).
- **Access tokens are stateless for up to 15 minutes**, so after logout on another device (or account deletion) an already-issued access token keeps authenticating until it expires. Trip access is unaffected: membership and roles are re-read from the database on every request, and a removed member's socket leaves the trip room immediately.
