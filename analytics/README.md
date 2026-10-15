# TRIPLY analytics (dbt)

Turns the app's own Postgres tables into small **aggregate marts** for the admin dashboard
(`/admin/analytics` → *Cohorts & stickiness*). ELT inside the warehouse the app already has: no extra
infrastructure, no client-side tracker, no third-party analytics.

```
 NestJS API ──writes──► public.*  (users, sessions, trips, trip_members, itinerary_items,
                                   trip_events, product_events, posts, …)
                              │
            dbt build  (nightly: GitHub Action "Analytics" on the demo · Airflow DAG analytics_daily locally)
                              │
   analytics_staging.stg_*   views — rename, light typing, one per source table
   intermediate (ephemeral)  int_activity (who was active which day), int_user_milestones (first time each step)
   analytics.fct_*           tables — aggregates only
                              │
            API GET /admin/analytics/cohorts  (admins only)  ──►  dashboard
```

## Models

| Layer | Model | Grain | What it answers |
|---|---|---|---|
| staging (view) | `stg_users`, `stg_sessions`, `stg_trips`, `stg_trip_members`, `stg_trip_destinations`, `stg_items`, `stg_trip_events`, `stg_product_events`, `stg_social` | source row | Clean, renamed columns; `stg_social` unions posts, comments and likes |
| intermediate (ephemeral) | `int_activity` | person × day | Who did something on which day (planned, signed in, any product event, posted/commented/liked) |
| intermediate (ephemeral) | `int_user_milestones` | person | When each person first created a trip, planned a stop, planned with others, started a trip, marked a stop, shared |
| mart | `fct_daily_activity` | day | Sign-ups, DAU / 7-day WAU / 28-day MAU, logins, trips created / together / remixed / published / started, invitations accepted, posts, stops added and marked |
| mart | `fct_retention_weekly` | sign-up week × weeks since | Share of a week's new people active again N whole weeks later (0–12) |
| mart | `fct_activation_weekly` | sign-up week | How many of a week's new people reached each step within 30 days (`maturing` while the 30 days run) |
| mart | `fct_destination_trips_daily` | day × destination | Trips created per destination |

## Privacy by construction

- **Aggregates only in stored tables.** Per-person rows exist only inside ephemeral models (compiled into the mart
  queries as CTEs) — nothing per person is ever materialised. A test (`marts_hold_no_people`) fails the build if a
  mart grows a column like `user_id`, `email` or `username`.
- **Small cohorts are left out** (`min_cohort`, default 5, tested by `no_small_cohorts`), so no cell points at one person.
- **Events are facts, never content.** `product_events.props` holds ids and small enums — never titles, notes, bodies,
  names or e-mails (tested in the API's `analytics.int.ts`).
- Separate from `user_profiles.analytics_consent`, which is the opt-in for using someone's activity to personalise
  *planning suggestions*; these service-level counts don't profile anyone.

## Tests (`dbt build` runs them after the models)

Generic: `unique` / `not_null` on keys, `dbt_unique_combination` (cohort × week). Singular (`tests/`):
`rolling_active_users_are_nested` (DAU ≤ WAU ≤ MAU), `retention_rates_are_shares`, `activation_steps_within_cohort`,
`no_small_cohorts`, `marts_hold_no_people`. CI runs `dbt build` on the API test database after the Jest suite.

## Run it

```bash
cd analytics
uv sync                                     # dbt-core 1.12 + dbt-postgres 1.11 in .venv
DATABASE_URL=postgresql://triply:triply@localhost:5433/triply uv run python run.py build
uv run python run.py docs generate && uv run python run.py docs serve   # lineage graph
```

`run.py` splits `DATABASE_URL` (the variable the app and the catalog pipeline use) into the `PG*` variables
`profiles.yml` reads, then calls dbt programmatically. Nightly:

- **Demo (Neon):** `.github/workflows/analytics.yml`, 02:17 UTC, environment `production` (secret `NEON_DATABASE_URL`).
  Run it by hand from Actions → Analytics → Run workflow.
- **Local Airflow:** DAG `analytics_daily` (`pipelines/dags/analytics_daily.py`); dbt lives in its own virtualenv
  in the image (`/opt/dbt`) so it never conflicts with Airflow's pins.

Need data to look at? `npm run db:analytics-demo -w @triply/api` adds ~550 synthetic people over 90 days
(`@demo.triply.invalid`, `is_demo`; `--reset` / `--remove`), then run the build.
