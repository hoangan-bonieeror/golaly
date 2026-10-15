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
Browser ◄── Socket.IO (direct to the API: cookie, or a 1-min socket token) ── "trip.event" → TanStack Query refetch
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
sync_jobs (name, area|bbox, providers, category_keys, cron schedule, enabled, photos, next_run_at)
   └──< sync_runs (trigger, params, status queued/running/succeeded/needs_review/partial/failed/cancelled/dry_run,
                   progress, stats, cancel_requested, requested_by) ──< sync_run_errors (provider, external_id, stage)
merge_candidates (place_a < place_b, score, signals, PENDING/MERGED/REJECTED) · place_merges (winner, loser, moved rows, undone_at)
place_edits (place, field, old, new, actor) — every admin edit; the field joins places.locked_fields
place_photos (place, source user|wikimedia, source_id, media? | remote_url, credits: title/author/licence/page,
              status PENDING/APPROVED/HIDDEN, score, uploaded_by?, post?, report_count, ingest attempts/back-off)
  └─> media (owner_id is null for imported images)
```

`places.destination_id` is now optional: imported places belong to an administrative area and get the nearest curated
destination (within 15 km) only when there is one. Lists and search show only `status = ACTIVE` and not merged;
opening a merged place follows `merged_into_id`. The importer is a separate Python service (`pipelines/`), which only
talks to the database; it never calls the API.

**Flexible plans** (migration `20261017000000_flexible_plans`). Trips, places and travellers rarely follow a clock, so a
plan has three layers: *anchors* (items with a `start_time` — flights, tours, bookings), a soft day plan where every
other item sits in a part of the day (`itinerary_items.slot`: MORNING, AFTERNOON, EVENING, ANY), and the trip's
*ideas pool* (`itinerary_items.day_id IS NULL`; every item now carries `trip_id`). An anchor's time decides its slot
(`slotForTime`: before 12:00, before 17:00, evening); a day is kept grouped by slot, anchors chronological within it
(`orderBySlot`, in `packages/shared/src/plan.ts`, used by the API and by the web app's optimistic updates). Moving an
item to the pool clears its time; deleting a day returns its places to the pool. Every member — viewers too, through
the `itinerary.vote` permission — has one vote per item (`item_votes`: LOVE / OK / SKIP); the pool is ranked by the
group's score (+2 / +1 / −1). Members can be there for part of the trip (`trip_members.arrive_on` / `leave_on`); the
planner shows who is away each day and warns when someone who loves a place isn't there the day it's planned. Ideas
close to each other are grouped client-side (`clusterByArea`, single-linkage within 1.5 km) so a whole area can be
planned into one part of a day.

**During the trip** (migration `20261019000000_split_the_group`). The web app decides "today" and "now" from the
device's clock (`tripNow` in `lib/plan.ts`: the trip's day whose date is today, and `slotForTime` of the local time);
the server never guesses a time zone. `GET /trips/:id/next?date&time[&near=lat,lng]` takes the traveller's local date
and time (opening hours are local to the place, and the traveller is there) and returns today's remaining stops, the
ideas and, with a location, up to five rated places within 1.2 km that aren't in the trip and aren't closed (a KNN walk
of the places GIST index). Opening hours are evaluated by `openStateAt` in `packages/shared/src/opening-hours.ts`, a
small reader of the common part of OpenStreetMap's syntax that answers "unknown" for anything it doesn't understand
(months, sunrise, …). The location is used for that answer only and never stored. Splitting up: `item_assignees`
(item, user; none = everyone, and everyone ticked is stored as none) set with `PUT /items/:id/assignees`, members only,
removed when someone leaves the trip and not copied by a fork; `itinerary_items.meetup` marks where the group meets
again (copied by a fork). **Offline:** `public/sw.js` (hand-written, registered in production builds) caches built
assets and media cache-first, and trip pages (HTML and RSC payloads) plus `/trips`, `/trips/:id`,
`/trips/:id/expenses` and `/users/me` network-first; queries run with `networkMode: "offlineFirst"` so they still try
(and get the cached copy). Went/skipped marks that fail for lack of a connection are queued in `localStorage`
(`lib/offline.ts`), shown on top of the cached trip, and sent in one batch per trip when the browser is back online.
Logout clears the data cache and the queue.

**After the trip** (migration `20261018000000_after_the_trip`). Each item's `status` (PLANNED / VISITED / SKIPPED)
records what happened; `PATCH /trips/:id/items/status` sets many at once (one-tap buttons and the after-trip
checklist share it) under the trip's row lock. Summaries carry an `outcome` (`{planned, visited, skipped}` over places,
null until something is marked). Members attach their own uploads to stops (`item_photos`, permission
`itinerary.photo`, up to 24 per stop). A fork records each copied item's `source_item_id`, so the copy shows *evidence*
— the original's status and how many members loved it, counts only — for as long as the original exists and isn't
private. Expenses (`expenses`, `expense_shares`, `settlements`) are members-only (`expenses.manage`, never public) and
use the trip's single `currency`, which is locked once any money is recorded. Amounts are `BIGINT` minor units
(`currencyDigits` from Intl: 0 for VND/JPY, 2 for USD); `splitEqually` hands the leftover units to the first people,
by-amount shares must add up (checked by the schema and a DB `CHECK` for positivity), and `balances` + `settleUp` (greedy
largest creditor/debtor, deterministic ties) in `packages/shared/src/money.ts` compute the fewest repayments. Every
change returns the whole `ExpensesView` and emits `trip.expenses.updated`; the web keeps it under the trip's query key
so realtime refreshes it with the rest of the trip.

**Activity log** (`trip_events`, append-only). Every structural change to a plan — added, pooled, updated, moved,
deleted, status, voted, unvoted, member dates, who's going, photos, expenses and repayments — is inserted in the same transaction as the change, with facts only
(ids, day numbers, slots, vote levels; never titles or notes). It is the behavioural record future planning
suggestions will learn from; whether a user's events may be used for that is their opt-in
`user_profiles.analytics_consent` (Settings → Planning suggestions), checked by whatever exports them.

Migrations live in `apps/api/prisma/migrations`. `npm test` rebuilds the test DB straight from those SQL files, so the tests always exercise exactly what production will run.

## REST API (`/api/v1`)

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/register` `/auth/login` `/auth/logout` `/auth/refresh` `/auth/forgot-password` `/auth/reset-password` `/auth/password` `/auth/verify-email` `/auth/verify-email/resend` · `GET /auth/providers` `/auth/google/start?next` `/auth/google/callback` |
| Users | `GET/PATCH/DELETE /users/me` · `GET /users/:handle` `/users/:handle/trips` `/users/:handle/posts` `/users/:handle/followers` `/users/:handle/following` · `POST/DELETE /users/:handle/follow` |
| Trips | `POST/GET /trips` (`?filter=all\|mine\|shared\|past`) · `GET /trips/saved` · `GET/PATCH/DELETE /trips/:id` · `POST /trips/:id/fork` · `POST/DELETE /trips/:id/save` |
| Days | `GET/POST /trips/:id/days` · `PATCH/DELETE /trips/:id/days/:dayId` |
| Items | `POST /days/:dayId/items` · `PATCH/DELETE /items/:id` · `POST /items/:id/reorder` `{dayId \| null, index, slot?}` · `POST /items/:id/duplicate` |
| Ideas pool & votes | `GET/POST /trips/:id/pool` · `PUT/DELETE /items/:id/vote` `{level: LOVE\|OK\|SKIP}` |
| During the trip | `GET /trips/:id/next?date=YYYY-MM-DD&time=HH:mm[&near=lat,lng]` · `PUT /items/:id/assignees` `{userIds}` · `PATCH /items/:id` `{meetup}` |
| After the trip | `PATCH /trips/:id/items/status` `{items: [{id, status}]}` · `POST /items/:itemId/photos` `{mediaId}` · `DELETE /item-photos/:photoId` |
| Expenses | `GET/POST /trips/:id/expenses` · `PATCH/DELETE /expenses/:expenseId` (`{description, amount, category, paidById, spentOn?, itemId?, split: {mode: equal, userIds} \| {mode: custom, shares}}`) · `POST /trips/:id/settlements` `{fromId, toId, amount}` · `DELETE /settlements/:settlementId` — each returns the whole expenses view |
| Members | `GET /trips/:id/members` · `POST /trips/:id/invitations` · `DELETE /trips/:id/invitations/:invId` · `PATCH/DELETE /trips/:id/members/:userId` · `PATCH /trips/:id/members/:userId/dates` `{arriveOn, leaveOn}` |
| Invitations | `GET /invitations/:token` · `POST /invitations/:token/accept\|reject` · `GET /invitations/id/:id` · `POST /invitations/id/:id/accept\|reject` |
| Discovery | `GET /explore` · `GET /search?q&type` · `GET /destinations` · `GET /destinations/:slug` |
| Catalog admin (ADMIN only, audit-logged) | `GET /admin/areas?parent=` · `GET/POST /admin/sync-jobs` · `PATCH/DELETE /admin/sync-jobs/:id` · `POST /admin/sync-jobs/:id/run {dryRun}` · `POST /admin/sync-runs {area, providers, dryRun}` · `GET /admin/sync-runs?status=&jobId=&area=` · `GET /admin/sync-runs/:id` (+ `/errors`) · `POST /admin/sync-runs/:id/cancel` · `GET /admin/merge-candidates?status=&area=` · `POST /admin/merge-candidates/:id/decide {merge\|reject}` · `POST /admin/place-merges/:id/undo` · `GET /admin/places?q=&area=&status=&category=` · `GET/PATCH /admin/places/:id` (edits lock fields; `unlock: [...]`) · `GET /admin/categories` · `GET /admin/category-maps?provider=&unmapped=true` · `PUT /admin/category-maps` · socket `admin.join` → `sync_run` events |
| Place photos | `POST /places/:id/photos {mediaId, caption?, postId?}` · `DELETE /place-photos/:id` (uploader or moderator) · `PATCH /place-photos/:id {status}` (moderator) · `GET /admin/place-photos?filter=pending\|reported\|hidden` · reports with `target: "PLACE_PHOTO"` |
| Places | `GET /places/categories` · `GET /places/browse?destination\|near=lat,lng&radius&group&category&q&sort&cursor` · `GET /places/search?q&tripId` · `GET /places/saved` · `GET /places/:id` (detail: hours, contact, other-language names, nearby, public trips using it, data credits) · `GET /places/:id/trip-targets` (trips the viewer can edit, with days) · `POST/DELETE /places/:id/save` |
| Social | `GET /feed?mode&cursor` · `POST /posts` · `GET /posts/saved` · `GET/PATCH/DELETE /posts/:id` · `POST/DELETE /posts/:id/like` · `POST/DELETE /posts/:id/save` · `GET/POST /posts/:id/comments` · `DELETE /comments/:id` · `POST /reports` |
| Notifications | `GET /notifications?cursor` · `GET /notifications/unread-count` · `PATCH /notifications/:id/read` · `PATCH /notifications/read-all` |
| Media | `POST /media` (multipart `file`) · `DELETE /media/:id` · files served at `/media/<key>` |
| Health | `GET /health` |

Errors always look like `{ statusCode, message, fields? }`, and `message` is always safe to show users. Status codes: 401, 403, 404, 409, 413, 415, 422, 429, 500.

List endpoints that can grow without bound (`GET /trips`, `/trips/saved`, `/posts/saved`, `/posts/:id/comments`, `/notifications`, `/feed`) take `?cursor=<last id>&limit=` and return `{ items, nextCursor }` (the feed returns `{ posts, nextCursor }`). An invalid cursor is a 422. `GET /places/browse` is the exception: its results can be ordered by distance, so its cursor is an offset (`"24"`), and it also returns `center`, `radiusKm`, `total` and per-group `facets`.

**Explore → Places.** The area is a destination's centre (default 10 km) or a point from the browser's geolocation (default 5 km; rounded to ~10 m before it is sent, and only `geolocation=(self)` is allowed by `Permissions-Policy`). Filtering uses PostGIS (`ST_DWithin` on `places.location`, GIST-indexed) plus the taxonomy (group = the category's parent). "Recommended" around a point blends rating (unrated ≈ 3.8), data quality and closeness; "Nearest" and "Top rated" are plain sorts. Adding a place to a trip reuses `POST /days/:dayId/items`, so the role check, row lock, ordering, realtime event and notification are the same as in the itinerary editor; `trip-targets` only decides what to offer. The taxonomy ships as a data migration (`20261006000000_taxonomy`), so the filters work before the catalog pipeline has ever run.

### WebSocket (`/socket.io`)

**Handshake.** The socket authenticates with the access cookie when it shares a site with the API, otherwise with
`auth.token`: a one-minute JWT (`typ: "socket"`) from `POST /auth/socket-token`. The web app fetches it through its
own origin — the Next rewrite, so the HTTP-only cookie goes along — before every (re)connect. This is what makes
realtime work with the web app and the API on different domains (Vercel → Render): the browser won't send the API's
cookie there, and Vercel rewrites don't carry WebSockets. A socket token is bound to the session (logout or a
revoked session kills it) and HTTP routes never accept it; the access token is never exposed to scripts.

The client emits `trip.join` / `trip.leave` with `{ tripId }`; joining is acknowledged with `{ ok }`. The server emits:

- `trip.event` `{ tripId, actorId, event, entityId? }`, where `event` is one of `trip.item.created|updated|deleted|reordered`, `trip.day.created`, `trip.updated` or `trip.member.joined|role_changed|removed`.
- `notification.new` (sent to the `user:<id>` room).

## Extension points

| Interface | Today | Later |
|---|---|---|
| `SearchProvider` (`modules/search`) | Postgres `pg_trgm` over an accent-free `search_text` column | OpenSearch / Algolia / Meilisearch |
| `StorageDriver` (`modules/media`) | Local disk + static `/media`, or S3-compatible bucket (R2/B2/MinIO/S3, `MEDIA_DRIVER=s3`) behind the same `/media` URLs | Signed URLs for private media |
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

**Admin control plane (phase 3).** The API never runs the pipeline itself: it writes a queued `sync_runs` row and
asks Airflow (`POST /api/v2/dags/catalog_sync|catalog_dry_run/dagRuns`, JWT from `/auth/token`) to run it with
`sync_run_id` in the config; if Airflow can't be reached the row is failed with the reason. The `catalog_scheduler` DAG
(every 10 min) does the same for due `sync_jobs`. The pipeline writes progress, errors and the outcome back to
`sync_runs`; a trigger sends `NOTIFY sync_run`, which `SyncRunListener` (a dedicated `pg` connection with reconnect)
forwards to the Socket.IO room `admin` (joining re-checks the role). Cancelling sets `cancel_requested`; the pipeline
checks it between batches. Each committed batch also commits its partition's cursor (`sync_run_cursors`), so a retried or resumed run skips finished partitions and loaded batches. Merges from the admin screens and the pipeline go through the same SQL functions
(`catalog_pick_winner`, `catalog_merge_places`, `catalog_unmerge`), and set `places.needs_publish` so the scheduler
recomputes the winner's fields. An admin edit writes `place_edits` and adds the field to `locked_fields`, which
survivorship never overwrites; unlocking hands the field back to the sources on the next publish.

## Place photos

Photos come in layers and share one table, one ordering (`score`: approved traveler photos 2, a Wikidata item's main
image 1.5, Commons quality images ~1) and one credit format:

1. **Travelers**: any verified user can add a photo they uploaded (or one of their post's photos) to an active place.
   Accounts older than 3 days, or with public trips/posts, publish at once; others wait for a moderator. 3 separate
   reports hide a photo; approving it again resolves those reports. All actions by moderators are audit-logged.
2. **Wikimedia Commons** (pipeline step `triply-catalog photos`): free licences only, credits stored per photo.
3. **Later, a paid provider** (Google Places Photos): its terms forbid storing images, so it would be a live, per-view
   source on the place page with a daily budget — the table already has `source` and `remote_url` for that.

The pipeline never writes image files: it queues rows with `remote_url`. `PhotoIngestService` in the API claims them
with `FOR UPDATE SKIP LOCKED` (safe with several instances), downloads only over https from `PHOTO_HOSTS`
(default `upload.wikimedia.org,thumb.wikimedia.org`) without following redirects and with a size cap, and stores them through the same
`MediaService.store()` as uploads (validation, EXIF removal, three WebP sizes). Failures back off 5→40 min and stop
after 5 attempts; the same Commons file used by two places is downloaded once. Env: `PHOTO_INGEST=on|off`,
`PHOTO_HOSTS`, `CATALOG_CONTACT` (a URL or email; Wikimedia answers 403 to clients that don't give one, so
without it imports simply stay queued) or a full `PHOTO_USER_AGENT`. `npm run photos:ingest -w @triply/api` drains
the queue on demand.

## Known trade-offs

- **Catalog matching is conservative.** Publishing attaches a record to a place only on an exact normalised name
  within 50 m; fuzzy matches (trigram names in any language, distance, category, address) merge automatically only at
  a score ≥ 0.85 and otherwise wait for an admin, because a wrong merge is worse than a duplicate — and every merge can
  be undone exactly.

- **Search** uses `pg_trgm`. Each searchable row keeps a denormalised, lower-cased, accent-free `search_text` (title, description, destinations, …) with a GIN trigram index; it's rewritten whenever the source fields change and back-filled at boot. A query matches when **every word** starts a word of `search_text`; only when nothing matches that way are close spellings tried (`word <% search_text`, the indexable form of `word_similarity ≥ 0.4`, with `pg_trgm.word_similarity_threshold` and `work_mem = 16MB` set per connection by `PrismaService`). For places, a broad query is ranked on at most 1,500 matches plus up to 300 places whose name starts with the query (`placeCandidates`), so cost doesn't grow with the catalog; the browse total is then a lower bound (`totalIsEstimate`, shown "1,500+"). Measured at 1.8M places in the README. Past that, or for typo-tolerant ranking across everything, swap in a search engine behind `SearchProvider`.
- **Lists read indexes in order.** Explore, area pages and admin lists each have an index matching their ORDER BY (partial on `merged_into_id IS NULL`; `status` is an index column because Prisma sends enums as `CAST($1 AS "PlaceStatus")`, which can't satisfy a partial predicate). Areas and categories are resolved to ids before the main query so it has no joins. Counts are one `GROUP BY` over `places_area_category_idx` (index-only), cached 5 min for whole areas; Prisma `_count` includes are avoided on large relations because they aggregate the entire related table.
- **Map routes** are straight lines between stops in visit order, not real road/transit paths.
- **Structural edits are serialised per trip.** Adding, moving, duplicating or deleting items and days takes `SELECT … FOR UPDATE` on the trip row inside the transaction, and reorder re-reads the item's current day under that lock and only changes the moved item's day — so concurrent reorders can't resurrect a stale list. Ordering is written in one `UPDATE … FROM unnest()` statement.
- **Counters are change-driven.** Likes, saves and comment deletes move their counters by the number of rows actually changed in the same transaction, so double-clicks and races neither error nor drift.
- **Side effects after commit.** Realtime notification pushes are queued with `afterCommit()` (AsyncLocalStorage inside `PrismaService.transaction()`), so clients never refetch before a row exists or hear about one that was rolled back.
- **Client IP for rate limits** comes from `X-Forwarded-For` as far as `TRUST_PROXY` allows. Next.js passes that header through unchanged, so production needs an edge that overwrites it (Vercel does; `deploy/nginx.conf` for Docker). Without an edge (local `npm run dev`) it can be forged; per-account lockout still protects passwords.
- **Private trip pages answer 403, not 404**, so a signed-out invitee sees "This trip is private — log in". A trip id is a random UUID, so this reveals nothing useful.
- **Concurrent field edits are last-write-wins.** Realtime refetch makes conflicts visible right away; there's no collaborative text editing (as the spec says).
- **Realtime runs on one instance.** Socket.IO rooms live in memory; scaling the API horizontally needs the Redis adapter.
