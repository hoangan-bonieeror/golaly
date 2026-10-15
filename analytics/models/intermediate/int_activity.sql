-- Who was active on which day: changed a trip's plan, signed in, posted / commented / liked, or any product event.
-- Ephemeral (see dbt_project.yml): per-person rows never leave the query that aggregates them.
select distinct user_id, day from (
  select actor_id as user_id, at::date as day from {{ ref('stg_trip_events') }} where actor_id is not null
  union all
  select user_id, signed_in_at::date from {{ ref('stg_sessions') }}
  union all
  select user_id, at::date from {{ ref('stg_product_events') }} where user_id is not null
  union all
  select user_id, at::date from {{ ref('stg_social') }}
) a
